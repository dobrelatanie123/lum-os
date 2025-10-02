#!/usr/bin/env node

/**
 * Database Monitor Script
 * Monitors the Supabase database for new alerts in real-time
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'http://127.0.0.1:55431';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Starting database monitor...');
console.log('📊 Watching for new alerts in real-time');
console.log('⏹️  Press Ctrl+C to stop\n');

// Function to display alerts in a nice format
function displayAlert(alert) {
  const timestamp = new Date(alert.created_at).toLocaleString();
  const details = typeof alert.details === 'string' ? JSON.parse(alert.details) : alert.details;
  
  console.log('🚨 NEW ALERT DETECTED!');
  console.log('═'.repeat(50));
  console.log(`📅 Time: ${timestamp}`);
  console.log(`🆔 ID: ${alert.id.substring(0, 8)}...`);
  console.log(`📺 Video: ${alert.podcast_id}`);
  console.log(`🏷️  Type: ${alert.alert_type}`);
  console.log(`⚖️  Verdict: ${details.verdict?.toUpperCase() || 'UNKNOWN'}`);
  console.log(`💬 Claim: "${details.claim || 'No claim'}"`);
  console.log(`🧠 Reasoning: ${details.reasoning?.substring(0, 100) || 'No reasoning'}...`);
  console.log('═'.repeat(50));
  console.log('');
}

// Function to get current alerts count
async function getCurrentAlerts() {
  try {
    const { data, error } = await supabase
      .from('alerts')
      .select('*', { count: 'exact' });
    
    if (error) {
      console.error('❌ Error fetching alerts:', error);
      return 0;
    }
    
    return data?.length || 0;
  } catch (error) {
    console.error('❌ Database connection error:', error);
    return 0;
  }
}

// Function to get alerts for specific video
async function getAlertsForVideo(videoId) {
  try {
    const podcastId = `yt-${videoId}`;
    const { data, error } = await supabase
      .from('alerts')
      .select('*')
      .eq('podcast_id', podcastId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('❌ Error fetching alerts for video:', error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    console.error('❌ Database connection error:', error);
    return [];
  }
}

// Main monitoring function
async function startMonitoring() {
  console.log('📊 Current database status:');
  
  // Show current alerts count
  const totalAlerts = await getCurrentAlerts();
  console.log(`📈 Total alerts in database: ${totalAlerts}`);
  
  // Show alerts for the test video if any
  const testVideoAlerts = await getAlertsForVideo('xXVB8A5xvSw');
  console.log(`🎬 Alerts for test video (xXVB8A5xvSw): ${testVideoAlerts.length}`);
  
  if (testVideoAlerts.length > 0) {
    console.log('\n📋 Existing alerts for test video:');
    testVideoAlerts.forEach(alert => displayAlert(alert));
  }
  
  console.log('\n👀 Now monitoring for new alerts...\n');
  
  // Set up real-time subscription
  const subscription = supabase
    .channel('alerts_changes')
    .on('postgres_changes', 
      { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'alerts' 
      }, 
      (payload) => {
        console.log('🔔 Database change detected!');
        displayAlert(payload.new);
      }
    )
    .subscribe();
  
  // Also poll every 5 seconds as backup
  setInterval(async () => {
    const currentCount = await getCurrentAlerts();
    if (currentCount > totalAlerts) {
      console.log(`📊 Alert count increased: ${totalAlerts} → ${currentCount}`);
      // Fetch and display new alerts
      const newAlerts = await getAlertsForVideo('xXVB8A5xvSw');
      newAlerts.slice(0, currentCount - totalAlerts).forEach(alert => displayAlert(alert));
    }
  }, 5000);
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Stopping database monitor...');
    subscription.unsubscribe();
    process.exit(0);
  });
}

// Start monitoring
startMonitoring().catch(console.error);
