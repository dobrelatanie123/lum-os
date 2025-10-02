// Local type to avoid cross-file dependency
export interface StudySearchResult {
  title: string;
  authors: string[];
  journal: string;
  year: number;
  url: string;
  abstract?: string;
  doi?: string;
  credibility: 'high' | 'medium' | 'low';
  type: 'academic' | 'news' | 'government' | 'expert' | 'other';
}

/**
 * Academic Search Service
 * Uses Google Custom Search API to find real academic papers
 */
export class AcademicSearchService {
  private apiKey: string;
  private searchEngineId: string;

  constructor() {
    this.apiKey = process.env.GOOGLE_SEARCH_API_KEY || '';
    this.searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID || '';
    
    if (!this.apiKey || !this.searchEngineId) {
      console.warn('⚠️ Google Search API not configured. Academic search will be limited.');
    }
  }

  /**
   * Search for academic papers using Google Custom Search
   */
  async searchAcademicPapers(query: string, maxResults: number = 10): Promise<StudySearchResult[]> {
    if (!this.apiKey || !this.searchEngineId) {
      console.log('📚 Google Search API not available, using fallback search');
      return this.fallbackSearch(query, maxResults);
    }

    try {
      console.log(`🔍 Searching for academic papers: "${query}"`);

      // Normalize known author variants (simple mapping, can expand later)
      const normalized = query
        .replace(/\bJoey\s+Antonio\b/gi, 'Jose Antonio')
        .replace(/\bChris\s+Barakat\b/gi, 'Christopher Barakat');

      // Build tuned academic query (multi-pass variants)
      const trimmed = normalized.replace(/\s+/g, ' ').trim().slice(0, 180);
      const core = `"${trimmed}"`;
      const researchBoost = '("randomized controlled trial" OR "systematic review" OR "meta-analysis" OR "clinical trial" OR "cohort study" OR "review article")';
      const domainFilter = '(site:doi.org OR site:pubmed.ncbi.nlm.nih.gov OR site:nature.com OR site:science.org OR site:cell.com OR site:nejm.org OR site:bmj.com OR site:thelancet.com OR site:jama.com OR site:springer.com OR site:sciencedirect.com OR site:wiley.com OR site:tandfonline.com OR site:sagepub.com OR site:academic.oup.com OR site:frontiersin.org OR site:plos.org OR site:mdpi.com OR site:hindawi.com OR site:arxiv.org OR site:medrxiv.org OR site:biorxiv.org OR site:jstor.org OR site:journals.lww.com OR site:pnas.org OR site:cambridge.org OR site:researchgate.net)';
      const exactQuery = `${core} ${domainFilter}`;
      const boostedQuery = `${core} ${researchBoost} ${domainFilter}`;
      const relaxedQuery = `${trimmed} ${domainFilter}`;

      // Try queries in order: exact → boosted → relaxed; accumulate unique links
      const queries = [exactQuery, boostedQuery, relaxedQuery];
      const seen = new Set<string>();
      const results: any[] = [];
      for (const q of queries) {
        const params = new URLSearchParams({
          key: this.apiKey,
          cx: this.searchEngineId,
          q,
          num: String(maxResults),
          safe: 'active'
        });
        const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const data = await resp.json();
        for (const item of (data.items || [])) {
          const link = String(item.link || '');
          if (link && !seen.has(link)) {
            seen.add(link);
            results.push(item);
          }
          if (results.length >= maxResults) break;
        }
        if (results.length >= maxResults) break;
      }

      console.log(`✅ Found ${results.length} academic papers`);

      return results.map((item: any) => {
        const link: string = String(item.link || '');
        return {
          title: item.title || 'Untitled',
          authors: [],
          journal: this.extractJournalFromUrl(link),
          year: this.extractYearFromUrl(link),
          url: link,
          abstract: item.snippet || '',
          doi: this.extractDOIFromUrl(link),
          credibility: 'high' as const,
          type: 'academic' as const
        };
      });
      
    } catch (error) {
      console.error('❌ Academic search failed:', error);
      return this.fallbackSearch(query, maxResults);
    }
  }

  /**
   * Fallback search when Google API is not available
   */
  private async fallbackSearch(query: string, maxResults: number): Promise<StudySearchResult[]> {
    console.log(`📚 Using fallback search for: "${query}"`);
    
    // Last-resort open web links (precision-ranked)
    const links: string[] = [
      // Prefer DOI if present in query tokens
      `https://www.google.com/search?q=${encodeURIComponent(query + ' site:doi.org')}`,
      // Prefer publisher fulltext
      `https://www.google.com/search?q=${encodeURIComponent(query + ' site:biomedcentral.com OR site:nature.com OR site:science.org OR site:wiley.com OR site:springer.com OR site:sciencedirect.com OR site:academic.oup.com OR site:tandfonline.com')}`,
      // Accept PubMed and ResearchGate as fallbacks
      `https://www.google.com/search?q=${encodeURIComponent(query + ' site:pubmed.ncbi.nlm.nih.gov OR site:researchgate.net')}`
    ];

    return links.slice(0, maxResults).map((url, i) => ({
      title: i === 0 ? `Google (DOI-focused): "${query}"` : i === 1 ? `Google (Publisher-focused): "${query}"` : `Google (Index/Fallback): "${query}"`,
      authors: [],
      journal: 'Google',
      year: new Date().getFullYear(),
      url,
      abstract: '',
      doi: '',
      credibility: 'medium' as const,
      type: 'academic' as const
    }));
  }

  /**
   * Extract journal name from URL
   */
  private extractJournalFromUrl(url: string): string {
    if (url.includes('pubmed.ncbi.nlm.nih.gov')) return 'PubMed';
    if (url.includes('scholar.google.com')) return 'Google Scholar';
    if (url.includes('doi.org')) return 'DOI Database';
    if (url.includes('journals.lww.com')) return 'Lippincott Williams & Wilkins';
    if (url.includes('springer.com')) return 'Springer';
    if (url.includes('nature.com')) return 'Nature';
    if (url.includes('science.org')) return 'Science';
    if (url.includes('cell.com')) return 'Cell';
    if (url.includes('nejm.org')) return 'NEJM';
    if (url.includes('bmj.com')) return 'BMJ';
    if (url.includes('thelancet.com')) return 'The Lancet';
    if (url.includes('jama.com')) return 'JAMA';
    if (url.includes('biomedcentral.com')) return 'BioMed Central';
    if (url.includes('frontiersin.org')) return 'Frontiers';
    if (url.includes('plos.org')) return 'PLOS';
    if (url.includes('hindawi.com')) return 'Hindawi';
    if (url.includes('mdpi.com')) return 'MDPI';
    if (url.includes('sciencedirect.com')) return 'ScienceDirect';
    if (url.includes('wiley.com')) return 'Wiley';
    if (url.includes('tandfonline.com')) return 'Taylor & Francis';
    if (url.includes('sagepub.com')) return 'SAGE';
    if (url.includes('academic.oup.com')) return 'Oxford University Press';
    
    return 'Academic Journal';
  }

  /**
   * Extract year from URL
   */
  private extractYearFromUrl(url: string): number {
    const yearMatch = url.match(/(20\d{2})/);
    if (yearMatch) {
      return parseInt(yearMatch[1]);
    }
    return new Date().getFullYear();
  }

  /**
   * Extract DOI from URL
   */
  private extractDOIFromUrl(url: string): string {
    if (url.includes('doi.org/')) {
      const doiMatch = url.match(/doi\.org\/(.+)/);
      if (doiMatch) {
        return doiMatch[1];
      }
    }
    return '';
  }
}
