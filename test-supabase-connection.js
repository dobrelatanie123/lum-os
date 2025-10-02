#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'http://127.0.0.1:55431';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

console.log('Testing Supabase connection...');
console.log('URL:', supabaseUrl);
console.log('Key:', supabaseKey.substring(0, 20) + '...');

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  try {
    // Test 1: Simple select
    console.log('\n1. Testing simple select...');
    const { data: alerts, error: alertsError } = await supabase
      .from('alerts')
      .select('*')
      .limit(1);
    
    console.log('Alerts result:', alerts);
    console.log('Alerts error:', alertsError);

    // Test 2: Insert test alert
    console.log('\n2. Testing insert...');
    const testAlert = {
      podcast_id: 'yt-xXVB8A5xvSw',
      user_id: 'demo-user-123',
      alert_type: 'fact_check',
      details: JSON.stringify({
        claim: 'Test claim from script',
        verdict: 'verified',
        reasoning: 'Test reasoning',
        sources: [],
        timestamp: Date.now()
      })
    };

    const { data: insertData, error: insertError } = await supabase
      .from('alerts')
      .insert(testAlert);

    console.log('Insert result:', insertData);
    console.log('Insert error:', insertError);

    // Test 3: Verify insert
    console.log('\n3. Verifying insert...');
    const { data: verifyData, error: verifyError } = await supabase
      .from('alerts')
      .select('*')
      .eq('podcast_id', 'yt-xXVB8A5xvSw');

    console.log('Verify result:', verifyData);
    console.log('Verify error:', verifyError);

  } catch (error) {
    console.error('Connection test failed:', error);
  }
}

testConnection();
