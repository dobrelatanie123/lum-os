/**
 * Claim Verifier
 * Uses LLM to compare claim against paper abstract
 */

import OpenAI from 'openai';
import type { SynthesizedClaim } from './types.js';
import type { ScoredPaper, VerificationResult, VerificationVerdict } from './verification-types.js';

// Lazy-init OpenAI client
let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

const VERIFICATION_SYSTEM_PROMPT = `
You are a scientific claim verification system. Your job is to compare a claim made in a podcast against a research paper abstract to determine if the paper supports the claim.

## YOUR TASK

Compare the CLAIM against the PAPER ABSTRACT and determine:
1. Does this paper support the claim?
2. Are there any key differences or nuances?
3. How confident are you in this assessment?

## VERDICTS

- supported: The paper clearly supports the claim as stated
- partially_supported: The paper supports some aspects but with important caveats/differences
- contradicted: The paper's findings contradict the claim
- unverifiable: Cannot determine from the abstract alone (need full paper or abstract is too vague)

## CONFIDENCE LEVELS

- high: Abstract clearly addresses the claim topic with explicit findings
- medium: Abstract is relevant but findings require some interpretation
- low: Abstract is tangentially related or lacks specific findings

## OUTPUT FORMAT

Return valid JSON only:
{
  "verdict": "supported|partially_supported|contradicted|unverifiable",
  "confidence": "high|medium|low",
  "explanation": "2-3 sentence explanation of your assessment",
  "matching_details": ["detail 1", "detail 2"],  // if supported/partial
  "key_differences": ["difference 1", "difference 2"]  // if contradicted/partial
}
`;

export class ClaimVerifier {
  
  /**
   * Verify a claim against a paper
   */
  async verify(claim: SynthesizedClaim, paper: ScoredPaper): Promise<VerificationResult> {
    // If no abstract, we can't verify with LLM
    if (!paper.abstract) {
      return {
        verdict: 'unverifiable',
        confidence: 'low',
        explanation: `Paper "${paper.title}" was found but no abstract is available for verification.`
      };
    }
    
    try {
      const userMessage = this.buildUserMessage(claim, paper);
      
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: VERIFICATION_SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      });
      
      const content = response.choices[0].message.content;
      const parsed = JSON.parse(content || '{}');
      
      return {
        verdict: this.validateVerdict(parsed.verdict),
        confidence: this.validateConfidence(parsed.confidence),
        explanation: parsed.explanation || 'No explanation provided',
        matching_details: parsed.matching_details,
        key_differences: parsed.key_differences
      };
      
    } catch (error) {
      console.error('❌ Verification LLM call failed:', error);
      return {
        verdict: 'unverifiable',
        confidence: 'low',
        explanation: 'Verification failed due to an error.'
      };
    }
  }
  
  /**
   * Quick check if paper is likely relevant (before full verification)
   */
  isLikelyRelevant(paper: ScoredPaper, minScore: number = 0.4): boolean {
    return paper.match_score.total_score >= minScore &&
           paper.match_score.match_quality !== 'none';
  }
  
  private buildUserMessage(claim: SynthesizedClaim, paper: ScoredPaper): string {
    return `
## CLAIM (from podcast)

Speaker said: "${claim.segment.full_text}"

Claimed finding: ${claim.extraction.finding_summary}
${claim.extraction.author_mentioned ? `Attributed to: ${claim.extraction.author_mentioned}` : 'No specific author mentioned'}
${claim.extraction.institution_mentioned ? `Institution: ${claim.extraction.institution_mentioned}` : ''}

## PAPER FOUND

Title: ${paper.title}
Authors: ${paper.authors.join(', ')}
Year: ${paper.year || 'Unknown'}
Venue: ${paper.venue || 'Unknown'}

Abstract:
${paper.abstract}

## MATCH QUALITY

Our automated scoring found:
- Author match: ${(paper.match_score.author_score * 100).toFixed(0)}%
- Topic match: ${(paper.match_score.topic_score * 100).toFixed(0)}%
- Overall: ${paper.match_score.match_quality}

Please verify if this paper supports the claim.
`;
  }
  
  private validateVerdict(verdict: any): VerificationVerdict {
    const valid: VerificationVerdict[] = ['supported', 'partially_supported', 'contradicted', 'unverifiable', 'no_paper_found'];
    return valid.includes(verdict) ? verdict : 'unverifiable';
  }
  
  private validateConfidence(confidence: any): 'high' | 'medium' | 'low' {
    const valid = ['high', 'medium', 'low'];
    return valid.includes(confidence) ? confidence : 'low';
  }
}

export const claimVerifier = new ClaimVerifier();

