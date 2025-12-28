/**
 * Academic Paper Searcher
 * Searches Semantic Scholar, PubMed, and Google for relevant papers
 */

import type { PaperResult, SearchAttempt } from './verification-types.js';

const SEMANTIC_SCHOLAR_API = 'https://api.semanticscholar.org/graph/v1';
const PUBMED_API = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

export class AcademicSearcher {
  private googleApiKey: string;
  private googleSearchEngineId: string;
  
  constructor() {
    this.googleApiKey = process.env.GOOGLE_SEARCH_API_KEY || '';
    this.googleSearchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID || '';
  }
  
  /**
   * Search multiple sources for papers matching the query
   */
  async search(
    primaryQuery: string, 
    fallbackQueries: string[] = [],
    authorName: string | null = null
  ): Promise<{ papers: PaperResult[]; attempts: SearchAttempt[] }> {
    const attempts: SearchAttempt[] = [];
    const allPapers: PaperResult[] = [];
    const seenIds = new Set<string>();
    
    // Try primary query first
    const queries = [primaryQuery, ...fallbackQueries];
    
    for (const query of queries) {
      // 1. Semantic Scholar (free, good for author search)
      const ssResults = await this.searchSemanticScholar(query, authorName);
      attempts.push({
        query,
        source: 'semantic_scholar',
        results_count: ssResults.length,
        top_result: ssResults[0] || null
      });
      
      for (const paper of ssResults) {
        if (!seenIds.has(paper.paper_id)) {
          seenIds.add(paper.paper_id);
          allPapers.push(paper);
        }
      }
      
      // If we found good results, don't try fallbacks
      if (ssResults.length >= 3) break;
      
      // 2. PubMed (free, good for medical/life sciences)
      const pmResults = await this.searchPubMed(query);
      attempts.push({
        query,
        source: 'pubmed',
        results_count: pmResults.length,
        top_result: pmResults[0] || null
      });
      
      for (const paper of pmResults) {
        if (!seenIds.has(paper.paper_id)) {
          seenIds.add(paper.paper_id);
          allPapers.push(paper);
        }
      }
      
      if (allPapers.length >= 5) break;
    }
    
    return { papers: allPapers, attempts };
  }
  
  /**
   * Search Semantic Scholar API
   */
  async searchSemanticScholar(query: string, authorName: string | null = null): Promise<PaperResult[]> {
    try {
      // Build search URL
      let searchUrl = `${SEMANTIC_SCHOLAR_API}/paper/search?query=${encodeURIComponent(query)}&limit=5&fields=paperId,title,authors,year,venue,abstract,url,externalIds,citationCount`;
      
      // Add author filter if provided
      if (authorName) {
        const surname = authorName.split(' ').pop();
        searchUrl += `&author=${encodeURIComponent(surname || '')}`;
      }
      
      const response = await fetch(searchUrl, {
        headers: { 'Accept': 'application/json' }
      });
      
      if (!response.ok) {
        console.log(`⚠️ Semantic Scholar returned ${response.status}`);
        return [];
      }
      
      const data = await response.json();
      
      if (!data.data || data.data.length === 0) {
        return [];
      }
      
      return data.data.map((paper: any) => ({
        paper_id: `ss_${paper.paperId}`,
        title: paper.title || 'Untitled',
        authors: (paper.authors || []).map((a: any) => a.name),
        year: paper.year,
        venue: paper.venue,
        abstract: paper.abstract,
        url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
        doi: paper.externalIds?.DOI || null,
        citation_count: paper.citationCount,
        source: 'semantic_scholar' as const
      }));
      
    } catch (error) {
      console.error('❌ Semantic Scholar search failed:', error);
      return [];
    }
  }
  
  /**
   * Search PubMed API
   */
  async searchPubMed(query: string): Promise<PaperResult[]> {
    try {
      // Step 1: Search for IDs
      const searchUrl = `${PUBMED_API}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=5&retmode=json`;
      const searchResponse = await fetch(searchUrl);
      
      if (!searchResponse.ok) {
        console.log(`⚠️ PubMed search returned ${searchResponse.status}`);
        return [];
      }
      
      const searchData = await searchResponse.json();
      const ids = searchData.esearchresult?.idlist || [];
      
      if (ids.length === 0) {
        return [];
      }
      
      // Step 2: Fetch details
      const fetchUrl = `${PUBMED_API}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
      const fetchResponse = await fetch(fetchUrl);
      
      if (!fetchResponse.ok) {
        return [];
      }
      
      const fetchData = await fetchResponse.json();
      const results: PaperResult[] = [];
      
      for (const id of ids) {
        const article = fetchData.result?.[id];
        if (!article) continue;
        
        results.push({
          paper_id: `pm_${id}`,
          title: article.title || 'Untitled',
          authors: (article.authors || []).map((a: any) => a.name),
          year: article.pubdate ? parseInt(article.pubdate.split(' ')[0]) : null,
          venue: article.fulljournalname || article.source,
          abstract: null, // PubMed summary doesn't include abstract
          url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
          doi: article.elocationid?.replace('doi: ', '') || null,
          citation_count: null,
          source: 'pubmed' as const
        });
      }
      
      return results;
      
    } catch (error) {
      console.error('❌ PubMed search failed:', error);
      return [];
    }
  }
  
  /**
   * Fetch abstract for a PubMed paper
   */
  async fetchPubMedAbstract(pmid: string): Promise<string | null> {
    try {
      const url = `${PUBMED_API}/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=text`;
      const response = await fetch(url);
      
      if (!response.ok) return null;
      
      const text = await response.text();
      return text.trim();
      
    } catch {
      return null;
    }
  }
}

export const academicSearcher = new AcademicSearcher();

