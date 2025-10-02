#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'http://127.0.0.1:55431';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const supabase = createClient(supabaseUrl, supabaseKey);

async function saveTestAlerts() {
  console.log('🧪 Testing alert saving...');
  
  const testAlerts = [
    {
      podcast_id: 'yt-xXVB8A5xvSw',
      user_id: 'demo-user-123',
      alert_type: 'fact_check',
      details: JSON.stringify({
        claim: 'Is it possible to gain muscle while losing fat?',
        verdict: 'verified',
        reasoning: 'This is supported by multiple studies on body recomposition.',
        sources: ['Study 1', 'Study 2'],
        timestamp: Date.now()
      })
    },
    {
      podcast_id: 'yt-xXVB8A5xvSw',
      user_id: 'demo-user-123',
      alert_type: 'fact_check',
      details: JSON.stringify({
        claim: 'Protein should be 1-1.5g per pound of body weight',
        verdict: 'verified',
        reasoning: 'This is a well-established recommendation in sports nutrition.',
        sources: ['Nutrition Study 1', 'Sports Science Review'],
        timestamp: Date.now()
      })
    }
  ];

  for (const alert of testAlerts) {
    console.log(`Saving: ${JSON.parse(alert.details).claim}`);
    
    const { data, error } = await supabase
      .from('alerts')
      .insert(alert);
      
    if (error) {
      console.error('❌ Error:', error);
    } else {
      console.log('✅ Saved successfully');
    }
  }
  
  // Check what we have now
  console.log('\n📊 Current alerts in database:');
  const { data: allAlerts, error: fetchError } = await supabase
    .from('alerts')
    .select('*')
    .eq('podcast_id', 'yt-xXVB8A5xvSw');
    
  if (fetchError) {
    console.error('❌ Fetch error:', fetchError);
  } else {
    console.log(`Found ${allAlerts.length} alerts:`);
    allAlerts.forEach((alert, i) => {
      const details = JSON.parse(alert.details);
      console.log(`${i + 1}. ${details.claim} (${details.verdict})`);
    });
  }
}

saveTestAlerts();
