/**
 * Test Gemini 3 Flash Video Analysis
 * 
 * Usage:
 *   npx tsx scripts/test-gemini-analyze.ts [youtube_url]
 * 
 * Example:
 *   npx tsx scripts/test-gemini-analyze.ts "https://www.youtube.com/watch?v=VIDEO_ID"
 */

import dotenv from 'dotenv';
dotenv.config();

// Test videos from our existing dataset
const TEST_VIDEOS = [
  { id: 'M61oqDvNsN8', title: 'Creatine' },
  { id: 'xXVB8A5xvSw', title: 'Body Recomp' },
];

async function testAnalyzeEndpoint(youtubeUrl: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎬 Testing: ${youtubeUrl}`);
  console.log('='.repeat(60));
  
  const startTime = Date.now();
  
  try {
    const response = await fetch('http://localhost:3001/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ youtube_url: youtubeUrl })
    });
    
    const data = await response.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (!data.success) {
      console.log(`❌ Failed: ${data.message}`);
      return;
    }
    
    console.log(`\n✅ Success in ${elapsed}s`);
    console.log(`📹 Video: ${data.data.video_title}`);
    console.log(`📋 Claims found: ${data.data.claims_count}`);
    
    if (data.data.claims.length > 0) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log('EXTRACTED CLAIMS:');
      console.log('─'.repeat(60));
      
      for (const claim of data.data.claims) {
        console.log(`\n⏱️  [${claim.timestamp}] ${claim.confidence.toUpperCase()}`);
        console.log(`   Author: ${claim.author || 'unnamed'}`);
        console.log(`   Finding: ${claim.finding.slice(0, 80)}...`);
        console.log(`   Query: ${claim.search_queries.primary_query}`);
      }
    }
    
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    console.log('\n💡 Make sure the API server is running: node api-server.js');
  }
}

async function main() {
  const customUrl = process.argv[2];
  
  if (customUrl) {
    await testAnalyzeEndpoint(customUrl);
  } else {
    console.log('🧪 Testing Gemini 3 Flash Video Analysis\n');
    console.log('Usage: npx tsx scripts/test-gemini-analyze.ts [youtube_url]\n');
    console.log('Testing with sample video...');
    
    // Test with first video
    const testVideo = TEST_VIDEOS[0];
    await testAnalyzeEndpoint(`https://www.youtube.com/watch?v=${testVideo.id}`);
  }
}

main();

