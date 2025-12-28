/**
 * Live Mode Claim Extractor
 * Processes streaming transcript chunks with rolling buffer and deduplication
 */

import OpenAI from 'openai';
import { LIVE_MODE_SYSTEM_PROMPT } from './prompts.js';
import { normalizeAuthor } from './author-normalization.js';
import { RollingBuffer } from './rolling-buffer.js';
import { ClaimDeduplicator } from './deduplicator.js';
import type { 
  ExtractedClaim, 
  LiveModeInput, 
  LiveModeOutput, 
  LiveSynthesizedClaim,
  PendingClaim,
  NormalizedAuthor
} from './types.js';

// Lazy-init OpenAI client
let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// Sponsor/ad detection patterns
const SPONSOR_SIGNALS = [
  'sponsor', 'discount code', 'link in description', 
  'use code', 'promo', 'check out', 'brought to you by',
  'affiliate', 'coupon'
];

export class LiveModeExtractor {
  private buffer = new RollingBuffer();
  private deduplicator = new ClaimDeduplicator();
  private pending: PendingClaim | null = null;
  private windowId = 0;
  private videoId: string = '';
  private allClaims: LiveSynthesizedClaim[] = [];
  
  /**
   * Start a new extraction session
   */
  startSession(videoId: string): void {
    this.videoId = videoId;
    this.windowId = 0;
    this.pending = null;
    this.buffer.clear();
    this.deduplicator.clear();
    this.allClaims = [];
    console.log(`🎬 Started live session for ${videoId}`);
  }
  
  /**
   * Process a new transcript chunk
   * Returns any new claims found in this window
   */
  async processChunk(chunk: string): Promise<LiveSynthesizedClaim[]> {
    this.windowId++;
    
    // Skip sponsor content
    if (this.isSponsorContent(chunk)) {
      console.log(`⏭️  Window ${this.windowId}: Skipping sponsor content`);
      return [];
    }
    
    // Build transcript from rolling buffer
    const transcript = this.buffer.addChunk(chunk);
    
    // Call LLM
    const input: LiveModeInput = {
      mode: 'live',
      window_id: this.windowId,
      transcript,
      previous_pending: this.pending,
      recent_claims: this.deduplicator.getRecentSummaries()
    };
    
    const output = await this.callLLM(input);
    
    // Update pending state
    this.pending = output.pending;
    
    // Process and deduplicate claims
    const results: LiveSynthesizedClaim[] = [];
    
    for (const claim of output.claims) {
      if (this.deduplicator.isDuplicate(claim, this.windowId)) {
        console.log(`🔄 Window ${this.windowId}: Skipping duplicate claim`);
        continue;
      }
      
      this.deduplicator.add(claim, this.windowId);
      const synthesized = this.synthesizeClaim(claim);
      results.push(synthesized);
      this.allClaims.push(synthesized);
    }
    
    if (results.length > 0) {
      console.log(`📋 Window ${this.windowId}: Found ${results.length} new claim(s)`);
    }
    
    return results;
  }
  
  /**
   * Get all claims found in the session so far
   */
  getAllClaims(): LiveSynthesizedClaim[] {
    return this.allClaims;
  }
  
  /**
   * Get current session stats
   */
  getSessionStats(): {
    videoId: string;
    windowId: number;
    totalClaims: number;
    pendingClaim: boolean;
    bufferInfo: { chunks: number; maxChunks: number };
  } {
    return {
      videoId: this.videoId,
      windowId: this.windowId,
      totalClaims: this.allClaims.length,
      pendingClaim: this.pending !== null,
      bufferInfo: this.buffer.getInfo()
    };
  }
  
  // ─────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────
  
  private async callLLM(input: LiveModeInput): Promise<LiveModeOutput> {
    const userMessage = this.buildUserMessage(input);
    
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: LIVE_MODE_SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      });
      
      const content = response.choices[0].message.content;
      const parsed = JSON.parse(content || '{"claims":[],"pending":null}');
      
      return {
        window_id: input.window_id,
        claims: parsed.claims || [],
        pending: parsed.pending || null
      };
    } catch (error) {
      console.error(`❌ LLM call failed for window ${input.window_id}:`, error);
      return {
        window_id: input.window_id,
        claims: [],
        pending: this.pending
      };
    }
  }
  
  private buildUserMessage(input: LiveModeInput): string {
    let message = `Window ${input.window_id}:\n${input.transcript}\n`;
    
    if (input.previous_pending) {
      message += `\nPrevious pending claim:\n${JSON.stringify(input.previous_pending, null, 2)}\n`;
    }
    
    if (input.recent_claims?.length) {
      message += `\nRecent claims (do not re-extract):\n`;
      message += input.recent_claims
        .map(c => `- Window ${c.window}: ${c.author || 'unnamed'} - ${c.topic}`)
        .join('\n');
    }
    
    return message;
  }
  
  private synthesizeClaim(claim: ExtractedClaim): LiveSynthesizedClaim {
    const timestamps = this.buffer.getTimestamps(this.windowId);
    const normalized = normalizeAuthor(claim.author_mentioned);
    
    return {
      claim_id: `${this.videoId}_live_${this.windowId}_${Date.now()}`,
      video_id: this.videoId,
      detection: {
        started_window: this.windowId - 1,
        completed_window: this.windowId,
        latency_windows: 1
      },
      segment: {
        full_text: claim.segment,
        word_count: claim.segment.split(' ').length,
        approximate_timestamp_start: timestamps.start,
        approximate_timestamp_end: timestamps.end
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
        primary_query: this.buildPrimaryQuery(claim, normalized.normalized),
        fallback_queries: this.buildFallbackQueries(claim, normalized)
      }
    };
  }
  
  private buildPrimaryQuery(claim: ExtractedClaim, normalizedAuthor: string | null): string {
    if (normalizedAuthor) {
      const surname = normalizedAuthor.split(' ').pop();
      const topicWords = claim.query.split(' ').slice(0, 3).join(' ');
      return `${surname} ${topicWords}`;
    }
    return claim.query;
  }
  
  private buildFallbackQueries(claim: ExtractedClaim, normalized: NormalizedAuthor): string[] {
    const fallbacks: string[] = [];
    
    if (normalized.variants.length > 0 && normalized.normalized) {
      const surname = normalized.normalized.split(' ').pop() || '';
      for (const variant of normalized.variants.slice(0, 2)) {
        if (variant.toLowerCase() !== surname.toLowerCase()) {
          fallbacks.push(claim.query.replace(new RegExp(surname, 'i'), variant));
        }
      }
    }
    
    if (claim.institution_mentioned) {
      const topicWords = claim.query.split(' ')
        .filter(w => !w.toLowerCase().includes((normalized.normalized?.split(' ').pop() || 'xxxxx').toLowerCase()))
        .slice(0, 2)
        .join(' ');
      fallbacks.push(`${claim.institution_mentioned} ${topicWords}`);
    }
    
    const topicOnly = claim.query.split(' ')
      .filter(w => w.length > 3)
      .slice(0, 4)
      .join(' ');
    if (topicOnly !== claim.query) {
      fallbacks.push(topicOnly);
    }
    
    return fallbacks.slice(0, 3);
  }
  
  private isSponsorContent(chunk: string): boolean {
    const lower = chunk.toLowerCase();
    return SPONSOR_SIGNALS.some(signal => lower.includes(signal));
  }
}

// Export singleton instance
export const liveModeExtractor = new LiveModeExtractor();

