/**
 * Claim Deduplicator
 * Prevents duplicate claims across overlapping windows in live mode
 */

import type { ExtractedClaim, RecentClaimSummary } from './types.js';

interface ClaimRecord {
  author_normalized: string | null;
  query: string;
  finding_hash: string;
  window: number;
}

export class ClaimDeduplicator {
  private recent: ClaimRecord[] = [];
  private readonly TTL_WINDOWS = 10;           // Keep claims for 10 windows
  private readonly SIMILARITY_THRESHOLD = 0.7; // Jaccard similarity threshold
  
  /**
   * Check if a claim is a duplicate of a recent claim
   */
  isDuplicate(claim: ExtractedClaim, currentWindow: number): boolean {
    // Clean old claims
    this.recent = this.recent.filter(r => currentWindow - r.window < this.TTL_WINDOWS);
    
    const newAuthor = this.normalizeForCompare(claim.author_mentioned);
    const newHash = this.hashFinding(claim.finding_summary);
    
    for (const existing of this.recent) {
      // Same author + overlapping topic = duplicate
      if (newAuthor && existing.author_normalized === newAuthor) {
        if (this.topicOverlap(existing.query, claim.query)) {
          return true;
        }
      }
      
      // High query similarity = duplicate
      if (this.similarity(existing.query, claim.query) > this.SIMILARITY_THRESHOLD) {
        return true;
      }
      
      // Same finding hash = duplicate
      if (existing.finding_hash === newHash) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Add a claim to the recent claims list
   */
  add(claim: ExtractedClaim, window: number): void {
    this.recent.push({
      author_normalized: this.normalizeForCompare(claim.author_mentioned),
      query: claim.query,
      finding_hash: this.hashFinding(claim.finding_summary),
      window
    });
  }
  
  /**
   * Get recent claim summaries for LLM context
   */
  getRecentSummaries(): RecentClaimSummary[] {
    return this.recent.slice(-5).map(r => ({
      window: r.window,
      author: r.author_normalized,
      topic: r.query.split(' ').slice(0, 2).join(' ')
    }));
  }
  
  /**
   * Clear all recent claims (e.g., new session)
   */
  clear(): void {
    this.recent = [];
  }
  
  /**
   * Get stats for debugging
   */
  getStats(): { total: number; oldest: number | null; newest: number | null } {
    return {
      total: this.recent.length,
      oldest: this.recent[0]?.window ?? null,
      newest: this.recent[this.recent.length - 1]?.window ?? null
    };
  }
  
  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────
  
  private normalizeForCompare(author: string | null): string | null {
    if (!author) return null;
    return author.toLowerCase().replace(/^(dr\.?|professor)\s*/i, '').trim();
  }
  
  private hashFinding(finding: string): string {
    // Create a simple hash from sorted significant words
    return finding.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(' ')
      .filter(w => w.length > 3)
      .sort()
      .slice(0, 8)
      .join('');
  }
  
  private similarity(a: string, b: string): number {
    // Jaccard similarity of word sets
    const setA = new Set(a.toLowerCase().split(' '));
    const setB = new Set(b.toLowerCase().split(' '));
    const intersection = [...setA].filter(x => setB.has(x));
    const union = new Set([...setA, ...setB]);
    return intersection.length / union.size;
  }
  
  private topicOverlap(a: string, b: string): boolean {
    // Check if queries share 2+ significant words
    const wordsA = a.toLowerCase().split(' ').filter(w => w.length > 3);
    const wordsB = b.toLowerCase().split(' ').filter(w => w.length > 3);
    const overlap = wordsA.filter(w => wordsB.includes(w));
    return overlap.length >= 2;
  }
}

