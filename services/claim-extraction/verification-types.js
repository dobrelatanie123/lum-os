/**
 * Verification Pipeline Types
 * Types for academic search, scoring, and claim verification
 */
export const DEFAULT_VERIFICATION_CONFIG = {
    max_search_attempts: 3,
    min_match_score: 0.4,
    use_semantic_scholar: true,
    use_pubmed: true,
    use_google: true
};
