/**
 * Match Scorer
 * Scores how well a found paper matches the original claim
 */
export class MatchScorer {
    /**
     * Score a paper against a claim
     */
    score(paper, claim) {
        const authorScore = this.scoreAuthorMatch(paper, claim);
        const topicScore = this.scoreTopicMatch(paper, claim);
        const yearScore = this.scoreYearPlausibility(paper);
        const abstractScore = this.scoreAbstractRelevance(paper, claim);
        // Weighted average (author most important if mentioned)
        const hasAuthor = claim.extraction.author_normalized !== null;
        const weights = hasAuthor
            ? { author: 0.4, topic: 0.3, year: 0.1, abstract: 0.2 }
            : { author: 0.0, topic: 0.5, year: 0.1, abstract: 0.4 };
        const totalScore = authorScore * weights.author +
            topicScore * weights.topic +
            yearScore * weights.year +
            abstractScore * weights.abstract;
        const matchQuality = this.getMatchQuality(totalScore, hasAuthor, authorScore);
        return {
            ...paper,
            match_score: {
                author_score: authorScore,
                topic_score: topicScore,
                year_score: yearScore,
                abstract_score: abstractScore,
                total_score: totalScore,
                match_quality: matchQuality
            }
        };
    }
    /**
     * Score and rank multiple papers
     */
    rankPapers(papers, claim) {
        return papers
            .map(p => this.score(p, claim))
            .sort((a, b) => b.match_score.total_score - a.match_score.total_score);
    }
    // ─────────────────────────────────────────────────────────────
    // Scoring methods
    // ─────────────────────────────────────────────────────────────
    scoreAuthorMatch(paper, claim) {
        if (!claim.extraction.author_normalized)
            return 0;
        const claimAuthor = claim.extraction.author_normalized.toLowerCase();
        const claimSurname = claimAuthor.split(' ').pop() || '';
        const variants = claim.extraction.author_variants.map(v => v.toLowerCase());
        // Check each paper author
        for (const paperAuthor of paper.authors) {
            const paperAuthorLower = paperAuthor.toLowerCase();
            const paperSurname = paperAuthor.split(' ').pop()?.toLowerCase() || '';
            // Exact full name match
            if (paperAuthorLower.includes(claimAuthor))
                return 1.0;
            // Surname match
            if (paperSurname === claimSurname)
                return 0.9;
            // Variant match
            if (variants.some(v => paperAuthorLower.includes(v) || paperSurname === v)) {
                return 0.8;
            }
        }
        return 0;
    }
    scoreTopicMatch(paper, claim) {
        // Get keywords from claim query and finding
        const claimKeywords = this.extractKeywords(claim.search.primary_query + ' ' + claim.extraction.finding_summary);
        // Get keywords from paper title and abstract
        const paperText = (paper.title + ' ' + (paper.abstract || '')).toLowerCase();
        const paperKeywords = this.extractKeywords(paperText);
        // Calculate Jaccard-like overlap
        const matches = claimKeywords.filter(k => paperKeywords.some(pk => pk.includes(k) || k.includes(pk)));
        if (claimKeywords.length === 0)
            return 0;
        const overlap = matches.length / claimKeywords.length;
        return Math.min(1, overlap * 1.2); // Slight boost
    }
    scoreYearPlausibility(paper) {
        if (!paper.year)
            return 0.5; // Unknown year = neutral
        const currentYear = new Date().getFullYear();
        const age = currentYear - paper.year;
        // Prefer recent papers (last 10 years)
        if (age <= 5)
            return 1.0;
        if (age <= 10)
            return 0.9;
        if (age <= 20)
            return 0.7;
        if (age <= 30)
            return 0.5;
        return 0.3;
    }
    scoreAbstractRelevance(paper, claim) {
        if (!paper.abstract)
            return 0.3; // No abstract = low confidence
        const abstract = paper.abstract.toLowerCase();
        const finding = claim.extraction.finding_summary.toLowerCase();
        // Extract key concepts from finding
        const findingWords = this.extractKeywords(finding);
        // Check how many finding concepts appear in abstract
        const matches = findingWords.filter(w => abstract.includes(w));
        if (findingWords.length === 0)
            return 0.3;
        return Math.min(1, matches.length / findingWords.length);
    }
    getMatchQuality(totalScore, hasAuthor, authorScore) {
        // If author was mentioned but not found, cap at weak
        if (hasAuthor && authorScore < 0.5 && totalScore > 0.3) {
            return 'weak';
        }
        if (totalScore >= 0.7)
            return 'strong';
        if (totalScore >= 0.5)
            return 'moderate';
        if (totalScore >= 0.3)
            return 'weak';
        return 'none';
    }
    extractKeywords(text) {
        // Common stop words to filter out
        const stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
            'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'that', 'this',
            'these', 'those', 'it', 'its', 'they', 'their', 'them', 'we', 'our', 'you',
            'your', 'he', 'she', 'his', 'her', 'more', 'most', 'other', 'some', 'such',
            'than', 'too', 'very', 'just', 'only', 'also', 'into', 'over', 'after',
            'before', 'between', 'under', 'above', 'up', 'down', 'out', 'off', 'about',
            'found', 'study', 'studies', 'research', 'showed', 'shows', 'show'
        ]);
        return text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 3 && !stopWords.has(w));
    }
}
export const matchScorer = new MatchScorer();
