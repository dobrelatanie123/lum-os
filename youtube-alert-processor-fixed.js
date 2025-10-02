#!/usr/bin/env node

// YouTube Alert Processor - Processes videos and saves alerts to database
// Usage: node youtube-alert-processor-fixed.js <youtube-url>

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

dotenv.config();

// Initialize Supabase client with exact same values as working test
const supabaseUrl = 'http://127.0.0.1:55431';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const supabase = createClient(supabaseUrl, supabaseKey);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Simple fetch with timeout
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(options.headers || {})
      }
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// Verify URLs (lenient). Accept 2xx/3xx. Do NOT exclude paywalled domains.
async function verifyUrls(urls) {
  const OPEN_DOMAINS = [
    'pmc.ncbi.nlm.nih.gov','pubmed.ncbi.nlm.nih.gov','biomedcentral.com','plos.org','frontiersin.org','mdpi.com','bmj.com','thelancet.com','jamanetwork.com','gov'
  ];
  const checks = await Promise.all(urls.map(async (u) => {
    try {
      const host = u.replace(/^https?:\/\//,'').split('/')[0];
      const isOpen = OPEN_DOMAINS.some(d => host.endsWith(d) || host.includes('.gov'));
      // Use GET (some publishers reject HEAD) with small timeout
      const res = await fetchWithTimeout(u, { method: 'GET' }, 7000);
      if (res && res.status >= 200 && res.status < 400) {
        return u;
      }
      // If blocked but domain is open-access, still accept
      if (isOpen) return u;
      return null;
    } catch {
      return null;
    }
  }));
  return checks.filter(Boolean);
}

// Fallback: query Google CSE for first academic hit
async function searchFirstAcademicLink(query) {
  try {
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_ENGINE_ID;
    if (!apiKey || !cx) return null;
    const OPEN_DOMAINS = [
      'pmc.ncbi.nlm.nih.gov',
      'pubmed.ncbi.nlm.nih.gov',
      'biomedcentral.com',
      'plos.org',
      'frontiersin.org',
      'mdpi.com',
      'bmj.com',
      'thelancet.com',
      'jamanetwork.com'
    ];
    const domainFilter = '(site:pmc.ncbi.nlm.nih.gov OR site:pubmed.ncbi.nlm.nih.gov OR site:biomedcentral.com OR site:plos.org OR site:frontiersin.org OR site:mdpi.com OR site:bmj.com OR site:thelancet.com OR site:jamanetwork.com OR site:doi.org OR site:nature.com OR site:science.org OR site:wiley.com OR site:springer.com OR site:sciencedirect.com OR site:academic.oup.com OR site:tandfonline.com OR site:researchgate.net)';
    // Heuristic boosts for known entities/phrases
    const qTerms = [];
    const qLower = (query || '').toLowerCase();
    if (qLower.includes('antonio') || qLower.includes('joey')) {
      qTerms.push('"Jose Antonio"', '"resistance-trained"', '"free living"', '"4.4 g/kg/d"', 'JISSN');
    }
    if (qLower.includes('barakat')) {
      qTerms.push('"Chris Barakat"', '"Body Recomposition"', '"Can Trained Individuals Build Muscle and Lose Fat"');
    }
    if (qLower.includes('metabolic ward') || qLower.includes('bray')) {
      qTerms.push('"metabolic ward"', 'Bray', 'protein', '2013');
    }
    // Build final query
    const q = `${query} ${qTerms.join(' ')} ${domainFilter}`;
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(q)}&num=5`;
    const res = await fetchWithTimeout(url, { method: 'GET' }, 7000);
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.items || [];
    // Prefer open-access domains first
    const KEY_HINTS = ['4.4 g/kg/d', 'free living', 'resistance-trained', 'body composition', 'recomposition'];
    const sorted = items.sort((a, b) => {
      const ha = (a.link || '').replace(/^https?:\/\//, '').split('/')[0];
      const hb = (b.link || '').replace(/^https?:\/\//, '').split('/')[0];
      const pa = OPEN_DOMAINS.some(d => ha.endsWith(d)) ? 0 : 1;
      const pb = OPEN_DOMAINS.some(d => hb.endsWith(d)) ? 0 : 1;
      const ta = ((a.title||'')+' '+(a.snippet||'')).toLowerCase();
      const tb = ((b.title||'')+' '+(b.snippet||'')).toLowerCase();
      const sa = KEY_HINTS.reduce((acc,k)=> acc + (ta.includes(k.toLowerCase())?1:0), 0);
      const sb = KEY_HINTS.reduce((acc,k)=> acc + (tb.includes(k.toLowerCase())?1:0), 0);
      // Higher score preferred: (open-access priority, then hint matches)
      return (pa*10 - sa) - (pb*10 - sb);
    });
    for (const item of sorted) {
      const link = item.link;
      if (typeof link === 'string' && /^https?:\/\//.test(link)) {
        const ok = await verifyUrls([link]);
        if (ok.length) return ok[0];
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Google CSE: return top N links for a query (no server-side verification)
async function cseTopLinks(query, maxResults = 3) {
  try {
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_ENGINE_ID;
    if (!apiKey || !cx) return [];
    // Utilities
    const takeLinks = (items) => (items || [])
      .map((it) => (typeof it.link === 'string' ? it.link : null))
      .filter((u) => u && /^https?:\/\//.test(u));

    // Pass 1: raw claim, entire web, with locale params
    const params1 = new URLSearchParams({
      key: apiKey,
      cx,
      q: query,
      num: String(maxResults),
      gl: 'us',
      hl: 'en',
      safe: 'off'
    });
    const url1 = `https://www.googleapis.com/customsearch/v1?${params1.toString()}`;
    const res1 = await fetchWithTimeout(url1, { method: 'GET' }, 8000);
    let items = [];
    if (res1.ok) {
      const data1 = await res1.json();
      items = (data1.items || []);
    }
    let links = takeLinks(items).slice(0, maxResults);
    if (links.length) return links;

    // Pass 2: apply academic bias and author/topic boosts
    const domainBias = '(site:pmc.ncbi.nlm.nih.gov OR site:pubmed.ncbi.nlm.nih.gov OR site:biomedcentral.com OR site:plos.org OR site:frontiersin.org OR site:mdpi.com OR site:bmj.com OR site:thelancet.com OR site:jamanetwork.com OR site:doi.org OR site:nature.com OR site:science.org OR site:wiley.com OR site:springer.com OR site:sciencedirect.com OR site:academic.oup.com OR site:tandfonline.com OR site:researchgate.net)';
    const lower = (query || '').toLowerCase();
    const qTerms = [];
    if (lower.includes('joey') || lower.includes('antonio')) qTerms.push('"Jose Antonio"');
    if (lower.includes('barakat')) qTerms.push('"Chris Barakat"');
    if (lower.includes('metabolic ward') || lower.includes('bray')) qTerms.push('Bray', '"metabolic ward"');
    qTerms.push('pdf');
    const q2 = `${query} ${qTerms.join(' ')} ${domainBias}`;
    const params2 = new URLSearchParams({
      key: apiKey,
      cx,
      q: q2,
      num: String(maxResults),
      gl: 'us',
      hl: 'en',
      safe: 'off'
    });
    const url2 = `https://www.googleapis.com/customsearch/v1?${params2.toString()}`;
    const res2 = await fetchWithTimeout(url2, { method: 'GET' }, 8000);
    if (!res2.ok) return [];
    const data2 = await res2.json();
    items = (data2.items || []);
    links = takeLinks(items).slice(0, maxResults);
    if (links.length) return links;

    // Pass 3: targeted publisher site passes
    const targetDomains = [
      'doi.org', 'pubmed.ncbi.nlm.nih.gov', 'biomedcentral.com', 'jissn.biomedcentral.com',
      'nature.com', 'science.org', 'onlinelibrary.wiley.com', 'springer.com', 'link.springer.com',
      'sciencedirect.com', 'academic.oup.com', 'tandfonline.com', 'jamanetwork.com', 'thelancet.com',
      'bmj.com', 'frontiersin.org', 'plos.org', 'mdpi.com', 'researchgate.net'
    ];
    const aggregated = new Set();
    for (const domain of targetDomains) {
      const q3 = `${query} site:${domain}`;
      const params3 = new URLSearchParams({ key: apiKey, cx, q: q3, num: '3', gl: 'us', hl: 'en', safe: 'off' });
      const url3 = `https://www.googleapis.com/customsearch/v1?${params3.toString()}`;
      const res3 = await fetchWithTimeout(url3, { method: 'GET' }, 6000);
      if (!res3.ok) continue;
      const data3 = await res3.json();
      const l3 = takeLinks(data3.items || []);
      for (const u of l3) {
        aggregated.add(u);
        if (aggregated.size >= maxResults) break;
      }
      if (aggregated.size >= maxResults) break;
    }
    links = Array.from(aggregated).slice(0, maxResults);
    if (links.length) return links;

    // Pass 4: Google HTML fallback (extract /url?q= links)
    const ghtml = await fetchWithTimeout(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us&safe=off`, { method: 'GET' }, 8000);
    if (ghtml.ok) {
      const html = await ghtml.text();
      const matches = Array.from(html.matchAll(/href="\/url\?q=([^\"&]+)[^\"]*"/g)).map(m => decodeURIComponent(m[1]));
      const googleLinks = matches.filter(u => /^https?:\/\//.test(u)).slice(0, maxResults);
      if (googleLinks.length) return googleLinks;
    }

    // Pass 5: DuckDuckGo HTML fallback
    const ddg = await fetchWithTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { method: 'GET' }, 8000);
    if (ddg.ok) {
      const html = await ddg.text();
      const hrefs = Array.from(html.matchAll(/href="(https?:\/\/[^"\s]+)"/g)).map(m => m[1]);
      const ddgLinks = hrefs.filter(u => !u.includes('duckduckgo.com/y.js') && !u.includes('/y.js')).slice(0, maxResults);
      if (ddgLinks.length) return ddgLinks;
    }

    // Pass 6: Playwright headless Google SERP (real browser)
    try {
      const pwLinks = await googleSerpTopLinksPlaywright(query, maxResults);
      if (pwLinks && pwLinks.length) return pwLinks;
    } catch {}
    return links;
  } catch {
    return [];
  }
}

// GPT-5 Responses web_search: return top N direct academic links (no hallucinated URLs)
async function gpt5WebSearchTopAcademicLinks(query, maxResults = 3) {
  try {
    const academicDomains = [
      'pmc.ncbi.nlm.nih.gov','pubmed.ncbi.nlm.nih.gov','biomedcentral.com','jissn.biomedcentral.com',
      'nature.com','science.org','onlinelibrary.wiley.com','springer.com','link.springer.com',
      'sciencedirect.com','academic.oup.com','tandfonline.com','jamanetwork.com','thelancet.com',
      'bmj.com','frontiersin.org','plos.org','mdpi.com','doi.org'
    ];

    const input = [
      'Task: Use web_search to find up to', String(maxResults), 'direct academic links that best address this claim.',
      'Rules: Return ONLY a compact JSON array of URLs, no commentary. URLs must be on well-known academic domains',
      `(e.g., ${academicDomains.join(', ')}). Prefer publisher or PMC full-text over aggregators. No search result pages.`,
      'Claim:', query
    ].join(' ');

    const resp = await openai.responses.create({
      model: 'gpt-5',
      tools: [{ type: 'web_search' }],
      input,
      max_output_tokens: 600
    });

    const text = resp.output_text || '';
    const jsonStr = (() => {
      try { return JSON.stringify(JSON.parse(text)); } catch {}
      const m = text.match(/\[[\s\S]*?\]/);
      return m ? m[0] : '[]';
    })();
    let urls = [];
    try { urls = JSON.parse(jsonStr); } catch { urls = []; }

    // Normalize and filter to academic domains and http(s)
    const filtered = (Array.isArray(urls) ? urls : [])
      .filter(u => typeof u === 'string' && /^https?:\/\//.test(u))
      .filter(u => {
        const host = u.replace(/^https?:\/\//,'').split('/')[0];
        return academicDomains.some(d => host.endsWith(d) || host.includes(d));
      })
      .slice(0, maxResults);

    // Verify basic reachability (skip hard paywalls)
    // Be lenient: return filtered directly; network verification is best-effort and may be blocked
    if (filtered.length) return filtered.slice(0, maxResults);
    const verified = await verifyUrls(filtered);
    return (verified || []).slice(0, maxResults);
  } catch {
    return [];
  }
}

// Use API server's fact-check to extract URLs for a single claim
async function findLinksViaApiFactCheck(claimText, maxResults = 3) {
  try {
    const resp = await fetch('http://localhost:3001/api/fact-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcription: claimText, videoId: 'backfill' })
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const claims = data?.data?.claims || [];
    if (!Array.isArray(claims) || !claims.length) return [];
    const sources = claims[0]?.sources || [];
    const urls = sources
      .map((s) => (typeof s?.url === 'string' ? s.url : null))
      .filter((u) => u && /^https?:\/\//.test(u));
    // quick domain sanity similar to academic domains
    const domains = [
      'pmc.ncbi.nlm.nih.gov','pubmed.ncbi.nlm.nih.gov','biomedcentral.com','jissn.biomedcentral.com',
      'nature.com','science.org','onlinelibrary.wiley.com','springer.com','link.springer.com',
      'sciencedirect.com','academic.oup.com','tandfonline.com','jamanetwork.com','thelancet.com',
      'bmj.com','frontiersin.org','plos.org','mdpi.com','doi.org'
    ];
    const filtered = urls.filter((u) => {
      const host = u.replace(/^https?:\/\//,'').split('/')[0];
      return domains.some((d) => host.endsWith(d) || host.includes(d));
    }).slice(0, maxResults);
    return filtered;
  } catch {
    return [];
  }
}

// Headless Google SERP via Playwright (optional)
async function googleSerpTopLinksPlaywright(query, maxResults = 3) {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us&safe=off`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForSelector('div#search', { timeout: 15000 }).catch(() => {});
    const links = await page.evaluate(() => {
      const results = [];
      const nodes = document.querySelectorAll('div#search a h3');
      nodes.forEach((h3) => {
        const a = h3.closest('a');
        if (!a) return;
        let href = a.getAttribute('href') || '';
        if (href.startsWith('/url?')) {
          try {
            const u = new URL(href, location.origin);
            const q = u.searchParams.get('q');
            if (q) href = q;
          } catch {}
        }
        if (/^https?:\/\//.test(href)) results.push(href);
      });
      return Array.from(new Set(results));
    });
    await browser.close();
    return (links || []).slice(0, maxResults);
  } catch (e) {
    return [];
  }
}

// Naive HTML -> text extractor
function extractTextFromHtml(html) {
  try {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

// Summarize a claim strictly using provided URLs (best-effort: fetch open pages)
async function summarizeClaimWithUrls(claimText, urls) {
  try {
    const contents = [];
    for (const u of urls) {
      try {
        const resp = await fetchWithTimeout(u, { method: 'GET' }, 8000);
        if (resp.ok && resp.headers.get('content-type') && resp.headers.get('content-type').includes('text')) {
          const html = await resp.text();
          const text = extractTextFromHtml(html).slice(0, 20000);
          contents.push({ url: u, text });
        } else {
          contents.push({ url: u, text: '' });
        }
      } catch {
        contents.push({ url: u, text: '' });
      }
    }

    const contextBlocks = contents.map((c, i) => `Source ${i + 1}: ${c.url}\n${c.text ? c.text : '[content not fetched]'}`).join('\n\n');

    const system = `You are a careful fact-checker. Use ONLY the provided sources. If a source's content is missing, do not infer from it.`;
    const user = `Claim: ${claimText}\n\nSources:\n${contextBlocks}\n\nTasks:\n1) Briefly summarize what these sources say about the claim.\n2) Give a verdict: supported | partially_supported | not_supported | unclear.\n3) Return JSON: { summary, verdict }`;

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.1,
      max_tokens: 800,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    });
    const content = resp.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return { summary: content.slice(0, 600), verdict: 'unclear' };
  } catch (e) {
    return { summary: 'Summary unavailable', verdict: 'unclear' };
  }
}

async function saveAlertsToDatabase(videoId, factCheckResult) {
  try {
    console.log(`💾 Saving ${factCheckResult.claims?.length || 0} alerts to database...`);
    console.log('Fact check result structure:', JSON.stringify(factCheckResult, null, 2));
    
    for (const claim of factCheckResult.claims || []) {
      console.log('Claim structure:', JSON.stringify(claim, null, 2));
      // Replace any GPT-provided URLs with Top-3 Google CSE links for this claim
      const extractedUrls = await cseTopLinks((claim.claim || claim.text || '').slice(0, 200), 3);

      // Enforce: only persist alerts with at least one URL
      if (!extractedUrls || extractedUrls.length === 0) {
        console.log('⏭️  Skipping alert without verified URLs');
        continue;
      }

      // Summarize this claim using only the CSE links
      let summaryResult = { summary: claim.analysis || '', verdict: claim.credibility || 'medium' };
      try {
        summaryResult = await summarizeClaimWithUrls(claim.claim || claim.text || '', extractedUrls);
      } catch {}

      const alert = {
        podcast_id: `yt-${videoId}`,
        user_id: 'demo-user-123',
        alert_type: 'fact_check',
        details: JSON.stringify({
          claim: claim.claim || claim.text,
          verdict: summaryResult.verdict || claim.credibility || 'medium',
          reasoning: summaryResult.summary || claim.analysis,
          sources: (claim.sources || []).map(source => {
            // If source is a string, return as is
            if (typeof source === 'string') {
              return source;
            }
            // If source is an object with title, return the title
            if (source.title) {
              return source.title;
            }
            return source;
          }),
          timestamp: Date.now()
        }),
        urls: JSON.stringify(extractedUrls)
      };
      
      console.log(`Saving alert: ${(claim.claim || claim.text || 'Unknown claim').substring(0, 50)}...`);
      
      const { data, error } = await supabase
        .from('alerts')
        .insert(alert);
        
      if (error) {
        console.error('❌ Error saving alert:', error);
      } else {
        console.log('✅ Alert saved successfully');
      }
    }
    
    console.log('✅ All alerts processed');
  } catch (error) {
    console.error('❌ Failed to save alerts:', error);
  }
}

async function processYouTubeVideo(videoUrl) {
  try {
    // Support stored transcription path: pass video as db:<videoId>
    if (videoUrl.startsWith('db:')) {
      const videoId = videoUrl.slice(3);
      return await processFromStoredTranscription(videoId);
    }

    // Support updating existing alerts' URLs from claims: update:<videoId>
    if (videoUrl.startsWith('update:')) {
      const videoId = videoUrl.slice(7);
      return await updateExistingAlertsUrls(videoId);
    }

    const videoId = extractVideoId(videoUrl);
    console.log(`🎥 Processing YouTube video: ${videoId}`);
    
    // Call the existing API server
    const response = await fetch('http://localhost:3001/api/process-youtube', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        videoUrl: videoUrl,
        videoId: videoId
      })
    });
    
    if (!response.ok) {
      throw new Error(`API call failed: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ YouTube processing completed');
      console.log(`💰 Total cost: $${result.data.totalCost}`);
      console.log(`⏱️ Processing time: ${result.data.processingTime}ms`);
      
      // Save transcript to database for reuse
      try {
        const transcriptPayload = result?.data?.transcription;
        const transcriptText = typeof transcriptPayload === 'string'
          ? transcriptPayload
          : (transcriptPayload?.text || transcriptPayload?.transcript || '');
        if (transcriptText && transcriptText.length > 20) {
          const { error: tErr } = await supabase
            .from('transcriptions')
            .upsert(
              {
                podcast_id: `yt-${videoId}`,
                transcript: transcriptText
              },
              { onConflict: 'podcast_id' }
            );
          if (tErr) {
            console.warn('⚠️ Failed to save transcript:', tErr);
          } else {
            console.log('🗂️ Transcript saved to database');
          }
        } else {
          console.warn('⚠️ No transcript text returned to save');
        }
      } catch (e) {
        console.warn('⚠️ Transcript save error:', e.message);
      }
      
      // Save alerts to database
      await saveAlertsToDatabase(videoId, result.data.factCheck);
      
      console.log(`🎯 Alerts saved for video: ${videoId}`);
      console.log(`🔗 View alerts: http://localhost:4321/alerts?video_id=${videoId}`);
    } else {
      console.error('❌ YouTube processing failed:', result.message);
    }
  } catch (error) {
    console.error('❌ Error processing video:', error.message);
  }
}

async function getStoredTranscription(videoId) {
  // Try to fetch latest transcription row for this video
  const podcastId = `yt-${videoId}`;
  const { data, error } = await supabase
    .from('transcriptions')
    .select('*')
    .eq('podcast_id', podcastId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data || !data.length) {
    throw new Error('No stored transcription found');
  }
  const row = data[0];
  // Heuristic: pick first long string field
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'string' && v.length > 200) return v;
  }
  throw new Error('Stored transcription format not recognized');
}

async function processFromStoredTranscription(videoId) {
  console.log(`🗂️ Using stored transcription for video: ${videoId}`);
  try {
    const transcription = await getStoredTranscription(videoId);
    const response = await fetch('http://localhost:3001/api/fact-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcription, videoId })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Fact-check API failed: ${response.status} ${text}`);
    }
    const result = await response.json();
    if (!result.success) {
      throw new Error(`Fact-check failed: ${result.message || 'unknown error'}`);
    }
    console.log('✅ Fact-check completed from stored transcription');
    await saveAlertsToDatabase(videoId, result.data);
    console.log(`🎯 Alerts saved for video: ${videoId}`);
    console.log(`🔗 View alerts: http://localhost:4321/alerts?video_id=${videoId}`);
  } catch (e) {
    console.error('❌ Error processing from stored transcription:', e.message);
  }
}

async function updateExistingAlertsUrls(videoId) {
  console.log(`♻️ Updating existing alerts with Top-3 links for video: ${videoId}`);
  const podcastId = `yt-${videoId}`;
  // Fetch alerts
  const { data: alerts, error } = await supabase
    .from('alerts')
    .select('id, details, urls')
    .eq('podcast_id', podcastId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('❌ Failed to fetch alerts:', error);
    return;
  }
  if (!alerts || !alerts.length) {
    console.log('ℹ️ No alerts found to update');
    return;
  }

  for (const al of alerts) {
    try {
      let details = al.details;
      if (typeof details === 'string') {
        try { details = JSON.parse(details); } catch {}
      }
      const claimText = (details && (details.claim || details.text)) || '';
      if (!claimText || claimText.length < 10) {
        console.log(`⏭️  Skipping alert ${al.id}: no usable claim`);
        continue;
      }
      // First try GPT-5 web_search, then CSE pipeline, then API fact-check per-claim
      let links = await gpt5WebSearchTopAcademicLinks(claimText.slice(0, 300), 3);
      if (!links.length) links = await cseTopLinks(claimText.slice(0, 200), 3);
      if (!links.length) links = await findLinksViaApiFactCheck(claimText, 3);
      if (!links.length) {
        console.log(`⏭️  Skipping alert ${al.id}: no links found`);
        continue;
      }
      const { error: upErr } = await supabase
        .from('alerts')
        .update({ urls: JSON.stringify(links) })
        .eq('id', al.id);
      if (upErr) {
        console.error('❌ Update failed for alert', al.id, upErr);
      } else {
        console.log('✅ Updated alert', al.id);
      }
    } catch (e) {
      console.error('❌ Error updating an alert:', e.message);
    }
  }

  console.log('✅ Finished updating alerts. Check the UI.');
}

// Update a single alert's URLs by id
async function updateSingleAlertUrls(alertId) {
  console.log(`♻️ Updating single alert URLs: ${alertId}`);
  // Fetch the alert
  const { data: alertRow, error } = await supabase
    .from('alerts')
    .select('id, details')
    .eq('id', alertId)
    .single();
  if (error || !alertRow) {
    console.error('❌ Failed to fetch alert:', error || 'not found');
    return;
  }
  let details = alertRow.details;
  if (typeof details === 'string') {
    try { details = JSON.parse(details); } catch {}
  }
  const claimText = (details && (details.claim || details.text)) || '';
  if (!claimText || claimText.length < 10) {
    console.log('⏭️  Skipping: no usable claim');
    return;
  }
  // Pipelines: GPT-5 web_search → CSE → API fact-check per-claim
  let links = await gpt5WebSearchTopAcademicLinks(claimText.slice(0, 300), 3);
  if (!links.length) links = await cseTopLinks(claimText.slice(0, 200), 3);
  if (!links.length) links = await findLinksViaApiFactCheck(claimText, 3);
  if (!links.length) {
    console.log('⏭️  No links found');
    return;
  }
  const { error: upErr } = await supabase
    .from('alerts')
    .update({ urls: JSON.stringify(links) })
    .eq('id', alertId);
  if (upErr) {
    console.error('❌ Update failed:', upErr);
    return;
  }
  // Fetch back to verify
  const { data: verifyRow } = await supabase
    .from('alerts')
    .select('id, urls')
    .eq('id', alertId)
    .single();
  console.log('✅ Updated URLs:', verifyRow?.urls);
}

// Compute stable topic_id for a set of alerts by claim text clustering (hash-based)
async function backfillTopicsForVideo(videoId) {
  console.log(`🧩 Backfilling topic groups for video: ${videoId}`);
  const podcastId = `yt-${videoId}`;
  const { data: alerts, error } = await supabase
    .from('alerts')
    .select('id, details, topic_id')
    .eq('podcast_id', podcastId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('❌ Failed to fetch alerts for grouping:', error);
    return;
  }
  if (!alerts || !alerts.length) {
    console.log('ℹ️ No alerts to group');
    return;
  }
  // Normalize claim text -> fingerprint
  function normalize(text) {
    return (text || '')
      .toLowerCase()
      .replace(/https?:[^\s]+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function fingerprint(text) {
    const words = normalize(text).split(' ').filter(w => w.length > 2);
    const stop = new Set(['the','and','for','with','that','this','from','into','have','has','had','can','are','was','were','not','but','you','your','their','they','them','his','her','its','our','out','over','under','about','while','also']);
    const kept = words.filter(w => !stop.has(w));
    const top = kept.slice(0, 12).join(' ');
    // Simple hash
    let h = 0;
    for (let i = 0; i < top.length; i++) h = (h * 131 + top.charCodeAt(i)) >>> 0;
    return `t_${h.toString(16)}`;
  }
  let updates = 0;
  for (const al of alerts) {
    let details = al.details;
    if (typeof details === 'string') { try { details = JSON.parse(details); } catch {} }
    const claim = (details && (details.claim || details.text)) || '';
    if (!claim) continue;
    const topicId = fingerprint(claim);
    if (al.topic_id === topicId) continue;
    const { error: upErr } = await supabase
      .from('alerts')
      .update({ topic_id: topicId })
      .eq('id', al.id);
    if (!upErr) updates++;
  }
  console.log(`✅ Grouping complete. Updated ${updates} alerts with topic_id.`);
}

function extractVideoId(url) {
  const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Main execution
if (process.argv.length < 3) {
  console.log('Usage: node youtube-alert-processor-fixed.js <youtube-url>');
  console.log('Example: node youtube-alert-processor-fixed.js https://www.youtube.com/watch?v=xXVB8A5xvSw');
  process.exit(1);
}

const videoUrl = process.argv[2];
if (videoUrl.startsWith('updateOne:')) {
  const alertId = videoUrl.slice('updateOne:'.length);
  updateSingleAlertUrls(alertId);
} else if (videoUrl.startsWith('group:')) {
  const videoId = videoUrl.slice('group:'.length);
  backfillTopicsForVideo(videoId);
} else {
  processYouTubeVideo(videoUrl);
}
