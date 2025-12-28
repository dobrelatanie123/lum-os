/**
 * Claim Extraction Types
 * Shared types for Full Mode and Live Mode extraction
 */

// ============ EXTRACTED CLAIM (LLM Output) ============

export interface ExtractedClaim {
  segment: string;
  query: string;
  confidence: 'high' | 'medium' | 'low';
  author_mentioned: string | null;
  institution_mentioned: string | null;
  finding_summary: string;
}

// ============ SYNTHESIZED CLAIM (Final Output) ============

export interface SynthesizedClaim {
  claim_id: string;
  video_id: string;
  
  segment: {
    full_text: string;
    word_count: number;
  };
  
  extraction: {
    author_mentioned: string | null;
    author_normalized: string | null;
    author_variants: string[];
    institution_mentioned: string | null;
    finding_summary: string;
    confidence: 'high' | 'medium' | 'low';
  };
  
  search: {
    primary_query: string;
    fallback_queries: string[];
  };
  
  created_at?: string;
}

// ============ FULL MODE TYPES ============

export interface FullModeInput {
  mode: 'full';
  video_id: string;
  transcript: string;
}

export interface FullModeOutput {
  video_id: string;
  claims: ExtractedClaim[];
}

// ============ LIVE MODE TYPES (Phase 2) ============

export interface LiveModeInput {
  mode: 'live';
  window_id: number;
  transcript: string;
  previous_pending: PendingClaim | null;
  recent_claims?: RecentClaimSummary[];
}

export interface LiveModeOutput {
  window_id: number;
  claims: ExtractedClaim[];
  pending: PendingClaim | null;
}

export interface PendingClaim {
  partial_segment: string;
  status: 'truncated_start' | 'truncated_end';
  has_attribution: boolean;
  has_finding: boolean;
  waiting_for: string;
}

export interface RecentClaimSummary {
  window: number;
  author: string | null;
  topic: string;
}

// Extended SynthesizedClaim for live mode
export interface LiveSynthesizedClaim extends SynthesizedClaim {
  detection: {
    started_window: number;
    completed_window: number;
    latency_windows: number;
  };
  segment: {
    full_text: string;
    word_count: number;
    approximate_timestamp_start: string;
    approximate_timestamp_end: string;
  };
}

// ============ AUTHOR NORMALIZATION ============

export interface NormalizedAuthor {
  normalized: string | null;
  variants: string[];
}

export interface KnownResearcher {
  full_name: string;
  variants: string[];
  institution?: string;
}

