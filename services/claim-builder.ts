import OpenAI from 'openai';
import { AI_CONFIG } from '../lib/ai-config.js';

export interface CanonicalClaim {
  claim: string;
  authors: string[];
  study_type: 'review' | 'systematic_review' | 'meta_analysis' | 'trial' | 'observational' | 'other';
  count: number | null;
  time_reference: { text: string; approx_year: number | null } | null;
  topic_keywords: string[];
  span_text: string;
}

export class ClaimBuilder {
  private openai: OpenAI;
  private contextBuffers: Map<string, string[]> = new Map();
  private contextWindowChunks: number = 5;

  constructor() {
    const openaiConfig: any = { apiKey: AI_CONFIG.openai.apiKey };
    if (AI_CONFIG.openai.organization) openaiConfig.organization = AI_CONFIG.openai.organization;
    this.openai = new OpenAI(openaiConfig);
  }

  async canonicalizeSpan(span: string, videoYear?: number, contextId?: string): Promise<CanonicalClaim | null> {
    const sys = `You receive a short transcript span (1–3 sentences). Extract ONE perfect factual claim strictly from this span; do not add new facts.
Return strict JSON with keys: claim, authors[], study_type (review|systematic_review|meta_analysis|trial|observational|other), count (number|null), time_reference {text, approx_year|null} or null, topic_keywords[], span_text.
Normalize author first names (e.g., Chris -> Christopher) when obvious. If a quantity or time appears, include it. If no time, set time_reference to null.`;

    const previous = contextId ? this.getContextText(contextId) : '';
    const user = (previous ? `PREVIOUS_CONTEXT (last ${this.contextWindowChunks} chunks):\n${previous}\n\n` : '')
      + `SPAN:\n${span.trim()}`
      + (videoYear ? `\nVIDEO_YEAR:${videoYear}` : '');
    try {
      const resp: any = await (this.openai as any).responses.create({
        model: 'gpt-5',
        input: `${sys}\n\n${user}`,
        max_output_tokens: 800
      });
      const content: string = resp.output_text || (resp.output?.[0]?.content?.[0]?.text?.value) || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);
      // Light validation
      if (!parsed || typeof parsed.claim !== 'string') return null;
      parsed.authors = Array.isArray(parsed.authors) ? parsed.authors : [];
      parsed.study_type = parsed.study_type || 'other';
      if (parsed.count !== null && typeof parsed.count !== 'number') parsed.count = null;
      if (parsed.time_reference && typeof parsed.time_reference.text !== 'string') parsed.time_reference = null;
      parsed.topic_keywords = Array.isArray(parsed.topic_keywords) ? parsed.topic_keywords : [];
      parsed.span_text = typeof parsed.span_text === 'string' ? parsed.span_text : span.trim();
      if (contextId) this.pushContextChunk(contextId, span);
      return parsed as CanonicalClaim;
    } catch {
      return null;
    }
  }

  buildBoostedQuery(c: CanonicalClaim): string {
    const parts: string[] = [];
    if (c.authors?.length) parts.push(c.authors.map(a => `"${a}"`).join(' '));
    if (c.study_type && c.study_type !== 'other') parts.push(`"${c.study_type.replace('_', ' ')}"`);
    if (typeof c.count === 'number') parts.push(`"${c.count} studies"`);
    if (c.time_reference?.text) parts.push(`"${c.time_reference.text}"`);
    if (c.topic_keywords?.length) parts.push(c.topic_keywords.slice(0, 5).map(k => `"${k}"`).join(' '));
    parts.push(`"${c.claim}"`);
    // Academic domain bias
    const domainFilter = '(site:pmc.ncbi.nlm.nih.gov OR site:pubmed.ncbi.nlm.nih.gov OR site:biomedcentral.com OR site:plos.org OR site:frontiersin.org OR site:mdpi.com OR site:bmj.com OR site:thelancet.com OR site:jamanetwork.com OR site:doi.org OR site:nature.com OR site:science.org OR site:wiley.com OR site:springer.com OR site:sciencedirect.com OR site:academic.oup.com OR site:tandfonline.com OR site:journals.lww.com)';
    return `${parts.filter(Boolean).join(' ')} ${domainFilter}`.trim().slice(0, 300);
  }

  setContextWindowChunks(n: number): void {
    const size = Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
    this.contextWindowChunks = size;
    // Trim existing buffers if needed
    for (const [key, chunks] of this.contextBuffers.entries()) {
      if (chunks.length > size) this.contextBuffers.set(key, chunks.slice(-size));
    }
  }

  resetContext(contextId: string): void {
    if (!contextId) return;
    this.contextBuffers.delete(contextId);
  }

  pushContextChunk(contextId: string, chunk: string): void {
    if (!contextId) return;
    const text = (chunk || '').toString().trim();
    if (!text) return;
    const arr = this.contextBuffers.get(contextId) || [];
    arr.push(text);
    if (arr.length > this.contextWindowChunks) arr.splice(0, arr.length - this.contextWindowChunks);
    this.contextBuffers.set(contextId, arr);
  }

  private getContextText(contextId: string): string {
    if (!contextId) return '';
    const arr = this.contextBuffers.get(contextId) || [];
    return arr.join('\n');
  }
}


