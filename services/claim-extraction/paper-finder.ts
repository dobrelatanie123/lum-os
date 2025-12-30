/**
 * Hybrid Paper Finder
 * 1. OpenAlex (free, has abstracts, no rate limits)
 * 2. Google Custom Search + page scraping fallback
 */

import type { SynthesizedClaim } from './types.js';
import type { PaperResult, SearchAttempt } from './verification-types.js';
import { matchScorer } from './match-scorer.js';

const OPENALEX_API = 'https://api.openalex.org';

interface PaperSearchResult {
  source: 'openalex' | 'google' | null;
  paper: PaperResult | null;
  attempts: SearchAttempt[];
}

export class PaperFinder {
  private googleApiKey: string;
  private googleSearchEngineId: string;
  
  constructor() {
    this.googleApiKey = process.env.GOOGLE_SEARCH_API_KEY || '';
    this.googleSearchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID || '';
  }
  
  /**
   * Find the best matching paper for a claim
   */
  async find(claim: SynthesizedClaim): Promise<PaperSearchResult> {
    // Build multiple query strategies
    const queries = this.buildSearchQueries(claim);
    const attempts: SearchAttempt[] = [];
    console.log(`   📝 Trying ${queries.length} query strategies...`);
    
    for (const query of queries) {
      // 1. Try OpenAlex first (free, has abstracts, no rate limits)
      console.log(`   🔍 OpenAlex: "${query.slice(0, 50)}..."`);
      const openAlexResults = await this.searchOpenAlex(query, claim.extraction.author_normalized);
      
      attempts.push({
        query,
        source: 'openalex',
        results_count: openAlexResults.length,
        top_result: openAlexResults[0] || null
      });
      
      if (openAlexResults.length > 0) {
        const scored = matchScorer.rankPapers(openAlexResults, claim);
        const best = scored[0];
        
        if (best.match_score.total_score > 0.5) {
          console.log(`   ✅ Found via OpenAlex (score: ${best.match_score.total_score.toFixed(2)})`);
          return { source: 'openalex', paper: best, attempts };
        }
      }
      
      // 2. Fall back to Google Custom Search
      if (this.googleApiKey && this.googleSearchEngineId) {
        console.log(`   🔍 Google: "${query.slice(0, 40)}..."`);
        const googleResults = await this.searchGoogle(query);
        
        attempts.push({
          query,
          source: 'google',
          results_count: googleResults.length,
          top_result: googleResults[0] || null
        });
        
        if (googleResults.length > 0) {
          // 3. Scrape pages for abstracts
          const enriched = await this.enrichWithScraping(googleResults);
          
          if (enriched.length > 0) {
            const scored = matchScorer.rankPapers(enriched, claim);
            const best = scored[0];
            
            if (best.match_score.total_score > 0.4) {
              console.log(`   ✅ Found via Google+Scrape (score: ${best.match_score.total_score.toFixed(2)})`);
              return { source: 'google', paper: best, attempts };
            }
          }
        }
      }
    }
    
    console.log(`   ❌ No matching paper found`);
    return { source: null, paper: null, attempts };
  }
  
  // ─────────────────────────────────────────────────────────────
  // OpenAlex Search
  // ─────────────────────────────────────────────────────────────
  
  private async searchOpenAlex(query: string, authorName: string | null): Promise<PaperResult[]> {
    try {
      // Build search URL (query already cleaned by find())
      let searchUrl = `${OPENALEX_API}/works?search=${encodeURIComponent(query)}&per_page=5`;
      
      // Request polite pool (no rate limits with email)
      searchUrl += '&mailto=lumos@example.com';
      
      const response = await fetch(searchUrl, {
        headers: { 'Accept': 'application/json' }
      });
      
      if (!response.ok) {
        console.log(`   ⚠️ OpenAlex returned ${response.status}`);
        return [];
      }
      
      const data = await response.json();
      
      if (!data.results || data.results.length === 0) {
        return [];
      }
      
      return data.results.map((work: any) => ({
        paper_id: `oa_${work.id?.replace('https://openalex.org/', '')}`,
        title: work.title || 'Untitled',
        authors: (work.authorships || [])
          .map((a: any) => a.author?.display_name)
          .filter(Boolean),
        year: work.publication_year,
        venue: work.primary_location?.source?.display_name || null,
        abstract: this.reconstructAbstract(work.abstract_inverted_index),
        url: work.doi ? `https://doi.org/${work.doi.replace('https://doi.org/', '')}` : 
             work.primary_location?.landing_page_url || 
             `https://openalex.org/${work.id}`,
        doi: work.doi?.replace('https://doi.org/', '') || null,
        citation_count: work.cited_by_count,
        source: 'openalex' as const
      }));
      
    } catch (error) {
      console.error('   ❌ OpenAlex search failed:', error);
      return [];
    }
  }
  
  /**
   * Reconstruct abstract from OpenAlex inverted index format
   */
  private reconstructAbstract(invertedIndex: Record<string, number[]> | null): string | null {
    if (!invertedIndex) return null;
    
    const words: [string, number][] = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
      for (const pos of positions) {
        words.push([word, pos]);
      }
    }
    
    words.sort((a, b) => a[1] - b[1]);
    return words.map(w => w[0]).join(' ');
  }
  
  // ─────────────────────────────────────────────────────────────
  // Google Custom Search
  // ─────────────────────────────────────────────────────────────
  
  private async searchGoogle(query: string): Promise<PaperResult[]> {
    try {
      // Don't restrict sites - let Google rank naturally like manual search
      // Just add "study" or "research" to nudge towards academic results
      const fullQuery = `${query} study OR research`;
      
      const params = new URLSearchParams({
        key: this.googleApiKey,
        cx: this.googleSearchEngineId,
        q: fullQuery,
        num: '5'
      });
      
      const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
      
      if (!response.ok) {
        console.log(`   ⚠️ Google returned ${response.status}`);
        return [];
      }
      
      const data = await response.json();
      
      return (data.items || []).map((item: any, idx: number) => ({
        paper_id: `google_${idx}_${Date.now()}`,
        title: item.title || 'Untitled',
        authors: [],
        year: this.extractYearFromText(item.snippet || ''),
        venue: null,
        abstract: item.snippet || null,
        url: item.link,
        doi: this.extractDOI(item.link),
        citation_count: null,
        source: 'google' as const
      }));
      
    } catch (error) {
      console.error('   ❌ Google search failed:', error);
      return [];
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // Page Scraping
  // ─────────────────────────────────────────────────────────────
  
  private async enrichWithScraping(results: PaperResult[]): Promise<PaperResult[]> {
    const enriched: PaperResult[] = [];
    
    for (const result of results.slice(0, 3)) {
      try {
        const scraped = await this.scrapePage(result.url);
        if (scraped) {
          enriched.push({ ...result, ...scraped });
        } else {
          enriched.push(result); // Keep original if scraping fails
        }
      } catch {
        enriched.push(result);
      }
    }
    
    return enriched;
  }
  
  private async scrapePage(url: string): Promise<Partial<PaperResult> | null> {
    if (url.includes('pubmed.ncbi.nlm.nih.gov')) {
      return this.scrapePubMed(url);
    }
    if (url.includes('ncbi.nlm.nih.gov/pmc')) {
      return this.scrapePMC(url);
    }
    if (url.includes('researchgate.net')) {
      return this.scrapeResearchGate(url);
    }
    // Generic fallback - try to extract abstract from any page
    return this.scrapeGeneric(url);
  }
  
  private async scrapeGeneric(url: string): Promise<Partial<PaperResult> | null> {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LumosBot/1.0)' }
      });
      if (!response.ok) return null;
      
      const html = await response.text();
      
      // Try common abstract patterns
      const abstractPatterns = [
        /<meta[^>]*name="description"[^>]*content="([^"]+)"/i,
        /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i,
        /<div[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<section[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
        /<p[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
      ];
      
      for (const pattern of abstractPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          const abstract = match[1].replace(/<[^>]+>/g, '').trim();
          if (abstract.length > 50) {
            return { abstract };
          }
        }
      }
      
      return null;
    } catch {
      return null;
    }
  }
  
  private async scrapePubMed(url: string): Promise<Partial<PaperResult> | null> {
    try {
      // Extract PMID from URL
      const pmidMatch = url.match(/\/(\d+)\/?$/);
      if (!pmidMatch) return null;
      
      const pmid = pmidMatch[1];
      
      // Fetch abstract via efetch API
      const response = await fetch(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=text`
      );
      
      if (!response.ok) return null;
      
      const text = await response.text();
      
      // Parse the abstract text
      const abstractMatch = text.match(/Abstract\s*([\s\S]*?)(?:\n\n|$)/i);
      const authorsMatch = text.match(/Author information:[\s\S]*?\n\n([\s\S]*?)\n\n/);
      
      return {
        abstract: abstractMatch?.[1]?.trim() || text.slice(0, 1000),
        authors: authorsMatch ? this.parseAuthors(authorsMatch[1]) : []
      };
      
    } catch {
      return null;
    }
  }
  
  private async scrapePMC(url: string): Promise<Partial<PaperResult> | null> {
    try {
      // Extract PMC ID
      const pmcMatch = url.match(/PMC(\d+)/i);
      if (!pmcMatch) return null;
      
      const pmcid = pmcMatch[1];
      
      // Try to get abstract via PMC API
      const response = await fetch(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${pmcid}&rettype=abstract`
      );
      
      if (!response.ok) return null;
      
      const text = await response.text();
      return { abstract: text.slice(0, 2000) };
      
    } catch {
      return null;
    }
  }
  
  private async scrapeResearchGate(url: string): Promise<Partial<PaperResult> | null> {
    // ResearchGate blocks scraping, but we can try
    // For now, just return null and use Google snippet
    return null;
  }
  
  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  
  /**
   * Clean and deduplicate query words
   */
  /**
   * Build multiple search query strategies for better paper discovery
   */
  private buildSearchQueries(claim: SynthesizedClaim): string[] {
    const queries: string[] = [];
    const seen = new Set<string>();
    
    const addQuery = (q: string) => {
      const cleaned = this.cleanQuery(q);
      if (cleaned.length > 10 && !seen.has(cleaned)) {
        seen.add(cleaned);
        queries.push(cleaned);
      }
    };
    
    // Strategy 1: Original primary query from Gemini
    if (claim.search.primary_query) {
      addQuery(claim.search.primary_query);
    }
    
    // Strategy 2: Author + key terms from finding (if author exists)
    if (claim.extraction.author_normalized) {
      const keyTerms = this.extractKeyTerms(claim.extraction.finding_summary);
      addQuery(`${claim.extraction.author_normalized} ${keyTerms}`);
    }
    
    // Strategy 3: First 100 chars of finding summary (like user did manually!)
    const findingQuery = claim.extraction.finding_summary.slice(0, 100);
    addQuery(findingQuery);
    
    // Strategy 4: Institution + key terms (if institution exists)
    if (claim.extraction.institution_mentioned) {
      const keyTerms = this.extractKeyTerms(claim.extraction.finding_summary);
      addQuery(`${claim.extraction.institution_mentioned} ${keyTerms}`);
    }
    
    // Strategy 5: Fallback queries from Gemini
    for (const q of claim.search.fallback_queries) {
      addQuery(q);
    }
    
    // Strategy 6: Just key terms from finding (last resort)
    addQuery(this.extractKeyTerms(claim.extraction.finding_summary));
    
    return queries.slice(0, 5); // Max 5 queries to avoid too many API calls
  }
  
  /**
   * Extract key terms from a text (nouns, numbers, technical terms)
   */
  private extractKeyTerms(text: string): string {
    // Remove common words, keep nouns/numbers/technical terms
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'can', 'that', 'which', 'who', 'whom',
      'this', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 'and',
      'or', 'but', 'if', 'then', 'than', 'when', 'where', 'how', 'what', 'why',
      'with', 'without', 'for', 'from', 'to', 'of', 'on', 'in', 'at', 'by',
      'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
      'between', 'under', 'over', 'out', 'up', 'down', 'off', 'more', 'less',
      'most', 'least', 'some', 'any', 'all', 'both', 'each', 'few', 'many',
      'much', 'other', 'another', 'such', 'no', 'not', 'only', 'own', 'same',
      'so', 'as', 'also', 'just', 'even', 'because', 'although', 'while'
    ]);
    
    const words = text.toLowerCase().split(/\s+/);
    const keyTerms = words
      .map(w => w.replace(/[^a-z0-9-]/g, ''))
      .filter(w => w.length > 3 && !stopWords.has(w))
      .slice(0, 8); // Keep top 8 terms
    
    return keyTerms.join(' ');
  }
  
  private cleanQuery(query: string): string {
    const words = query.toLowerCase().split(/\s+/);
    const seen = new Set<string>();
    const unique: string[] = [];
    
    for (const word of words) {
      // Keep hyphens (meta-analysis), remove other punctuation
      const clean = word.replace(/[^a-z0-9-]/g, '').replace(/^-|-$/g, '');
      const key = clean.replace(/-/g, ''); // Dedupe key ignores hyphens
      
      if (clean.length > 2 && !seen.has(key)) {
        seen.add(key);
        unique.push(clean);
      }
    }
    
    return unique.slice(0, 8).join(' ');
  }
  
  private extractYearFromText(text: string): number | null {
    const match = text.match(/\b(19|20)\d{2}\b/);
    return match ? parseInt(match[0]) : null;
  }
  
  private extractDOI(url: string): string | null {
    if (url.includes('doi.org/')) {
      const match = url.match(/doi\.org\/(.+)/);
      return match?.[1] || null;
    }
    return null;
  }
  
  private parseAuthors(text: string): string[] {
    return text.split(/[,;]/)
      .map(s => s.trim())
      .filter(s => s.length > 2 && s.length < 50)
      .slice(0, 10);
  }
}

export const paperFinder = new PaperFinder();

