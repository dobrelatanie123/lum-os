/**
 * Full Mode Claim Extractor
 * Processes complete transcripts in a single pass
 */

import OpenAI from 'openai';
import { FULL_MODE_SYSTEM_PROMPT } from './prompts.js';
import { normalizeAuthor } from './author-normalization.js';
import type { ExtractedClaim, SynthesizedClaim, NormalizedAuthor } from './types.js';

// Lazy-init OpenAI client (env must be loaded first)
let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

export class FullModeExtractor {
  
  /**
   * Extract and synthesize claims from a complete transcript
   */
  async extract(videoId: string, transcript: string): Promise<SynthesizedClaim[]> {
    console.log(`🔍 Extracting claims from ${videoId} (${transcript.split(' ').length} words)`);
    
    // Step 1: Call LLM to extract raw claims
    const extracted = await this.callLLM(transcript);
    console.log(`📋 Found ${extracted.length} raw claims`);
    
    // Step 2: Synthesize claims with normalized authors and search queries
    const synthesized = extracted.map((claim, idx) => 
      this.synthesizeClaim(claim, videoId, idx)
    );
    
    return synthesized;
  }
  
  /**
   * Call OpenAI to extract claims from transcript
   */
  private async callLLM(transcript: string): Promise<ExtractedClaim[]> {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: FULL_MODE_SYSTEM_PROMPT },
          { role: 'user', content: `Extract claims from this transcript:\n\n${transcript}` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1  // Low temperature for consistent extraction
      });
      
      const content = response.choices[0].message.content;
      const parsed = JSON.parse(content || '{"claims": []}');
      return parsed.claims || [];
    } catch (error) {
      console.error('❌ LLM call failed:', error);
      return [];
    }
  }
  
  /**
   * Transform extracted claim into synthesized claim with search queries
   */
  private synthesizeClaim(
    claim: ExtractedClaim, 
    videoId: string, 
    index: number
  ): SynthesizedClaim {
    const normalized = normalizeAuthor(claim.author_mentioned);
    
    return {
      claim_id: `${videoId}_claim_${index}`,
      video_id: videoId,
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
        primary_query: this.buildPrimaryQuery(claim, normalized.normalized),
        fallback_queries: this.buildFallbackQueries(claim, normalized)
      },
      created_at: new Date().toISOString()
    };
  }
  
  /**
   * Build primary search query (author-first if available)
   */
  private buildPrimaryQuery(claim: ExtractedClaim, normalizedAuthor: string | null): string {
    if (normalizedAuthor) {
      // Author-based query: surname + topic words from original query
      const surname = normalizedAuthor.split(' ').pop();
      const topicWords = claim.query.split(' ').slice(0, 3).join(' ');
      return `${surname} ${topicWords}`;
    }
    return claim.query;
  }
  
  /**
   * Build fallback search queries for when primary fails
   */
  private buildFallbackQueries(claim: ExtractedClaim, normalized: NormalizedAuthor): string[] {
    const fallbacks: string[] = [];
    
    // Add variant spellings as fallback queries
    if (normalized.variants.length > 0 && normalized.normalized) {
      const surname = normalized.normalized.split(' ').pop() || '';
      for (const variant of normalized.variants.slice(0, 2)) {
        if (variant.toLowerCase() !== surname.toLowerCase()) {
          fallbacks.push(claim.query.replace(new RegExp(surname, 'i'), variant));
        }
      }
    }
    
    // Add institution-based fallback
    if (claim.institution_mentioned) {
      const topicWords = claim.query.split(' ')
        .filter(w => !w.toLowerCase().includes((normalized.normalized?.split(' ').pop() || 'xxxxx').toLowerCase()))
        .slice(0, 2)
        .join(' ');
      fallbacks.push(`${claim.institution_mentioned} ${topicWords}`);
    }
    
    // Add topic-only fallback (no author)
    const topicOnly = claim.query.split(' ')
      .filter(w => w.length > 3)
      .slice(0, 4)
      .join(' ');
    if (topicOnly !== claim.query) {
      fallbacks.push(topicOnly);
    }
    
    return fallbacks.slice(0, 3);  // Max 3 fallbacks
  }
}

// Export singleton instance
export const fullModeExtractor = new FullModeExtractor();

