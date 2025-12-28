/**
 * Test Live Mode Extraction
 * Verifies that Live Mode produces similar results to Full Mode
 */

import { createClient } from '@supabase/supabase-js';
import { FullModeExtractor } from '../services/claim-extraction/full-mode.js';
import { LiveModeExtractor } from '../services/claim-extraction/live-mode.js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
);

const WORDS_PER_CHUNK = 75; // ~10 seconds of speech

/**
 * Split transcript into chunks of approximately wordsPerChunk words
 */
function chunkTranscript(text: string, wordsPerChunk: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '));
  }
  return chunks;
}

async function testLiveVsFull(videoId: string, transcript: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📹 Testing: ${videoId}`);
  console.log(`   Words: ${transcript.split(/\s+/).length}`);
  
  const fullExtractor = new FullModeExtractor();
  const liveExtractor = new LiveModeExtractor();
  
  // Full mode: single pass
  console.log('\n   🔵 Full Mode:');
  const fullClaims = await fullExtractor.extract(videoId, transcript);
  console.log(`      Found ${fullClaims.length} claims`);
  for (const claim of fullClaims) {
    console.log(`      - [${claim.extraction.confidence}] ${claim.extraction.author_normalized || 'unnamed'}`);
  }
  
  // Live mode: chunked
  console.log('\n   🟢 Live Mode:');
  liveExtractor.startSession(videoId + '_live');
  
  const chunks = chunkTranscript(transcript, WORDS_PER_CHUNK);
  console.log(`      Processing ${chunks.length} chunks...`);
  
  for (const chunk of chunks) {
    await liveExtractor.processChunk(chunk);
  }
  
  const liveClaims = liveExtractor.getAllClaims();
  console.log(`      Found ${liveClaims.length} claims`);
  for (const claim of liveClaims) {
    console.log(`      - [${claim.extraction.confidence}] ${claim.extraction.author_normalized || 'unnamed'} @ ${claim.segment.approximate_timestamp_start}`);
  }
  
  // Compare
  const fullAuthors = new Set(fullClaims.map(c => c.extraction.author_normalized || 'unnamed'));
  const liveAuthors = new Set(liveClaims.map(c => c.extraction.author_normalized || 'unnamed'));
  
  const matchingAuthors = [...fullAuthors].filter(a => liveAuthors.has(a));
  const matchRate = fullAuthors.size > 0 ? matchingAuthors.length / fullAuthors.size : 1;
  
  console.log(`\n   📊 Comparison:`);
  console.log(`      Full claims: ${fullClaims.length}`);
  console.log(`      Live claims: ${liveClaims.length}`);
  console.log(`      Author match rate: ${(matchRate * 100).toFixed(0)}%`);
  
  // Allow some variance (live mode might miss some or find extras due to chunking)
  const claimDiff = Math.abs(fullClaims.length - liveClaims.length);
  const passed = claimDiff <= 2 && matchRate >= 0.5;
  
  console.log(`      ${passed ? '✅ PASS' : '❌ FAIL'}`);
  
  return { passed, fullCount: fullClaims.length, liveCount: liveClaims.length, matchRate };
}

async function testDeduplication() {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('🔄 Testing Deduplication');
  
  const liveExtractor = new LiveModeExtractor();
  liveExtractor.startSession('dedup_test');
  
  // Simulate overlapping windows with same claim
  const chunk1 = 'So I was reading about this research and Dr Candow at University of Regina found that creatine helps with';
  const chunk2 = 'creatine helps with sleep deprivation and cognitive deficits were completely negated in his study participants';
  const chunk3 = 'participants showed improved performance. Moving on to another topic lets talk about protein timing';
  
  console.log('   Chunk 1: Candow claim starts...');
  const results1 = await liveExtractor.processChunk(chunk1);
  
  console.log('   Chunk 2: Candow claim continues...');
  const results2 = await liveExtractor.processChunk(chunk2);
  
  console.log('   Chunk 3: New topic...');
  const results3 = await liveExtractor.processChunk(chunk3);
  
  const allClaims = liveExtractor.getAllClaims();
  const candowClaims = allClaims.filter(c => 
    c.extraction.author_normalized === 'Darren Candow'
  );
  
  console.log(`\n   Total claims: ${allClaims.length}`);
  console.log(`   Candow claims: ${candowClaims.length}`);
  
  // Should only emit Candow once
  const passed = candowClaims.length <= 1;
  console.log(`   ${passed ? '✅ PASS' : '❌ FAIL'}: ${passed ? 'No duplicates' : 'Duplicates detected!'}`);
  
  return passed;
}

async function main() {
  console.log('🧪 Live Mode Extraction Test\n');
  console.log('='.repeat(60));
  
  // Test deduplication first
  const dedupPassed = await testDeduplication();
  
  // Load transcripts
  const { data: transcripts } = await supabase
    .from('transcriptions')
    .select('podcast_id, transcript');
  
  if (!transcripts || transcripts.length === 0) {
    console.error('❌ No transcripts found');
    process.exit(1);
  }
  
  // Test on a few transcripts (not all - saves API calls)
  const testVideos = ['yt-M61oqDvNsN8', 'yt-xXVB8A5xvSw']; // Creatine, Body Recomp
  let passed = dedupPassed ? 1 : 0;
  let failed = dedupPassed ? 0 : 1;
  
  for (const videoId of testVideos) {
    const transcript = transcripts.find(t => t.podcast_id === videoId);
    if (!transcript) continue;
    
    const result = await testLiveVsFull(videoId, transcript.transcript);
    if (result.passed) passed++;
    else failed++;
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 RESULTS');
  console.log(`   Tests passed: ${passed}`);
  console.log(`   Tests failed: ${failed}`);
  console.log('='.repeat(60));
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);

