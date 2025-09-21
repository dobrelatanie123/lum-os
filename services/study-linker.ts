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
   * Search academic papers (simulated - in real implementation, use APIs like CrossRef, PubMed, etc.)
   */
  private async searchAcademicPapers(searchTerms: string[]): Promise<StudySearchResult[]> {
    // This is a simulation - in a real implementation, you would:
    // 1. Use CrossRef API for DOI lookups
    // 2. Use PubMed API for medical studies
    // 3. Use Google Scholar API (unofficial)
    // 4. Use arXiv API for preprints
    
    console.log(`📚 Searching academic papers for: ${searchTerms.join(', ')}`);
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Mock results based on common fitness/nutrition topics
    const mockResults: StudySearchResult[] = [];
    
    if (searchTerms.some(term => term.includes('muscle') || term.includes('fat'))) {
      mockResults.push({
        title: "Body Recomposition: Can You Build Muscle and Lose Fat Simultaneously?",
        authors: ["Barakat, C", "Pearson, J", "Escalante, G"],
        journal: "Journal of the International Society of Sports Nutrition",
        year: 2023,
        url: "https://jissn.biomedcentral.com/articles/10.1186/s12970-023-00878-2",
        abstract: "This systematic review examines the evidence for body recomposition in trained individuals...",
        doi: "10.1186/s12970-023-00878-2",
        credibility: 'high',
        type: 'academic'
      });
    }
    
    if (searchTerms.some(term => term.includes('protein') || term.includes('calorie'))) {
      mockResults.push({
        title: "Protein Requirements for Muscle Mass Maintenance and Gain in Trained Individuals",
        authors: ["Morton, RW", "Murphy, KT", "McKellar, SR"],
        journal: "Journal of the International Society of Sports Nutrition",
        year: 2022,
        url: "https://jissn.biomedcentral.com/articles/10.1186/s12970-022-00720-8",
        abstract: "A comprehensive review of protein requirements for athletes and active individuals...",
        doi: "10.1186/s12970-022-00720-8",
        credibility: 'high',
        type: 'academic'
      });
    }
    
    if (searchTerms.some(term => term.includes('resistance') || term.includes('training'))) {
      mockResults.push({
        title: "Resistance Training and Body Composition in Adults: A Systematic Review",
        authors: ["Schoenfeld, BJ", "Ogborn, D", "Krieger, JW"],
        journal: "Sports Medicine",
        year: 2024,
        url: "https://link.springer.com/article/10.1007/s40279-024-02000-8",
        abstract: "This systematic review examines the effects of resistance training on body composition...",
        doi: "10.1007/s40279-024-02000-8",
        credibility: 'high',
        type: 'academic'
      });
    }

    return mockResults.slice(0, this.options.maxResults);
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
