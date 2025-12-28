/**
 * Claim Extraction Module
 * 
 * NEW: Gemini 3 Flash - Direct YouTube URL processing (recommended)
 * Phase 1: Full Mode - Process complete transcripts
 * Phase 2: Live Mode - Process streaming chunks
 * Phase 3: Verification - Search and verify claims
 */

export * from './types.js';
export * from './author-normalization.js';
export * from './prompts.js';

// Gemini 3 Flash - Direct YouTube URL processing (10x cheaper!)
export { GeminiExtractor, geminiExtractor, type GeminiSynthesizedClaim } from './gemini-extractor.js';

// Legacy extractors (kept for fallback/testing)
export { FullModeExtractor, fullModeExtractor } from './full-mode.js';
export { LiveModeExtractor, liveModeExtractor } from './live-mode.js';
export { RollingBuffer } from './rolling-buffer.js';
export { ClaimDeduplicator } from './deduplicator.js';

// Phase 3: Verification
export * from './verification-types.js';
export { AcademicSearcher, academicSearcher } from './academic-searcher.js';
export { PaperFinder, paperFinder } from './paper-finder.js';
export { MatchScorer, matchScorer } from './match-scorer.js';
export { ClaimVerifier, claimVerifier } from './claim-verifier.js';
export { VerificationPipeline, verificationPipeline } from './verification-pipeline.js';

