#!/usr/bin/env node

// YouTube Alert Processor - Processes videos and saves alerts to database
// Usage: node youtube-alert-processor.js <youtube-url>

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:55433';
const supabaseKey = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const supabase = createClient(supabaseUrl, supabaseKey);

async function saveAlertsToDatabase(videoId, factCheckResult) {
  try {
    console.log(`💾 Saving ${factCheckResult.claims?.length || 0} alerts to database...`);
    
    for (const claim of factCheckResult.claims || []) {
      const alert = {
        podcast_id: `yt-${videoId}`,
        user_id: 'demo-user-123',
        alert_type: 'fact_check',
        details: JSON.stringify({
          claim: claim.claim,
          verdict: claim.credibilityRating,
          reasoning: claim.analysis,
          sources: claim.sources || [],
          timestamp: Date.now()
        })
      };
      
      const { error } = await supabase
        .from('alerts')
        .insert(alert);
        
      if (error) {
        console.error('❌ Error saving alert:', error);
      } else {
        console.log('✅ Alert saved:', claim.claim.substring(0, 50) + '...');
      }
    }
  } catch (error) {
    console.error('❌ Failed to save alerts:', error);
  }
}

async function processYouTubeVideo(videoUrl) {
  try {
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

function extractVideoId(url) {
  const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Main execution
if (process.argv.length < 3) {
  console.log('Usage: node youtube-alert-processor.js <youtube-url>');
  console.log('Example: node youtube-alert-processor.js https://www.youtube.com/watch?v=xXVB8A5xvSw');
  process.exit(1);
}

const videoUrl = process.argv[2];
processYouTubeVideo(videoUrl);
