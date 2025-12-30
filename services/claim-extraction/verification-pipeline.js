/**
 * Verification Pipeline
 * Orchestrates the full claim verification flow:
 * 1. Find papers (OpenAlex → Google+Scrape)
 * 2. Score matches
 * 3. Verify with LLM
 */
import { paperFinder } from './paper-finder.js';
import { matchScorer } from './match-scorer.js';
import { claimVerifier } from './claim-verifier.js';
export class VerificationPipeline {
    config;
    constructor(config = {}) {
        this.config = {
            max_search_attempts: 3,
            min_match_score: 0.4,
            use_semantic_scholar: true,
            use_pubmed: true,
            use_google: true,
            ...config
        };
    }
    /**
     * Verify a single claim
     */
    async verifyClaim(claim) {
        console.log(`🔍 Verifying claim: ${claim.claim_id}`);
        console.log(`   Author: ${claim.extraction.author_normalized || 'unnamed'}`);
        console.log(`   Finding: ${claim.extraction.finding_summary.slice(0, 60)}...`);
        // Step 1: Find best matching paper (OpenAlex → Google+Scrape)
        const { source, paper, attempts } = await paperFinder.find(claim);
        if (!paper) {
            console.log(`   ❌ No papers found`);
            return this.createVerifiedClaim(claim, attempts, null, {
                verdict: 'no_paper_found',
                confidence: 'high',
                explanation: 'No relevant academic papers were found for this claim.'
            });
        }
        // Step 2: Score the found paper
        const scoredPaper = matchScorer.rankPapers([paper], claim)[0];
        console.log(`   Best match: "${scoredPaper.title.slice(0, 50)}..." (${scoredPaper.match_score.match_quality})`);
        // Step 3: Check if paper is good enough
        if (!claimVerifier.isLikelyRelevant(scoredPaper, this.config.min_match_score)) {
            console.log(`   ⚠️ Paper below relevance threshold`);
            return this.createVerifiedClaim(claim, attempts, scoredPaper, {
                verdict: 'unverifiable',
                confidence: 'low',
                explanation: `Found paper "${scoredPaper.title}" but match quality is ${scoredPaper.match_score.match_quality} (score: ${scoredPaper.match_score.total_score.toFixed(2)}).`
            });
        }
        // Step 4: Verify with LLM
        console.log(`   🤖 Verifying claim against abstract...`);
        const result = await claimVerifier.verify(claim, scoredPaper);
        console.log(`   Verdict: ${result.verdict} (${result.confidence})`);
        return this.createVerifiedClaim(claim, attempts, scoredPaper, result);
    }
    /**
     * Verify multiple claims
     */
    async verifyAll(claims) {
        const results = [];
        for (const claim of claims) {
            const verified = await this.verifyClaim(claim);
            results.push(verified);
            // Small delay to avoid rate limiting
            await this.delay(500);
        }
        return results;
    }
    /**
     * Get verification summary stats
     */
    summarize(claims) {
        return {
            total: claims.length,
            supported: claims.filter(c => c.verification.result?.verdict === 'supported').length,
            partially_supported: claims.filter(c => c.verification.result?.verdict === 'partially_supported').length,
            contradicted: claims.filter(c => c.verification.result?.verdict === 'contradicted').length,
            unverifiable: claims.filter(c => c.verification.result?.verdict === 'unverifiable').length,
            no_paper_found: claims.filter(c => c.verification.result?.verdict === 'no_paper_found').length
        };
    }
    createVerifiedClaim(claim, attempts, bestPaper, result) {
        return {
            ...claim,
            verification: {
                status: result.verdict === 'no_paper_found' ? 'failed' : 'verified',
                attempts,
                best_paper: bestPaper,
                result,
                verified_at: new Date().toISOString()
            }
        };
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
export const verificationPipeline = new VerificationPipeline();
