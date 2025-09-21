import OpenAI from 'openai';
import { AI_CONFIG } from '../lib/ai-config.js';
import { CostTracker } from './cost-tracker.js';
import { RetryHandler, CircuitBreaker } from './retry-handler.js';
import { StudyLinker } from './study-linker.js';
import { GPTError, FactCheckResult, FactCheckAnalysis, Claim, Source, GPTErrorCode } from '../lib/ai-types.js';

/**
 * GPT-4 Fact-Checking Service
 * Analyzes transcriptions for factual claims and provides fact-checking analysis
 */
export class FactChecker {
  private openai: OpenAI;
  private costTracker: CostTracker;
  private gptCircuitBreaker: CircuitBreaker;
  private studyLinker: StudyLinker;

  constructor(costTracker: CostTracker) {
    const openaiConfig: any = {
      apiKey: AI_CONFIG.openai.apiKey,
    };
    
    if (AI_CONFIG.openai.organization) {
      openaiConfig.organization = AI_CONFIG.openai.organization;
    }
    
    this.openai = new OpenAI(openaiConfig);
    this.costTracker = costTracker;
    this.gptCircuitBreaker = new CircuitBreaker(
      3, // failure threshold
      60000, // 1 minute timeout
      2 // success threshold
    );
    this.studyLinker = new StudyLinker({
      maxResults: 3,
      includeAbstracts: true,
      minCredibility: 'medium'
    });
  }

  /**
   * Analyze transcription for factual claims and fact-check them
   */
  async analyzeTranscription(transcription: string, videoId: string): Promise<FactCheckResult> {
    try {
      console.log(`🔍 Starting fact-check analysis for video ${videoId}`);
      
      const result = await RetryHandler.withRetry(
        () => this.performFactCheck(transcription, videoId),
        3,
        1000
      );

      return result;
    } catch (error) {
      console.error('❌ Fact-check analysis failed:', error);
      throw new GPTError(
        `Fact-check analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'GPT_ERROR' as GPTErrorCode,
        true
      );
    }
  }

  /**
   * Perform the actual fact-checking using GPT-4
   */
  private async performFactCheck(transcription: string, videoId: string): Promise<FactCheckResult> {
    return await RetryHandler.withCircuitBreaker(
      async () => {
        const startTime = Date.now();
        
        try {
          const response = await this.openai.chat.completions.create({
            model: AI_CONFIG.gpt.model,
            messages: [
              {
                role: 'system',
                content: this.getSystemPrompt()
              },
              {
                role: 'user',
                content: `Please analyze the following transcription for factual claims and provide a comprehensive fact-checking analysis:\n\n${transcription}`
              }
            ],
            temperature: 0.3,
            max_tokens: 4000
          });

          const duration = Date.now() - startTime;
          const cost = this.calculateGPTCost(response.usage?.total_tokens || 0);
          
          // Track cost
          this.costTracker.trackGPTCost(response.usage?.prompt_tokens || 0, response.usage?.completion_tokens || 0);
          
          console.log(`✅ GPT-4 fact-check completed in ${duration}ms, cost: $${cost.toFixed(4)}`);

          const content = response.choices[0]?.message?.content;
          if (!content) {
            throw new Error('No response content from GPT-4');
          }

          return await this.parseFactCheckResponse(content, videoId, cost);
        } catch (error) {
          const duration = Date.now() - startTime;
          console.error(`❌ GPT-4 fact-check failed after ${duration}ms:`, error);
          throw error;
        }
      },
      this.gptCircuitBreaker
    );
  }

  /**
   * Get the system prompt for fact-checking
   */
  private getSystemPrompt(): string {
    return `You are an expert fact-checker and researcher. Your task is to analyze transcriptions for factual claims and provide a comprehensive fact-checking analysis.

IMPORTANT INSTRUCTIONS:
1. Identify specific factual claims made in the transcription
2. For each claim, determine if it's verifiable, partially verifiable, or unverifiable
3. Provide evidence-based analysis for each claim
4. Rate the overall credibility of the content
5. Suggest sources for verification when possible

RESPONSE FORMAT:
Return a JSON object with the following structure:
{
  "overallCredibility": "high|medium|low",
  "confidence": 0.0-1.0,
  "claims": [
    {
      "text": "exact quote from transcription",
      "type": "factual|opinion|speculation|anecdotal",
      "verifiability": "verifiable|partially_verifiable|unverifiable",
      "credibility": "high|medium|low",
      "analysis": "detailed analysis of the claim",
      "sources": ["suggested source 1", "suggested source 2"],
      "timestamp": "approximate time in transcription"
    }
  ],
  "summary": "overall summary of fact-checking findings",
  "recommendations": ["recommendation 1", "recommendation 2"]
}

Be thorough but concise. Focus on claims that are most likely to be factually incorrect or misleading.`;
  }

  /**
   * Parse GPT-4 response into structured fact-check result
   */
  private async parseFactCheckResponse(content: string, videoId: string, cost: number): Promise<FactCheckResult> {
    try {
      // Extract JSON from response (handle cases where GPT adds extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in GPT response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      // Process claims and find studies for each
      const claims: Claim[] = [];
      const allSources: Source[] = [];
      
      if (parsed.claims && Array.isArray(parsed.claims)) {
        for (const claimData of parsed.claims) {
          console.log(`🔍 Finding studies for claim: "${claimData.text?.substring(0, 50)}..."`);
          
          // Find studies for this specific claim
          const claimSources = await this.studyLinker.findStudiesForClaim(
            claimData.text || '',
            claimData.analysis || ''
          );
          
          // Convert string sources to Source objects if they exist
          const stringSources = claimData.sources || [];
          const convertedSources: Source[] = stringSources.map((source: string) => ({
            title: source,
            url: '',
            credibility: 'medium' as const,
            type: 'other' as const
          }));
          
          // Combine found studies with suggested sources
          const combinedSources = [...claimSources, ...convertedSources];
          allSources.push(...combinedSources);
          
          claims.push({
            text: claimData.text || '',
            type: claimData.type || 'factual',
            verifiability: claimData.verifiability || 'unverifiable',
            credibility: claimData.credibility || 'medium',
            analysis: claimData.analysis || '',
            sources: combinedSources,
            timestamp: claimData.timestamp || new Date().toISOString()
          });
        }
      }
      
      return {
        videoId,
        overallCredibility: parsed.overallCredibility || 'medium',
        confidence: parsed.confidence || 0.5,
        claims,
        summary: parsed.summary || 'No summary provided',
        recommendations: parsed.recommendations || [],
        analysis: {
          totalClaims: claims.length,
          verifiableClaims: claims.filter(c => c.verifiability === 'verifiable').length,
          highCredibilityClaims: claims.filter(c => c.credibility === 'high').length,
          sources: allSources
        },
        cost,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Failed to parse GPT response:', error);
      
      // Return fallback result
      return {
        videoId,
        overallCredibility: 'low',
        confidence: 0.0,
        claims: [],
        summary: 'Failed to parse fact-check analysis',
        recommendations: ['Manual review recommended'],
        analysis: {
          totalClaims: 0,
          verifiableClaims: 0,
          highCredibilityClaims: 0,
          sources: []
        },
        cost,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Calculate GPT-4 cost based on token usage
   */
  private calculateGPTCost(tokens: number): number {
    // GPT-4 pricing: $0.03 per 1K input tokens, $0.06 per 1K output tokens
    // Using average of input/output for estimation
    const costPerToken = 0.045 / 1000; // $0.045 per 1K tokens
    return tokens * costPerToken;
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(): string {
    return this.gptCircuitBreaker.getState();
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.gptCircuitBreaker.reset();
  }
}
