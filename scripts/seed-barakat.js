#!/usr/bin/env node
import dotenv from 'dotenv';
for (const p of ['.env.local', '.env', 'astro/.env.local', 'astro/.env']) { try { dotenv.config({ path: p }); } catch {} }
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) { console.error('Missing SUPABASE_URL or SUPABASE_KEY'); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const videoId = process.argv[2];
  if (!videoId) { console.log('Usage: node scripts/seed-barakat.js <videoId>'); process.exit(1); }
  const podcastId = `yt-${videoId}`;
  const { data: alerts, error } = await supabase
    .from('alerts')
    .select('id, details, urls')
    .eq('podcast_id', podcastId)
    .order('created_at', { ascending: true });
  if (error) { console.error('Supabase error:', error); process.exit(1); }
  if (!alerts?.length) { console.log('No alerts found'); process.exit(0); }

  const targetIdx = alerts.findIndex(al => {
    const d = typeof al.details === 'string' ? (()=>{ try { return JSON.parse(al.details); } catch { return {}; } })() : (al.details||{});
    const text = (`${d.claim||''} ${d.reasoning||''}`).toLowerCase();
    return text.includes('barakat') && (text.includes('review') || text.includes('meta')) && (text.includes('10 studies') || text.includes('ten studies') || text.includes('collected'));
  });

  if (targetIdx === -1) { console.log('No matching Barakat review alert found'); process.exit(0); }
  const target = alerts[targetIdx];
  const seedUrls = [
    'https://journals.lww.com/nsca-scj/fulltext/2020/10000/body_recomposition__can_trained_individuals_build.3.aspx'
  ];
  const { error: upErr } = await supabase
    .from('alerts')
    .update({ urls: JSON.stringify(seedUrls) })
    .eq('id', target.id);
  if (upErr) { console.error('Update error:', upErr); process.exit(1); }
  console.log('✅ Seeded Barakat review URL for alert', target.id);
}

main();









