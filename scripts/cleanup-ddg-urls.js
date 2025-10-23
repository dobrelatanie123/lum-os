#!/usr/bin/env node
import dotenv from 'dotenv';
const envPaths = ['.env.local', '.env', 'astro/.env.local', 'astro/.env'];
for (const p of envPaths) { try { dotenv.config({ path: p }); } catch {} }

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data: alerts, error } = await supabase
    .from('alerts')
    .select('id, urls')
    .not('urls', 'is', null);
  if (error) {
    console.error('Supabase error:', error);
    process.exit(1);
  }
  let cleaned = 0;
  for (const al of alerts || []) {
    try {
      const arr = typeof al.urls === 'string' ? JSON.parse(al.urls) : (Array.isArray(al.urls) ? al.urls : []);
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const filtered = arr.filter(u => {
        try { const h = new URL(u); const host = h.hostname.replace(/^www\./, ''); return host !== 'duckduckgo.com'; } catch { return false; }
      });
      if (filtered.length !== arr.length) {
        const { error: upErr } = await supabase
          .from('alerts')
          .update({ urls: JSON.stringify(filtered) })
          .eq('id', al.id);
        if (!upErr) cleaned++;
      }
    } catch {}
  }
  console.log(`✅ Cleaned ${cleaned} alerts from DDG links`);
}

main();






