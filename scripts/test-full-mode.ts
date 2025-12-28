/**
 * Test Full Mode Extraction
 * Runs against all 7 transcripts and validates claim counts
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { FullModeExtractor } from '../services/claim-extraction/full-mode.js';
import type { SynthesizedClaim } from '../services/claim-extraction/types.js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
);

const extractor = new FullModeExtractor();

// Expected claims per video (from implementation guide)
const EXPECTED_CLAIMS: Record<string, { min: number; max: number; description: string }> = {
  'yt-xXVB8A5xvSw': { min: 2, max: 5, description: 'Body Recomp (Barakat, Antonio, Bray)' },
  'yt-928aRhhPP8I': { min: 3, max: 6, description: 'Upper Body (Chavez + unnamed)' },
  'yt-DzjWEn2BS_k': { min: 4, max: 8, description: 'Low Volume (Krieger, Pelland...)' },
  'yt-j1bx0GMofYw': { min: 3, max: 7, description: 'Protein (unnamed studies)' },
  'yt-EiPYgiu8-Hc': { min: 1, max: 4, description: 'AI/Harvard' },
  'yt-LLwLv7nOymQ': { min: 0, max: 1, description: 'History (no studies expected)' },
  'yt-M61oqDvNsN8': { min: 1, max: 4, description: 'Creatine (Candow, German study)' },
};

async function loadTranscripts(): Promise<{ podcast_id: string; transcript: string }[]> {
  // Load from database
  const { data, error } = await supabase
    .from('transcriptions')
    .select('podcast_id, transcript');
    
  if (error) {
    console.error('❌ Failed to load transcripts:', error);
    process.exit(1);
  }
  
  return data || [];
}

async function saveClaim(claim: SynthesizedClaim): Promise<void> {
  const { error } = await supabase.from('claims').upsert({
    claim_id: claim.claim_id,
    video_id: claim.video_id,
    segment_text: claim.segment.full_text,
    segment_word_count: claim.segment.word_count,
    author_mentioned: claim.extraction.author_mentioned,
    author_normalized: claim.extraction.author_normalized,
    author_variants: claim.extraction.author_variants,
    institution_mentioned: claim.extraction.institution_mentioned,
    finding_summary: claim.extraction.finding_summary,
    confidence: claim.extraction.confidence,
    primary_query: claim.search.primary_query,
    fallback_queries: claim.search.fallback_queries,
  }, {
    onConflict: 'claim_id'
  });
  
  if (error) {
    console.error(`❌ Failed to save claim ${claim.claim_id}:`, error);
  }
}

async function main() {
  console.log('🧪 Full Mode Extraction Test\n');
  console.log('='.repeat(60));
  
  const transcripts = await loadTranscripts();
  console.log(`📚 Loaded ${transcripts.length} transcripts\n`);
  
  let totalClaims = 0;
  let passed = 0;
  let failed = 0;
  
  for (const { podcast_id, transcript } of transcripts) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📹 Processing: ${podcast_id}`);
    
    const expected = EXPECTED_CLAIMS[podcast_id];
    if (!expected) {
      console.log(`   ⚠️ No expectations defined, skipping...`);
      continue;
    }
    
    console.log(`   Expected: ${expected.min}-${expected.max} claims (${expected.description})`);
    
    try {
      const claims = await extractor.extract(podcast_id, transcript);
      totalClaims += claims.length;
      
      // Log each claim
      for (const claim of claims) {
        console.log(`   [${claim.extraction.confidence}] ${claim.extraction.author_normalized || 'unnamed'}: ${claim.extraction.finding_summary.slice(0, 50)}...`);
        await saveClaim(claim);
      }
      
      // Check if within range
      if (claims.length >= expected.min && claims.length <= expected.max) {
        console.log(`   ✅ PASS: ${claims.length} claims (expected ${expected.min}-${expected.max})`);
        passed++;
      } else {
        console.log(`   ❌ FAIL: ${claims.length} claims (expected ${expected.min}-${expected.max})`);
        failed++;
      }
      
    } catch (error) {
      console.error(`   ❌ ERROR:`, error);
      failed++;
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 RESULTS');
  console.log(`   Total claims extracted: ${totalClaims}`);
  console.log(`   Tests passed: ${passed}`);
  console.log(`   Tests failed: ${failed}`);
  console.log('='.repeat(60));
  
  // Show claims in database
  const { count } = await supabase.from('claims').select('*', { count: 'exact', head: true });
  console.log(`\n💾 Claims in database: ${count}`);
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);

