/**
 * Verification Pipeline Types
 * Types for academic search, scoring, and claim verification
 */

import type { SynthesizedClaim } from './types.js';

// ============ SEARCH RESULTS ============

export interface PaperResult {
  paper_id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;         // Journal/conference
  abstract: string | null;
  url: string;
  doi: string | null;
  citation_count: number | null;
  source: 'semantic_scholar' | 'pubmed' | 'google' | 'openalex';
}

export interface SearchAttempt {
  query: string;
  source: string;
  results_count: number;
  top_result: PaperResult | null;
}

// ============ MATCH SCORING ============

export interface MatchScore {
  author_score: number;       // 0-1: How well authors match
  topic_score: number;        // 0-1: Topic/keyword overlap
  year_score: number;         // 0-1: Publication year plausibility
  abstract_score: number;     // 0-1: Abstract relevance (if available)
  total_score: number;        // Weighted average
  match_quality: 'strong' | 'moderate' | 'weak' | 'none';
}

export interface ScoredPaper extends PaperResult {
  match_score: MatchScore;
}

// ============ VERIFICATION RESULT ============

export type VerificationVerdict = 
  | 'supported'      // Paper supports the claim
  | 'partially_supported'  // Some aspects supported
  | 'contradicted'   // Paper contradicts the claim
  | 'unverifiable'   // Cannot determine from abstract
  | 'no_paper_found'; // No relevant paper found

export interface VerificationResult {
  verdict: VerificationVerdict;
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
  key_differences?: string[];   // If contradicted/partial
  matching_details?: string[];  // If supported
}

// ============ VERIFIED CLAIM ============

export interface VerifiedClaim extends SynthesizedClaim {
  verification: {
    status: 'verified' | 'pending' | 'failed';
    attempts: SearchAttempt[];
    best_paper: ScoredPaper | null;
    result: VerificationResult | null;
    verified_at: string | null;
  };
}

// ============ PIPELINE CONFIG ============

export interface VerificationConfig {
  max_search_attempts: number;
  min_match_score: number;
  use_semantic_scholar: boolean;
  use_pubmed: boolean;
  use_google: boolean;
}

export const DEFAULT_VERIFICATION_CONFIG: VerificationConfig = {
  max_search_attempts: 3,
  min_match_score: 0.4,
  use_semantic_scholar: true,
  use_pubmed: true,
  use_google: true
};

