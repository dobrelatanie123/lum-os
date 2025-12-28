/**
 * Gemini 3 Flash Claim Extractor
 * Processes YouTube URLs directly - no audio capture needed!
 *
 * Benefits:
 * - One API call instead of Whisper + GPT-4
 * - 10x cheaper (~$0.05 per video vs $0.50)
 * - Gets timestamps automatically
 * - Simpler architecture
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { normalizeAuthor } from './author-normalization.js';
// Lazy-init Gemini client
let genAI = null;
function getGemini() {
    if (!genAI) {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY or GOOGLE_AI_API_KEY not set');
        }
        genAI = new GoogleGenerativeAI(apiKey);
    }
    return genAI;
}
// ─────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────
const GEMINI_EXTRACTION_PROMPT = `
You are a fact-checking assistant. Watch this video and extract claims that reference scientific studies.

## WHAT TO EXTRACT

Extract claims containing:
- Named researchers (Dr., Professor) + their findings
- Named institutions (University of X, Harvard) + their findings
- Specific studies ("a 2013 study by Bray...", "meta-analysis of 62 studies...")
- Study types with specific outcomes ("metabolic ward study found...", "RCT showed...")

## WHAT TO SKIP

Do NOT extract:
- Personal anecdotes ("I started taking...", "In my experience...")
- Vague references ("studies show...", "research suggests..." without specifics)
- Expert opinions/advice (not citing research findings)
- Hedged claims ("maybe", "probably", "I think")
- Common knowledge, promotional content, testimonials

## SEARCH QUERY GENERATION (CRITICAL)

For each claim, generate 3 search queries optimized for academic databases:
- Use scientific/technical terminology (not casual podcast language)
- Include measurable outcomes and variables
- Include study type if mentioned (meta-analysis, RCT, systematic review)
- Keep queries 4-7 words
- NO filler words (the, a, found that, showed that, study)

Query types:
1. **primary_query**: Author surname + key scientific terms
2. **topic_query**: Topic only (no author) - scientific terminology
3. **broad_query**: Broader fallback - main subject + study type

## CONFIDENCE LEVELS

- high: Named author + specific finding
- medium: Specific study details but no author, OR author but vague finding
- low: Vague study reference

## OUTPUT FORMAT (JSON only, no markdown)

{
  "video_title": "Title of the video",
  "video_duration": "MM:SS",
  "claims": [
    {
      "timestamp": "MM:SS",
      "segment": "Exact quote containing the claim",
      "author_mentioned": "Researcher name or null",
      "institution_mentioned": "Institution or null",
      "finding_summary": "What the study reportedly found",
      "confidence": "high|medium|low",
      "search_queries": {
        "primary_query": "author surname + key terms",
        "topic_query": "scientific terminology only",
        "broad_query": "broader fallback"
      }
    }
  ]
}

If no study claims found, return: { "video_title": "...", "claims": [] }
`;
// ─────────────────────────────────────────────────────────────
// Extractor
// ─────────────────────────────────────────────────────────────
export class GeminiExtractor {
    modelName = 'gemini-3-flash-preview'; // Latest, Pro-level at Flash price
    /**
     * Extract claims from a YouTube video URL
     * This is the main entry point - one API call does everything!
     */
    async extractFromYouTube(youtubeUrl) {
        const startTime = Date.now();
        console.log(`🎬 Processing YouTube video: ${youtubeUrl}`);
        // Extract video ID for claim IDs
        const videoId = this.extractVideoId(youtubeUrl);
        try {
            const model = getGemini().getGenerativeModel({ model: this.modelName });
            // Call Gemini with YouTube URL
            const result = await model.generateContent([
                { text: GEMINI_EXTRACTION_PROMPT },
                {
                    fileData: {
                        fileUri: youtubeUrl,
                        mimeType: 'video/mp4'
                    }
                }
            ]);
            const responseText = result.response.text();
            // Parse JSON response (handle markdown code blocks)
            const jsonText = responseText
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim();
            const parsed = JSON.parse(jsonText);
            console.log(`📋 Found ${parsed.claims.length} claims in "${parsed.video_title}"`);
            // Synthesize claims with author normalization
            const synthesized = parsed.claims.map((claim, idx) => this.synthesizeClaim(claim, videoId, idx));
            const processingTime = Date.now() - startTime;
            return {
                videoTitle: parsed.video_title,
                claims: synthesized,
                processingTime
            };
        }
        catch (error) {
            console.error('❌ Gemini extraction failed:', error);
            throw error;
        }
    }
    /**
     * Extract claims from raw transcript text (fallback mode)
     */
    async extractFromTranscript(transcript, videoId) {
        console.log(`📝 Processing transcript (${transcript.split(' ').length} words)`);
        try {
            const model = getGemini().getGenerativeModel({ model: this.modelName });
            const result = await model.generateContent([
                { text: GEMINI_EXTRACTION_PROMPT },
                { text: `\n\nTranscript:\n${transcript}` }
            ]);
            const responseText = result.response.text();
            const jsonText = responseText
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim();
            const parsed = JSON.parse(jsonText);
            return parsed.claims.map((claim, idx) => this.synthesizeClaim(claim, videoId, idx));
        }
        catch (error) {
            console.error('❌ Gemini transcript extraction failed:', error);
            return [];
        }
    }
    // ─────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────
    synthesizeClaim(claim, videoId, index) {
        const normalized = normalizeAuthor(claim.author_mentioned);
        return {
            claim_id: `${videoId}_claim_${index}`,
            video_id: videoId,
            timestamp: claim.timestamp,
            segment: {
                full_text: claim.segment,
                word_count: claim.segment.split(' ').length
            },
            extraction: {
                author_mentioned: claim.author_mentioned,
                author_normalized: normalized.normalized,
                author_variants: normalized.variants,
                institution_mentioned: claim.institution_mentioned,
                finding_summary: claim.finding_summary,
                confidence: claim.confidence
            },
            search: {
                primary_query: claim.search_queries.primary_query,
                topic_query: claim.search_queries.topic_query,
                broad_query: claim.search_queries.broad_query,
                fallback_queries: [
                    claim.search_queries.topic_query,
                    claim.search_queries.broad_query
                ]
            }
        };
    }
    extractVideoId(url) {
        const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return match ? `yt-${match[1]}` : `yt-${Date.now()}`;
    }
}
export const geminiExtractor = new GeminiExtractor();
