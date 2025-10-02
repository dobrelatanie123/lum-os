import OpenAI from 'openai';
import { AI_CONFIG } from '../lib/ai-config.js';
import { StudySearchResult } from './study-linker.js';
import { Source } from '../lib/ai-types.js';

/**
 * Academic Analyzer Service
 * Uses GPT to analyze academic search results and extract relevant sources
 */
export class AcademicAnalyzerService {
  private openai: OpenAI;

  constructor() {
    const openaiConfig: any = {
      apiKey: AI_CONFIG.openai.apiKey,
    };
    
    if (AI_CONFIG.openai.organization) {
      openaiConfig.organization = AI_CONFIG.openai.organization;
    }
    
    this.openai = new OpenAI(openaiConfig);
  }

  /**
   * Analyze academic search results and extract relevant sources for a claim
   */
  async analyzeAcademicResults(claim: string, searchResults: StudySearchResult[]): Promise<Source[]> {
    try {
      console.log(`🔍 Analyzing ${searchResults.length} academic results for claim: "${claim.substring(0, 50)}..."`);
      
      const response = await this.openai.chat.completions.create({
        model: 'o1-preview',
        messages: [
          {
            role: 'system',
            content: `You are an expert academic researcher. Your task is to analyze search results and identify the most relevant academic sources for a specific claim.

IMPORTANT INSTRUCTIONS:
1. Review the provided academic search results
2. Identify which sources are most relevant to the claim
3. Extract the most credible and directly relevant sources
4. Return only sources that actually exist and are accessible
5. Focus on academic papers, studies, and credible sources
6. Limit to the top 3-5 most relevant sources

RESPONSE FORMAT:
Return a JSON array of sources in this exact format:
[
  {
    "title": "exact title from the search result",
    "url": "exact URL from the search result",
    "credibility": "high|medium|low",
    "type": "academic|news|government|expert|other"
  }
]

CRITICAL: 
- ONLY use sources that are provided in the search results
- Do NOT make up, generate, or hallucinate any sources
- If no relevant sources are found, return an empty array
- Only return sources with valid, non-empty URLs`
          },
          {
            role: 'user',
            content: `Claim to analyze: "${claim}"

Academic search results:
${JSON.stringify(searchResults, null, 2)}

Please identify the most relevant academic sources for this claim.`
          }
        ],
        temperature: 0.1,
        max_tokens: 2000
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response content from GPT');
      }

      // Parse the JSON response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.warn('⚠️ No valid JSON found in GPT response, using fallback');
        return this.createFallbackSources(searchResults);
      }

      const sources = JSON.parse(jsonMatch[0]);
      console.log(`✅ Extracted ${sources.length} relevant sources`);
      
      return sources;

    } catch (error) {
      console.error('❌ Academic analysis failed:', error);
      return this.createFallbackSources(searchResults);
    }
  }

  /**
   * Create fallback sources when analysis fails
   */
  private createFallbackSources(searchResults: StudySearchResult[]): Source[] {
    return searchResults.slice(0, 3).map(result => ({
      title: result.title,
      url: result.url,
      credibility: result.credibility,
      type: result.type
    }));
  }
}
