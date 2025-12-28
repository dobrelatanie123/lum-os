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
import type { GeminiSynthesizedClaim } from './gemini-extractor.js';

// Lazy-init Gemini client
let genAI: GoogleGenerativeAI | null = null;
function getGemini(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ProcessingStatus {
  videoId: string;
  videoUrl: string;
  status: 'processing' | 'fast_track_complete' | 'complete' | 'error';
  fastTrackClaims: GeminiSynthesizedClaim[];
  allClaims: GeminiSynthesizedClaim[];
  fastTrackCompletedAt: number | null;
  fullProcessingCompletedAt: number | null;
  error?: string;
}

interface HybridConfig {
  fastTrackMinutes: number;  // How many minutes to process quickly (default: 10)
  modelName: string;
}

const DEFAULT_CONFIG: HybridConfig = {
  fastTrackMinutes: 10,
  modelName: 'gemini-3-flash-preview'
};

// ─────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `
You are a fact-checking assistant analyzing a podcast video.

## WHAT TO EXTRACT

Extract claims containing:
- Named researchers (Dr., Professor) + their findings
- Named institutions (University of X, Harvard) + their findings
- Specific studies ("a 2013 study by Bray...", "meta-analysis of 62 studies...")
- Study types with specific outcomes ("metabolic ward study found...", "RCT showed...")

## WHAT TO SKIP

- Personal anecdotes ("I started taking...", "In my experience...")
- Vague references ("studies show..." without specifics)
- Expert opinions (not citing research)
- Sponsor segments, ads, promotional content

## OUTPUT FORMAT (JSON only)

{
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
`;

// ─────────────────────────────────────────────────────────────
// Processor
// ─────────────────────────────────────────────────────────────

export class HybridProcessor {
  private config: HybridConfig;
  private processingJobs: Map<string, ProcessingStatus> = new Map();
  
  constructor(config: Partial<HybridConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Start hybrid processing for a video
   * Returns immediately with job ID, processes in background
   */
  async startProcessing(youtubeUrl: string): Promise<string> {
    const videoId = this.extractVideoId(youtubeUrl);
    
    // Check if already processing
    const existing = this.processingJobs.get(videoId);
    if (existing && existing.status !== 'error') {
      console.log(`⏳ Video ${videoId} already processing`);
      return videoId;
    }
    
    // Initialize job
    const job: ProcessingStatus = {
      videoId,
      videoUrl: youtubeUrl,
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
  getStatus(videoId: string): ProcessingStatus | null {
    return this.processingJobs.get(videoId) || null;
  }
  
  /**
   * Get claims that should be shown up to a given timestamp
   */
  getClaimsUpTo(videoId: string, currentTimestamp: string): GeminiSynthesizedClaim[] {
    const job = this.processingJobs.get(videoId);
    if (!job) return [];
    
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
  
  private async runFastTrack(videoId: string, youtubeUrl: string): Promise<void> {
    const job = this.processingJobs.get(videoId);
    if (!job) return;
    
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
      
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`⚡ Fast track complete: ${claims.length} claims in ${elapsed}s`);
      
    } catch (error: any) {
      console.error(`❌ Fast track failed:`, error.message);
      // Don't fail the whole job, full processing might still work
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // Full Processing (entire video)
  // ─────────────────────────────────────────────────────────────
  
  private async runFullProcessing(videoId: string, youtubeUrl: string): Promise<void> {
    const job = this.processingJobs.get(videoId);
    if (!job) return;
    
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
      
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`🎬 Full processing complete: ${job.allClaims.length} total claims in ${elapsed}s`);
      
    } catch (error: any) {
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
  
  private async callGemini(
    youtubeUrl: string, 
    prompt: string, 
    videoId: string
  ): Promise<GeminiSynthesizedClaim[]> {
    const model = getGemini().getGenerativeModel({ model: this.config.modelName });
    
    const result = await model.generateContent([
      { text: prompt },
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
    
    return (parsed.claims || []).map((claim: any, idx: number) => 
      this.synthesizeClaim(claim, videoId, idx)
    );
  }
  
  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  
  private synthesizeClaim(claim: any, videoId: string, index: number): GeminiSynthesizedClaim {
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
  
  private deduplicateClaims(claims: GeminiSynthesizedClaim[]): GeminiSynthesizedClaim[] {
    const seen = new Map<string, GeminiSynthesizedClaim>();
    
    for (const claim of claims) {
      // Key by timestamp + author (or first 50 chars of segment)
      const key = `${claim.timestamp}_${claim.extraction.author_normalized || claim.segment.full_text.slice(0, 50)}`;
      
      if (!seen.has(key)) {
        seen.set(key, claim);
      }
    }
    
    // Sort by timestamp
    return [...seen.values()].sort((a, b) => 
      this.timestampToSeconds(a.timestamp) - this.timestampToSeconds(b.timestamp)
    );
  }
  
  private timestampToSeconds(timestamp: string): number {
    const parts = timestamp.split(':').map(Number);
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  }
  
  private extractVideoId(url: string): string {
    const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? `yt-${match[1]}` : `yt-${Date.now()}`;
  }
}

export const hybridProcessor = new HybridProcessor();

