/**
 * Hybrid Processor
 *
 * Two-track processing for real-time alerts:
 * 1. Fast Track: Process first 10 minutes immediately (~1-2 min)
 * 2. Background: Process full video (~10-15 min for 2hr podcast)
 *
 * Claims are deduplicated and alerts triggered based on timestamps.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { normalizeAuthor } from './author-normalization.js';
import { VerificationPipeline } from './verification-pipeline.js';
// Lazy-init Gemini client
let genAI = null;
function getGemini() {
    if (!genAI) {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
        if (!apiKey)
            throw new Error('GEMINI_API_KEY not set');
        genAI = new GoogleGenerativeAI(apiKey);
    }
    return genAI;
}
const DEFAULT_CONFIG = {
    fastTrackMinutes: 10,
    modelName: 'gemini-3-flash-preview'
};
// ─────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────
const EXTRACTION_PROMPT = `
You are a strict fact-checking assistant. Extract ONLY verifiable scientific claims.

## STRICT REQUIREMENTS - A claim MUST have AT LEAST ONE of:
1. A NAMED researcher (e.g., "Dr. Layne Norton", "Jose Antonio", "Chris Barakat")
2. A NAMED institution (e.g., "Harvard", "University of Sydney", "ISSN")
3. A SPECIFIC study reference (e.g., "a 2019 meta-analysis", "a metabolic ward study with 20 subjects")

## ABSOLUTELY SKIP (do NOT extract):
- Intro teasers/highlights in first 60 seconds that preview later content
- Vague claims: "studies show...", "research suggests...", "science says..." (NO specifics = NO extraction)
- Host opinions without citations
- General statements: "protein builds muscle", "calories matter"
- Sponsor segments, ads
- Questions being asked (only extract answers with citations)

## EXAMPLES OF WHAT NOT TO EXTRACT:
❌ "Caloric deficit is not required" - no author, no study
❌ "The answer is yes" - not a claim
❌ "Studies have shown recomp is possible" - no specific study
❌ "It's possible to gain muscle and lose fat" - general statement

## EXAMPLES OF WHAT TO EXTRACT:
✅ "Chris Barakat compiled 10 studies showing recomposition phenomenon" - named researcher + specific count
✅ "Jose Antonio's 2014 study found subjects eating 800 extra calories from protein..." - named researcher + specific study
✅ "A metabolic ward study at NIH found..." - specific study type + institution

## OUTPUT FORMAT (JSON only, empty array if no valid claims)

{
  "claims": [
    {
      "timestamp": "MM:SS",
      "segment": "Exact quote from video",
      "author_mentioned": "Full researcher name or null",
      "institution_mentioned": "Institution name or null", 
      "finding_summary": "Specific finding with numbers/details",
      "confidence": "high|medium|low",
      "search_queries": {
        "primary_query": "author surname + key finding terms",
        "topic_query": "scientific terminology",
        "broad_query": "broader topic"
      }
    }
  ]
}

Remember: Quality over quantity. Only extract claims that can actually be verified against real papers.
`;
// ─────────────────────────────────────────────────────────────
// Processor
// ─────────────────────────────────────────────────────────────
export class HybridProcessor {
    config;
    processingJobs = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Start hybrid processing for a video
     * Returns immediately with job ID, processes in background
     */
    async startProcessing(youtubeUrl, videoTitle) {
        const videoId = this.extractVideoId(youtubeUrl);
        // Check if already processing
        const existing = this.processingJobs.get(videoId);
        if (existing && existing.status !== 'error') {
            console.log(`⏳ Video ${videoId} already processing`);
            return videoId;
        }
        // Initialize job
        const job = {
            videoId,
            videoUrl: youtubeUrl,
            videoTitle: videoTitle || null,
            status: 'processing',
            fastTrackClaims: [],
            allClaims: [],
            fastTrackCompletedAt: null,
            fullProcessingCompletedAt: null
        };
        this.processingJobs.set(videoId, job);
        console.log(`🚀 Starting hybrid processing for ${videoId}`);
        // Start both tracks in parallel
        this.runFastTrack(videoId, youtubeUrl);
        this.runFullProcessing(videoId, youtubeUrl);
        return videoId;
    }
    /**
     * Get current processing status and claims
     */
    getStatus(videoId) {
        return this.processingJobs.get(videoId) || null;
    }
    /**
     * Get claims that should be shown up to a given timestamp
     */
    getClaimsUpTo(videoId, currentTimestamp) {
        const job = this.processingJobs.get(videoId);
        if (!job)
            return [];
        const currentSeconds = this.timestampToSeconds(currentTimestamp);
        // Use allClaims if available, otherwise fastTrackClaims
        const claims = job.allClaims.length > 0 ? job.allClaims : job.fastTrackClaims;
        return claims.filter(claim => {
            const claimSeconds = this.timestampToSeconds(claim.timestamp);
            return claimSeconds <= currentSeconds;
        });
    }
    // ─────────────────────────────────────────────────────────────
    // Fast Track (first N minutes)
    // ─────────────────────────────────────────────────────────────
    async runFastTrack(videoId, youtubeUrl) {
        const job = this.processingJobs.get(videoId);
        if (!job)
            return;
        try {
            console.log(`⚡ Fast track: Processing first ${this.config.fastTrackMinutes} minutes`);
            const startTime = Date.now();
            const prompt = `${EXTRACTION_PROMPT}

IMPORTANT: Only analyze the FIRST ${this.config.fastTrackMinutes} MINUTES of this video.
Stop analyzing after the ${this.config.fastTrackMinutes}:00 mark.`;
            const claims = await this.callGemini(youtubeUrl, prompt, videoId);
            job.fastTrackClaims = claims;
            job.fastTrackCompletedAt = Date.now();
            job.status = 'fast_track_complete';
            // Save to database
            await this.saveToDatabase(videoId, youtubeUrl, claims);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`⚡ Fast track complete: ${claims.length} claims in ${elapsed}s`);
        }
        catch (error) {
            console.error(`❌ Fast track failed:`, error.message);
            // Don't fail the whole job, full processing might still work
        }
    }
    // ─────────────────────────────────────────────────────────────
    // Full Processing (entire video)
    // ─────────────────────────────────────────────────────────────
    async runFullProcessing(videoId, youtubeUrl) {
        const job = this.processingJobs.get(videoId);
        if (!job)
            return;
        try {
            console.log(`🎬 Full processing: Analyzing entire video`);
            const startTime = Date.now();
            const prompt = `${EXTRACTION_PROMPT}

Analyze the ENTIRE video from start to finish.`;
            const claims = await this.callGemini(youtubeUrl, prompt, videoId);
            // Deduplicate with fast track claims
            job.allClaims = this.deduplicateClaims([...job.fastTrackClaims, ...claims]);
            job.fullProcessingCompletedAt = Date.now();
            job.status = 'complete';
            // Save all claims to database (overwrite fast track)
            await this.saveToDatabase(videoId, youtubeUrl, job.allClaims);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`🎬 Full processing complete: ${job.allClaims.length} total claims in ${elapsed}s`);
        }
        catch (error) {
            console.error(`❌ Full processing failed:`, error.message);
            job.error = error.message;
            if (job.fastTrackClaims.length === 0) {
                job.status = 'error';
            }
            // If fast track succeeded, we still have some claims
        }
    }
    // ─────────────────────────────────────────────────────────────
    // Gemini API Call
    // ─────────────────────────────────────────────────────────────
    async callGemini(youtubeUrl, prompt, videoId) {
        const model = getGemini().getGenerativeModel({
            model: this.config.modelName,
            generationConfig: {
                responseMimeType: "application/json"
            }
        });
        const result = await model.generateContent([
            { text: prompt + "\n\nRespond ONLY with valid JSON, no other text." },
            {
                fileData: {
                    fileUri: youtubeUrl,
                    mimeType: 'video/mp4'
                }
            }
        ]);
        const responseText = result.response.text();
        const jsonText = responseText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();
        const parsed = JSON.parse(jsonText);
        return (parsed.claims || []).map((claim, idx) => this.synthesizeClaim(claim, videoId, idx));
    }
    // ─────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────
    synthesizeClaim(claim, videoId, index) {
        const normalized = normalizeAuthor(claim.author_mentioned);
        return {
            claim_id: `${videoId}_claim_${index}`,
            video_id: videoId,
            timestamp: claim.timestamp || '0:00',
            segment: {
                full_text: claim.segment,
                word_count: claim.segment?.split(' ').length || 0
            },
            extraction: {
                author_mentioned: claim.author_mentioned,
                author_normalized: normalized.normalized,
                author_variants: normalized.variants,
                institution_mentioned: claim.institution_mentioned,
                finding_summary: claim.finding_summary,
                confidence: claim.confidence || 'medium'
            },
            search: {
                primary_query: claim.search_queries?.primary_query || '',
                topic_query: claim.search_queries?.topic_query || '',
                broad_query: claim.search_queries?.broad_query || '',
                fallback_queries: [
                    claim.search_queries?.topic_query,
                    claim.search_queries?.broad_query
                ].filter(Boolean)
            }
        };
    }
    deduplicateClaims(claims) {
        const seen = new Map();
        for (const claim of claims) {
            // Primary key: timestamp + author (if author exists)
            // This catches same claim phrased differently by Gemini
            const author = claim.extraction.author_normalized || claim.extraction.author_mentioned || '';
            let key;
            if (author) {
                // If we have an author, use timestamp + author as key
                key = `${claim.timestamp}_${author.toLowerCase().replace(/[^a-z]/g, '')}`;
            }
            else {
                // No author: use timestamp + first 30 chars of finding
                const findingKey = (claim.extraction.finding_summary || '')
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, '')
                    .slice(0, 30);
                key = `${claim.timestamp}_${findingKey}`;
            }
            // Keep the first version (or replace with more complete one)
            if (!seen.has(key)) {
                seen.set(key, claim);
            }
            else {
                const existing = seen.get(key);
                // Prefer version with longer finding
                const existingLen = existing.extraction.finding_summary?.length || 0;
                const newLen = claim.extraction.finding_summary?.length || 0;
                if (newLen > existingLen) {
                    seen.set(key, claim);
                }
            }
        }
        // Sort by timestamp
        return [...seen.values()].sort((a, b) => this.timestampToSeconds(a.timestamp) - this.timestampToSeconds(b.timestamp));
    }
    timestampToSeconds(timestamp) {
        const parts = timestamp.split(':').map(Number);
        if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        }
        else if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        return 0;
    }
    extractVideoId(url) {
        const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return match ? `yt-${match[1]}` : `yt-${Date.now()}`;
    }
    // ─────────────────────────────────────────────────────────────
    // Database Persistence
    // ─────────────────────────────────────────────────────────────
    async saveToDatabase(videoId, youtubeUrl, claims) {
        const supabase = this.config.supabase;
        if (!supabase) {
            console.log('⏭️ No database client, skipping persistence');
            return;
        }
        // Get video title from job
        const job = this.processingJobs.get(videoId);
        const videoTitle = job?.videoTitle || null;
        try {
            // Upsert video record
            await supabase.from('videos').upsert({
                id: videoId,
                title: videoTitle,
                url: youtubeUrl,
                claims_count: claims.length,
                first_analyzed_at: new Date().toISOString()
            }, { onConflict: 'id' });
            // Upsert claims
            for (const claim of claims) {
                await supabase.from('claims').upsert({
                    claim_id: claim.claim_id,
                    video_id: claim.video_id,
                    timestamp: claim.timestamp,
                    segment_text: claim.segment?.full_text || '',
                    author_mentioned: claim.extraction?.author_mentioned,
                    author_normalized: claim.extraction?.author_normalized,
                    institution_mentioned: claim.extraction?.institution_mentioned,
                    finding_summary: claim.extraction?.finding_summary,
                    confidence: claim.extraction?.confidence,
                    primary_query: claim.search?.primary_query
                }, { onConflict: 'claim_id' });
            }
            console.log(`💾 Saved ${claims.length} claims to database`);
            // Trigger background verification (non-blocking)
            this.runBackgroundVerification(claims).catch(err => {
                console.warn('⚠️ Background verification failed:', err.message);
            });
        }
        catch (error) {
            console.warn('⚠️ Database save failed:', error.message);
        }
    }
    // ─────────────────────────────────────────────────────────────
    // Background Verification
    // ─────────────────────────────────────────────────────────────
    async runBackgroundVerification(claims) {
        const supabase = this.config.supabase;
        if (!supabase)
            return;
        console.log(`🔬 Starting background verification for ${claims.length} claims...`);
        const verifier = new VerificationPipeline();
        for (const claim of claims) {
            try {
                // Convert to SynthesizedClaim format for verification pipeline
                const synthClaim = {
                    claim_id: claim.claim_id,
                    video_id: claim.video_id,
                    segment: {
                        full_text: claim.segment?.full_text || '',
                        word_count: claim.segment?.word_count || 0
                    },
                    extraction: {
                        author_mentioned: claim.extraction?.author_mentioned || null,
                        author_normalized: claim.extraction?.author_normalized || null,
                        author_variants: [],
                        institution_mentioned: claim.extraction?.institution_mentioned || null,
                        finding_summary: claim.extraction?.finding_summary || '',
                        confidence: claim.extraction?.confidence || 'medium'
                    },
                    search: {
                        primary_query: claim.search?.primary_query || '',
                        fallback_queries: claim.search?.fallback_queries || []
                    }
                };
                // Run verification
                const verified = await verifier.verifyClaim(synthClaim);
                // Update claim in database
                const updateData = {
                    verified_at: new Date().toISOString()
                };
                if (verified.verification.best_paper) {
                    updateData.paper_url = verified.verification.best_paper.url;
                    updateData.paper_title = verified.verification.best_paper.title;
                    updateData.paper_authors = verified.verification.best_paper.authors?.join(', ');
                    updateData.paper_year = verified.verification.best_paper.year;
                    updateData.paper_abstract = verified.verification.best_paper.abstract?.slice(0, 1000);
                }
                if (verified.verification.result) {
                    updateData.verification_verdict = verified.verification.result.verdict;
                    updateData.verification_explanation = verified.verification.result.explanation;
                }
                const { error: updateError } = await supabase
                    .from('claims')
                    .update(updateData)
                    .eq('claim_id', claim.claim_id);
                if (updateError) {
                    console.warn(`⚠️ DB update failed for ${claim.claim_id}:`, updateError.message);
                }
                else {
                    console.log(`✅ Verified: ${claim.claim_id} → ${verified.verification.result?.verdict || 'no_paper_found'}`);
                }
                // Small delay to avoid rate limits
                await new Promise(r => setTimeout(r, 1000));
            }
            catch (err) {
                console.warn(`⚠️ Verification failed for ${claim.claim_id}:`, err.message);
            }
        }
        console.log(`🔬 Background verification complete`);
    }
}
export const hybridProcessor = new HybridProcessor();
