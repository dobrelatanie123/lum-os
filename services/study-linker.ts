import { Source } from '../lib/ai-types.js';

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

export interface StudyLinkingOptions {
  maxResults: number;
  includeAbstracts: boolean;
  preferredYears: number[];
  minCredibility: 'high' | 'medium' | 'low';
}

export class StudyLinker {
  private options: StudyLinkingOptions;

  constructor(options: Partial<StudyLinkingOptions> = {}) {
    this.options = {
      maxResults: 5,
      includeAbstracts: true,
      preferredYears: [2020, 2021, 2022, 2023, 2024, 2025],
      minCredibility: 'medium',
      ...options
    };
  }

  /**
   * Find studies and sources for a specific claim
   */
  async findStudiesForClaim(claim: string, context?: string): Promise<Source[]> {
    try {
      console.log(`🔍 Searching for studies: "${claim.substring(0, 100)}..."`);
      
      // Extract key terms from the claim
      const searchTerms = this.extractSearchTerms(claim, context);
      
      // Search multiple sources
      const [academicResults, newsResults, expertResults] = await Promise.allSettled([
        this.searchAcademicPapers(searchTerms),
        this.searchNewsSources(searchTerms),
        this.searchExpertSources(searchTerms)
      ]);

      const allResults: StudySearchResult[] = [];
      
      if (academicResults.status === 'fulfilled') {
        allResults.push(...academicResults.value);
      }
      if (newsResults.status === 'fulfilled') {
        allResults.push(...newsResults.value);
      }
      if (expertResults.status === 'fulfilled') {
        allResults.push(...expertResults.value);
      }

      // Filter and rank results
      const filteredResults = this.filterAndRankResults(allResults);
      
      // Convert to Source format
      const sources: Source[] = filteredResults.map(result => ({
        title: result.title,
        url: result.url,
        credibility: result.credibility,
        type: result.type
      }));

      console.log(`✅ Found ${sources.length} relevant sources for claim`);
      return sources;

    } catch (error) {
      console.error('❌ Study linking failed:', error);
      return [];
    }
  }

  /**
   * Extract search terms from a claim
   */
  private extractSearchTerms(claim: string, context?: string): string[] {
    const text = `${claim} ${context || ''}`.toLowerCase();
    
    // Remove common words and extract meaningful terms
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those'
    ]);

    const words = text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    // Extract key phrases (2-3 word combinations)
    const phrases: string[] = [];
    for (let i = 0; i < words.length - 1; i++) {
      phrases.push(`${words[i]} ${words[i + 1]}`);
    }
    for (let i = 0; i < words.length - 2; i++) {
      phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }

    // Combine single words and phrases, remove duplicates
    const allTerms = [...words, ...phrases];
    const uniqueTerms = [...new Set(allTerms)];

    return uniqueTerms.slice(0, 10); // Limit to top 10 terms
  }

  /**
   * Search academic papers using real web search (like Perplexity)
   */
  private async searchAcademicPapers(searchTerms: string[]): Promise<StudySearchResult[]> {
    console.log(`📚 Searching for real academic papers: ${searchTerms.join(', ')}`);
    
    try {
      // Use web search to find actual academic papers
      const results = await this.searchWebForRealPapers(searchTerms);
      return results.slice(0, this.options.maxResults);
      
    } catch (error) {
      console.error('❌ Error searching for academic papers:', error);
      return [];
    }
  }

  /**
   * Search web for real academic papers (like Perplexity)
   */
  private async searchWebForRealPapers(searchTerms: string[]): Promise<StudySearchResult[]> {
    try {
      const query = searchTerms.join(' ');
      
      // Search for academic papers using DuckDuckGo (more reliable than Google)
      const searchQuery = `"${query}" site:pubmed.ncbi.nlm.nih.gov OR site:scholar.google.com OR site:doi.org OR site:journals.lww.com OR site:springer.com OR site:nature.com OR site:science.org OR site:cell.com OR site:nejm.org OR site:bmj.com OR site:thelancet.com OR site:jama.com OR site:biomedcentral.com OR site:frontiersin.org OR site:plos.org OR site:hindawi.com OR site:mdpi.com OR site:sciencedirect.com OR site:wiley.com OR site:tandfonline.com OR site:sagepub.com OR site:academic.oup.com`;
      
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
      
      console.log(`🔍 Searching for real papers: ${query}`);
      
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Search error: ${response.status}`);
      }
      
      const html = await response.text();
      
      // Parse search results to extract real academic papers
      const results = this.parseRealAcademicPapers(html, searchTerms);
      
      return results;
      
    } catch (error) {
      console.error('❌ Web search failed:', error);
      return [];
    }
  }

  /**
   * Parse search results to extract real academic papers
   */
  private parseRealAcademicPapers(html: string, searchTerms: string[]): StudySearchResult[] {
    const results: StudySearchResult[] = [];
    
    try {
      // Extract URLs from search results
      const urlMatches = html.match(/href="(https?:\/\/[^"]+)"/g) || [];
      
      for (const match of urlMatches) {
        const url = match.replace('href="', '').replace('"', '');
        
        // Filter for academic sources and extract paper details
        if (this.isAcademicSource(url)) {
          const paperDetails = this.extractPaperDetails(url, html, searchTerms);
          if (paperDetails) {
            results.push(paperDetails);
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Error parsing search results:', error);
    }
    
    return results;
  }

  // Basic academic-domain classifier
  private isAcademicSource(url: string): boolean {
    const domains = [
      'doi.org','pubmed.ncbi.nlm.nih.gov','nature.com','science.org','cell.com','nejm.org','bmj.com','thelancet.com','jama.com',
      'springer.com','link.springer.com','sciencedirect.com','wiley.com','tandfonline.com','sagepub.com','academic.oup.com',
      'frontiersin.org','plos.org','hindawi.com','mdpi.com','arxiv.org','medrxiv.org','biorxiv.org','journals.lww.com','pnas.org','cambridge.org'
    ];
    return domains.some(d => url.includes(d));
  }

  /**
   * Extract paper details from URL and HTML
   */
  private extractPaperDetails(url: string, html: string, searchTerms: string[]): StudySearchResult | null {
    try {
      // Extract title from the search result
      const titleMatch = html.match(new RegExp(`href="${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([^<]+)</a>`, 'i'));
      const title = titleMatch ? titleMatch[1].trim() : searchTerms.join(' ') + ' - Academic Study';
      
      // Extract journal and year from URL
      const journal = this.extractJournalFromUrl(url);
      const year = this.extractYearFromUrl(url);
      const doi = this.extractDOIFromUrl(url);
      
      return {
        title: this.cleanTitle(title),
        authors: [],
        journal,
        year,
        url,
        abstract: '',
        doi,
        credibility: 'high' as const,
        type: 'academic' as const
      };
      
    } catch (error) {
      console.error('❌ Error extracting paper details:', error);
      return null;
    }
  }

  // Utilities mirrored from academic-search to satisfy compiler
  private extractJournalFromUrl(url: string): string {
    if (url.includes('pubmed.ncbi.nlm.nih.gov')) return 'PubMed';
    if (url.includes('scholar.google.com')) return 'Google Scholar';
    if (url.includes('doi.org')) return 'DOI Database';
    if (url.includes('journals.lww.com')) return 'Lippincott Williams & Wilkins';
    if (url.includes('springer.com') || url.includes('link.springer.com')) return 'Springer';
    if (url.includes('nature.com')) return 'Nature';
    if (url.includes('science.org')) return 'Science';
    if (url.includes('cell.com')) return 'Cell';
    if (url.includes('nejm.org')) return 'NEJM';
    if (url.includes('bmj.com')) return 'BMJ';
    if (url.includes('thelancet.com')) return 'The Lancet';
    if (url.includes('jama.com') || url.includes('jamanetwork.com')) return 'JAMA';
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
    if (url.includes('pnas.org')) return 'PNAS';
    if (url.includes('cambridge.org')) return 'Cambridge';
    return 'Academic Journal';
  }

  private extractYearFromUrl(url: string): number {
    const match = url.match(/(20\d{2})/);
    return match ? parseInt(match[1]) : new Date().getFullYear();
  }

  private extractDOIFromUrl(url: string): string {
    if (url.includes('doi.org/')) {
      const m = url.match(/doi\.org\/(.+)/);
      if (m) return m[1];
    }
    return '';
  }

  /**
   * Clean and format title
   */
  private cleanTitle(title: string): string {
    return title
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }


  /**
   * Remove duplicate results based on title similarity
   */
  private removeDuplicateResults(results: StudySearchResult[]): StudySearchResult[] {
    const seen = new Set<string>();
    return results.filter(result => {
      const key = result.title.toLowerCase().trim();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Search news and media sources
   */
  private async searchNewsSources(searchTerms: string[]): Promise<StudySearchResult[]> {
    console.log(`📰 Searching news sources for: ${searchTerms.join(', ')}`);
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 800));
    
    const mockResults: StudySearchResult[] = [];
    
    if (searchTerms.some(term => term.includes('muscle') || term.includes('fat'))) {
      mockResults.push({
        title: "New Study Shows You Can Build Muscle While Losing Fat",
        authors: ["Smith, J"],
        journal: "Healthline",
        year: 2024,
        url: "https://www.healthline.com/nutrition/muscle-gain-fat-loss",
        abstract: "Recent research challenges the traditional belief that you can't build muscle while losing fat...",
        credibility: 'medium',
        type: 'news'
      });
    }
    
    return mockResults.slice(0, 2);
  }

  /**
   * Search expert and government sources
   */
  private async searchExpertSources(searchTerms: string[]): Promise<StudySearchResult[]> {
    console.log(`🏛️ Searching expert sources for: ${searchTerms.join(', ')}`);
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 600));
    
    const mockResults: StudySearchResult[] = [];
    
    if (searchTerms.some(term => term.includes('protein') || term.includes('nutrition'))) {
      mockResults.push({
        title: "Dietary Guidelines for Americans 2020-2025",
        authors: ["USDA", "HHS"],
        journal: "US Department of Agriculture",
        year: 2020,
        url: "https://www.dietaryguidelines.gov/sites/default/files/2020-12/Dietary_Guidelines_for_Americans_2020-2025.pdf",
        abstract: "Official dietary guidelines including protein recommendations for different age groups...",
        credibility: 'high',
        type: 'government'
      });
    }
    
    return mockResults.slice(0, 2);
  }

  /**
   * Filter and rank results based on credibility and relevance
   */
  private filterAndRankResults(results: StudySearchResult[]): StudySearchResult[] {
    // Filter by minimum credibility
    const filtered = results.filter(result => {
      const credibilityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
      const minOrder = credibilityOrder[this.options.minCredibility];
      const resultOrder = credibilityOrder[result.credibility];
      return resultOrder >= minOrder;
    });

    // Sort by credibility and year (prefer recent, high-credibility sources)
    return filtered
      .sort((a, b) => {
        // First by credibility
        const credibilityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
        const aCred = credibilityOrder[a.credibility];
        const bCred = credibilityOrder[b.credibility];
        
        if (aCred !== bCred) {
          return bCred - aCred;
        }
        
        // Then by year (prefer recent)
        return b.year - a.year;
      })
      .slice(0, this.options.maxResults);
  }

  /**
   * Get study details by DOI or URL
   */
  async getStudyDetails(identifier: string): Promise<StudySearchResult | null> {
    try {
      console.log(`📖 Fetching study details for: ${identifier}`);
      
      // In a real implementation, you would:
      // 1. Check if it's a DOI and use CrossRef API
      // 2. Check if it's a URL and scrape metadata
      // 3. Use specific APIs based on the source (PubMed, arXiv, etc.)
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Return mock detailed result
      return {
        title: "Detailed Study Information",
        authors: ["Author 1", "Author 2"],
        journal: "Journal Name",
        year: 2024,
        url: identifier,
        abstract: "This is a detailed abstract of the study...",
        doi: identifier.startsWith('10.') ? identifier : "",
        credibility: 'high',
        type: 'academic'
      };
      
    } catch (error) {
      console.error('❌ Failed to fetch study details:', error);
      return null;
    }
  }
}
