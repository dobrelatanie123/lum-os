#!/usr/bin/env node
import dotenv from 'dotenv';
for (const p of ['.env.local', '.env', 'astro/.env.local', 'astro/.env']) { try { dotenv.config({ path: p }); } catch {} }
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'child_process';

const supabaseUrl = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) { console.error('Missing SUPABASE_URL or SUPABASE_KEY'); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/https?:[^\s]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[\.!?])\s+(?=[A-Z\d\(])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function fuzzyFindPosition(claim, transcriptText) {
  const normClaim = normalize(claim);
  const normTranscript = normalize(transcriptText);
  // Direct substring
  const idx = normTranscript.indexOf(normClaim);
  if (idx >= 0) return idx;
  // Sentence-level Jaccard
  const sentences = splitSentences(transcriptText);
  const claimTokens = new Set(normClaim.split(' ').filter(w => w.length > 3));
  let best = { j: -1, score: 0 };
  for (let i = 0; i < sentences.length; i++) {
    const sNorm = normalize(sentences[i]);
    const sTokens = new Set(sNorm.split(' ').filter(Boolean));
    let inter = 0;
    for (const w of claimTokens) if (sTokens.has(w)) inter++;
    const uni = claimTokens.size + sTokens.size - inter || 1;
    const jac = inter / uni;
    if (jac > best.score) best = { j: i, score: jac };
  }
  if (best.j >= 0) {
    const raw = splitSentences(transcriptText);
    let pos = 0;
    for (let i = 0; i < raw.length && i < best.j; i++) pos += raw[i].length + 1;
    return pos;
  }
  return -1;
}

function getVideoDurationSec(videoId) {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const out = spawnSync('yt-dlp', ['--dump-json', '--no-download', url], { encoding: 'utf-8' });
    if (out.status !== 0) return null;
    const info = JSON.parse(out.stdout || '{}');
    const dur = Number(info.duration);
    return Number.isFinite(dur) ? Math.floor(dur) : null;
  } catch { return null; }
}

async function getDbTranscript(videoId) {
  const podcastId = `yt-${videoId}`;
  const { data, error } = await supabase
    .from('transcriptions')
    .select('transcript')
    .eq('podcast_id', podcastId)
    .single();
  if (error || !data) return null;
  return data.transcript || '';
}

// Removed external/auto captions: we use our own DB transcription

function buildQuery(details) {
  const claim = (details?.canonical_claim || details?.claim || '').trim();
  const reasoning = (details?.reasoning || '').trim();
  if (!claim && !reasoning) return '';
  if (!reasoning) return claim;
  // Combine, capped length to keep it specific
  const combined = `${claim} ${reasoning}`.slice(0, 600);
  return combined;
}

async function backfill(videoId, { force = true, minClampSec = 7 } = {}) {
  const podcastId = `yt-${videoId}`;
  const { data: alerts, error } = await supabase
    .from('alerts')
    .select('id, details')
    .eq('podcast_id', podcastId)
    .order('created_at', { ascending: true });
  if (error) { console.error('Supabase error:', error); process.exit(1); }
  if (!alerts?.length) { console.log('No alerts found'); return; }

  const transcriptText = await getDbTranscript(videoId);
  if (!transcriptText) { console.log('No DB transcript, skipping'); return; }
  const durationSec = getVideoDurationSec(videoId);
  if (!durationSec) { console.log('No video duration, skipping'); return; }

  let updated = 0;
  for (const al of alerts) {
    let d = al.details;
    try { d = typeof d === 'string' ? JSON.parse(d) : d; } catch {}
    if (!d || typeof d !== 'object') d = {};
    if (!force && Number.isFinite(Number(d.video_time_sec))) continue; // already set

    const query = buildQuery(d);
    if (!query) continue;
    const pos = fuzzyFindPosition(query, transcriptText);
    if (pos >= 0) {
      const total = transcriptText.length || 1;
      const ratio = Math.min(1, Math.max(0, pos / total));
      let t = Math.floor(ratio * durationSec);
      if (t < minClampSec) t = minClampSec; // clamp tiny values to avoid 0s
      d.video_time_sec = t;
      const { error: upErr } = await supabase
        .from('alerts')
        .update({ details: JSON.stringify(d) })
        .eq('id', al.id);
      if (upErr) { console.error('Update error for', al.id, upErr.message); }
      else { updated++; console.log(`✅ ${al.id} -> video_time_sec=${t}`); }
    }
  }
  console.log(`Done. Updated ${updated}/${alerts.length}`);
}

async function main() {
  const videoId = process.argv[2];
  if (!videoId) { console.log('Usage: node scripts/backfill-video-time.js <YouTubeVideoId>'); process.exit(1); }
  await backfill(videoId);
}

main();
