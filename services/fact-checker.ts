import OpenAI from 'openai';
import { AI_CONFIG } from '../lib/ai-config.js';
import { CostTracker } from './cost-tracker.js';
import { RetryHandler, CircuitBreaker } from './retry-handler.js';
import { AcademicSearchService } from './academic-search.js';
import { AcademicAnalyzerService } from './academic-analyzer.js';
import { ClaimBuilder, type CanonicalClaim } from './claim-builder.js';
import { GPTError, FactCheckResult, FactCheckAnalysis, Claim, Source, GPTErrorCode } from '../lib/ai-types.js';

/**
 * GPT-4 Fact-Checking Service
 * Analyzes transcriptions for factual claims and provides fact-checking analysis
 */
export class FactChecker {
  private openai: OpenAI;
  private costTracker: CostTracker;
  private gptCircuitBreaker: CircuitBreaker;
  private academicSearch: AcademicSearchService;
  private academicAnalyzer: AcademicAnalyzerService;
  private claimBuilder: ClaimBuilder;

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
    this.academicSearch = new AcademicSearchService();
    this.academicAnalyzer = new AcademicAnalyzerService();
    this.claimBuilder = new ClaimBuilder();
  }

  /**
   * Analyze transcription for factual claims and fact-check them
   */
  async analyzeTranscription(transcription: string, videoId: string): Promise<FactCheckResult> {
    try {
      console.log(`🔍 Starting fact-check analysis for video ${videoId}`);
      // Reset context buffer for this videoId at the beginning of analysis
      try { (this.claimBuilder as any).resetContext?.(videoId); } catch {}
      
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
   * Perform the actual fact-checking using GPT (Responses API with web_search, fallback to chat.completions)
   */
  private async performFactCheck(transcription: string, videoId: string): Promise<FactCheckResult> {
    return await RetryHandler.withCircuitBreaker(
      async () => {
        const startTime = Date.now();
        
        try {
          // Preferred path: Responses API with web_search tool on GPT-5
          const input = `${this.getSystemPrompt()}\n\nUSER TASK:\nPlease analyze the following transcription for factual claims and provide a comprehensive fact-checking analysis. Use only real, verifiable sources found via web search. If you cannot verify a source, leave sources empty.\n\nTRANSCRIPTION:\n${transcription}`;

          const respAny: any = await (this.openai as any).responses.create({
            model: 'gpt-5',
            tools: [ { type: 'web_search' } ],
            input,
            // temperature not supported by this model in Responses API
            max_output_tokens: 4000
          });

          const duration = Date.now() - startTime;
          const totalTokens: number = (respAny.usage?.total_tokens)
            || ((respAny.usage?.input_tokens || 0) + (respAny.usage?.output_tokens || 0))
            || 0;
          const promptTokens: number = (respAny.usage?.input_tokens) || (respAny.usage?.prompt_tokens) || 0;
          const completionTokens: number = (respAny.usage?.output_tokens) || (respAny.usage?.completion_tokens) || 0;
          const cost = this.calculateGPTCost(totalTokens);

          // Track cost using whichever fields are available
          this.costTracker.trackGPTCost(promptTokens, completionTokens);

          const content: string = respAny.output_text
            || (respAny.output?.[0]?.content?.[0]?.text?.value)
            || '';

          if (!content) {
            throw new Error('No response content from GPT-5 (Responses API)');
          }

          console.log(`✅ GPT-5 (responses) fact-check completed in ${duration}ms, cost: $${cost.toFixed(4)}`);
          return await this.parseFactCheckResponse(content, videoId, cost);
        } catch (primaryError) {
          // Fallback: legacy Chat Completions (gpt-4o)
          console.warn('⚠️ Falling back to chat.completions due to Responses API error:', (primaryError as Error)?.message || primaryError);
          try {
            const response = await this.openai.chat.completions.create({
              model: 'gpt-4o',
              messages: [
                { role: 'system', content: this.getSystemPrompt() },
                { role: 'user', content: `Please analyze the following transcription for factual claims and provide a comprehensive fact-checking analysis. Use only real, verifiable sources. If you cannot verify a source, leave sources empty.\n\n${transcription}` }
              ],
              temperature: 0.3,
              max_tokens: 4000
            });

            const duration = Date.now() - startTime;
            const cost = this.calculateGPTCost(response.usage?.total_tokens || 0);
            this.costTracker.trackGPTCost(response.usage?.prompt_tokens || 0, response.usage?.completion_tokens || 0);

            console.log(`✅ GPT-4o (fallback) fact-check completed in ${duration}ms, cost: $${cost.toFixed(4)}`);
            const content = response.choices[0]?.message?.content || '';
            if (!content) throw new Error('No response content from fallback model');
            return await this.parseFactCheckResponse(content, videoId, cost);
          } catch (fallbackError) {
            const duration = Date.now() - startTime;
            console.error(`❌ Fact-check failed after ${duration}ms (both paths):`, fallbackError);
            throw fallbackError;
          }
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
5. Use web search to find real academic sources and studies that support or refute the claims
6. Only include sources that you can verify exist and are accessible through web search

RESPONSE FORMAT (OUTPUT ONLY JSON, NO PROSE, NO MARKDOWN):
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
      "sources": [
        {
          "title": "actual study title or source name",
          "url": "real URL to the study or source",
          "credibility": "high|medium|low",
          "type": "academic|news|government|expert|other"
        }
      ],
      "timestamp": "approximate time in transcription"
    }
  ],
  "summary": "overall summary of fact-checking findings",
  "recommendations": ["recommendation 1", "recommendation 2"]
}

Be thorough but concise. Only return the JSON object and nothing else.`;
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

      // Harden JSON extraction: support fenced blocks and loose prose
      let jsonText = content;
      const fenced = content.match(/```json[\s\S]*?```/i) || content.match(/```[\s\S]*?```/);
      if (fenced) {
        jsonText = fenced[0].replace(/```json|```/gi, '').trim();
      }
      const jsonMatch2 = jsonText.match(/\{[\s\S]*\}/);
      if (!jsonMatch2) {
        throw new Error('No JSON found in GPT response');
      }
      const parsed = JSON.parse(jsonMatch2[0]);
      
      // Process claims and find studies for each
      const claims: Claim[] = [];
      const allSources: Source[] = [];
      
      if (parsed.claims && Array.isArray(parsed.claims)) {
        for (const claimData of parsed.claims) {
          console.log(`🔍 Finding studies for claim: "${claimData.text?.substring(0, 50)}..."`);
          
          // Use GPT's web search results directly
          console.log(`🔍 Using GPT web search results for claim: "${claimData.text?.substring(0, 50)}..."`);
          
          // Keep only valid, http(s) URLs from GPT output
          let combinedSources: Source[] = (claimData.sources || [])
            .filter((s: any) => s && typeof s.url === 'string' && /^https?:\/\//.test(s.url))
            .map((s: any) => ({
              title: s.title || 'Source',
              url: s.url,
              credibility: (s.credibility as 'high' | 'medium' | 'low') || 'medium',
              type: (s.type as 'academic' | 'news' | 'government' | 'expert' | 'other') || 'other'
            }));

          // Fallback: if GPT didn't return usable URLs, canonicalize claim and perform academic search (top 10) and select best
          if (combinedSources.length === 0) {
              try {
              console.log('⚠️ No valid URLs from GPT; falling back to academic search…');
              const span = `${claimData.text || ''} ${claimData.analysis || ''}`.trim().slice(0, 400);
              let boostedQuery = span;
              try {
                const canonical: CanonicalClaim | null = await this.claimBuilder.canonicalizeSpan(span, undefined, videoId);
                if (canonical) {
                  boostedQuery = this.claimBuilder.buildBoostedQuery(canonical);
                }
              } catch {}
              const searchResults = await this.academicSearch.searchAcademicPapers(boostedQuery, 10);

              // Ask GPT to select from provided results (never invent)
              const analyzed = await this.academicAnalyzer.analyzeAcademicResults(
                claimData.text || '',
                searchResults
              );

              combinedSources = (analyzed || [])
                .filter((s: any) => s && typeof s.url === 'string' && /^https?:\/\//.test(s.url))
                .slice(0, 3);
            } catch (fallbackError) {
              console.warn('⚠️ Academic fallback failed:', fallbackError);
              combinedSources = [];
            }
          }
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
