#!/usr/bin/env node
// Backfill working study URLs for alerts without URLs (non-LLM path)
// Usage: node scripts/backfill-missing-urls.js <videoId>

import dotenv from 'dotenv';
// Load envs from multiple common locations (last one wins)
const envPaths = [
  '.env.local',
  '.env',
  'astro/.env.local',
  'astro/.env',
  'extension/.env.local',
  'extension/.env'
];
for (const p of envPaths) {
  try { dotenv.config({ path: p }); } catch {}
}

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const preferredDomains = [
  'pmc.ncbi.nlm.nih.gov', 'pubmed.ncbi.nlm.nih.gov', 'nih.gov',
  'jissn.biomedcentral.com', 'biomedcentral.com', 'plos.org', 'frontiersin.org', 'mdpi.com',
  'nature.com', 'science.org', 'cell.com', 'onlinelibrary.wiley.com', 'springer.com', 'link.springer.com',
  'academic.oup.com', 'tandfonline.com', 'sciencedirect.com', 'jamanetwork.com', 'thelancet.com', 'bmj.com',
  'journals.lww.com', 'researchgate.net', 'doi.org'
];

function rankUrl(u) {
  try {
    const h = new URL(u);
    const host = h.hostname.replace(/^www\./, '');
    const idx = preferredDomains.indexOf(host);
    return idx >= 0 ? idx : preferredDomains.length + 1;
  } catch { return preferredDomains.length + 2; }
}

async function verifyUrl(u) {
  try {
    // Reject known-bad hosts upfront
    try {
      const h = new URL(u);
      const host = h.hostname.replace(/^www\./, '');
      if (!preferredDomains.includes(host)) return null;
      if (host.includes('duckduckgo.com')) return null;
    } catch { return null; }
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 6000);
    let res = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: ctl.signal });
    if (!res.ok || (res.status >= 400)) {
      res = await fetch(u, { method: 'GET', redirect: 'follow', signal: ctl.signal });
    }
    clearTimeout(to);
    if (res.ok || (res.status >= 200 && res.status < 400)) return u;
    return null;
  } catch { return null; }
}

function normalizeSourceTitle(s) {
  return String(s || '')
    .replace(/\(search\)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericSource(s) {
  const t = s.toLowerCase();
  return (
    t === 'pubmed' ||
    t === 'google scholar' ||
    t === 'journal of the international society of sports nutrition' ||
    t === 'nutrition & metabolism'
  );
}

function buildHeuristicQuery(details) {
  const text = (details?.claim || details?.text || '').trim();
  const analysis = (details?.reasoning || details?.analysis || '').trim();
  const core = [text, analysis].filter(Boolean).join(' ').slice(0, 240);
  let q = core;
  const lower = q.toLowerCase();
  // Simple author/topic boosts without LLM
  if (/\bbarakat\b/.test(lower)) q += ' "Christopher Barakat" "body recomposition" "lean mass" "fat loss"';
  if (/\b(jose|joey)\s+antonio\b/.test(lower)) q += ' "Jose Antonio"';
  if (/\breview\b/.test(lower)) q += ' "review"';
  if (/\brecomposition|recomp\b/.test(lower)) q += ' "body recomposition"';
  const domainBias = '(site:pmc.ncbi.nlm.nih.gov OR site:pubmed.ncbi.nlm.nih.gov OR site:biomedcentral.com OR site:plos.org OR site:frontiersin.org OR site:mdpi.com OR site:bmj.com OR site:thelancet.com OR site:jamanetwork.com OR site:doi.org OR site:nature.com OR site:science.org OR site:wiley.com OR site:springer.com OR site:sciencedirect.com OR site:academic.oup.com OR site:tandfonline.com OR site:journals.lww.com)';
  return `${q} ${domainBias}`.trim();
}

async function googleHtmlLinks(query, maxResults = 6) {
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us&safe=off`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const html = await res.text();
    const links = Array.from(html.matchAll(/href="\/url\?q=([^"&]+)[^\"]*"/g)).map(m => decodeURIComponent(m[1]))
      .filter(u => /^https?:\/\//.test(u));
    return links.slice(0, maxResults);
  } catch { return []; }
}

async function ddgHtmlLinks(query, maxResults = 6) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const html = await res.text();
    const links = Array.from(html.matchAll(/href="(https?:\/\/[^"\s]+)"/g)).map(m => m[1])
      .filter(u => !u.includes('duckduckgo.com/y.js') && !u.includes('/y.js'));
    return links.slice(0, maxResults);
  } catch { return []; }
}

async function findTopLinks(details) {
  // 1) Try resolving each source title directly
  const sources = Array.isArray(details?.sources) ? details.sources : [];
  const sourceTitles = sources
    .map(normalizeSourceTitle)
    .filter(s => s && !isGenericSource(s) && s.length > 8)
    .slice(0, 5);

  let links = [];
  for (const title of sourceTitles) {
    let q1 = `"${title}" (review OR study OR trial OR meta-analysis) (author OR journal) (pdf) (pmc OR pubmed OR doi)`;
    const baseLower = (details?.claim || '').toLowerCase();
    if (/\bbarakat\b/.test(baseLower)) q1 += ' "Christopher Barakat" "body recomposition" "lean mass" "fat loss"';
    let local = await googleHtmlLinks(q1, 10);
    if (!local.length) local = await ddgHtmlLinks(q1, 10);
    links.push(...local);
    if (links.length >= 12) break;
  }

  // 2) If still nothing, fall back to claim-based query
  if (links.length === 0) {
    const q = buildHeuristicQuery(details);
    links = await googleHtmlLinks(q, 10);
    if (!links.length) links = await ddgHtmlLinks(q, 10);
  }

  // 3) Targeted publisher passes for known topics (e.g., Barakat recomposition review)
  const baseLower = (details?.claim || '').toLowerCase();
  if (/\bbarakat\b/.test(baseLower) && /\breview\b/.test(baseLower)) {
    const targets = [
      'site:journals.lww.com "body recomposition" "Christopher Barakat"',
      'site:jissn.biomedcentral.com body recomposition review'
    ];
    for (const t of targets) {
      let local = await googleHtmlLinks(t, 5);
      if (!local.length) local = await ddgHtmlLinks(t, 5);
      links.push(...local);
    }
  }
  // Dedup and filter to preferred academic domains; drop DDG error pages
  links = Array.from(new Set(links))
    .filter(u => {
      try {
        const h = new URL(u);
        const host = h.hostname.replace(/^www\./, '');
        if (host.includes('duckduckgo.com')) return false;
        return preferredDomains.includes(host);
      } catch { return false; }
    });
  links.sort((a, b) => rankUrl(a) - rankUrl(b));
  const limited = links.slice(0, 12);
  const verified = (await Promise.all(limited.map(verifyUrl))).filter(Boolean);
  return verified.slice(0, 4);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.log('Usage: node scripts/backfill-missing-urls.js <videoId>');
    process.exit(1);
  }
  const podcastId = `yt-${arg}`;
  console.log(`🔧 Backfilling URLs for alerts (non-LLM): ${podcastId}`);
  const { data: alerts, error } = await supabase
    .from('alerts')
    .select('id, details, urls')
    .eq('podcast_id', podcastId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('Supabase error:', error);
    process.exit(1);
  }
  for (const al of alerts || []) {
    try {
      const current = Array.isArray(al.urls) ? al.urls : (typeof al.urls === 'string' ? JSON.parse(al.urls || '[]') : []);
      const has = Array.isArray(current) && current.length > 0;
      let details = al.details;
      if (typeof details === 'string') { try { details = JSON.parse(details); } catch {} }
      if (!details || !details.claim) continue;

      // If we have URLs but they’re dead, we’ll refresh; if none, we find new
      let finalUrls = [];
      if (has) {
        const verified = (await Promise.all(current.map(verifyUrl))).filter(Boolean);
        finalUrls = verified;
      }
      if (finalUrls.length === 0) {
        const found = await findTopLinks(details);
        finalUrls = found;
      }
      if (finalUrls.length === 0) {
        console.log(`⏭️  ${al.id} no viable links`);
        continue;
      }
      const { error: upErr } = await supabase
        .from('alerts')
        .update({ urls: JSON.stringify(finalUrls) })
        .eq('id', al.id);
      if (upErr) console.error('❌ Update failed:', al.id, upErr);
      else console.log('✅ Updated', al.id, finalUrls[0]);
    } catch (e) {
      console.error('❌ Error processing alert', al.id, e?.message || e);
    }
  }
  console.log('✅ Done. Refresh the UI.');
}

main();


