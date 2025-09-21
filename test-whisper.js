#!/usr/bin/env node

/**
 * Test script for Whisper integration
 * This script tests the API server endpoints and validates the integration
 */

import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3001';

async function testEndpoint(endpoint, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await response.json();
    
    console.log(`\n🔍 Testing ${method} ${endpoint}`);
    console.log(`Status: ${response.status}`);
    console.log(`Response:`, JSON.stringify(data, null, 2));
    
    return { success: response.ok, data, status: response.status };
  } catch (error) {
    console.error(`❌ Error testing ${endpoint}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('🧪 Starting Whisper Integration Tests\n');
  
  // Test 1: Health Check
  console.log('='.repeat(50));
  console.log('TEST 1: Health Check');
  console.log('='.repeat(50));
  await testEndpoint('/api/health');
  
  // Test 2: Service Status
  console.log('\n' + '='.repeat(50));
  console.log('TEST 2: Service Status');
  console.log('='.repeat(50));
  await testEndpoint('/api/status');
  
  // Test 3: Cost Monitoring
  console.log('\n' + '='.repeat(50));
  console.log('TEST 3: Cost Monitoring');
  console.log('='.repeat(50));
  await testEndpoint('/api/costs/daily');
  await testEndpoint('/api/costs/summary');
  
  // Test 4: Invalid Audio (should fail gracefully)
  console.log('\n' + '='.repeat(50));
  console.log('TEST 4: Invalid Audio Handling');
  console.log('='.repeat(50));
  
  // Create a minimal test file
  const fs = await import('fs');
  const testContent = Buffer.from('fake audio content');
  fs.writeFileSync('test-audio.webm', testContent);
  
  try {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('audio', fs.createReadStream('test-audio.webm'));
    form.append('filename', 'test-audio.webm');
    form.append('videoId', 'test-video-123');
    form.append('duration', '5');
    
    const response = await fetch(`${API_BASE}/api/transcribe/audio`, {
      method: 'POST',
      body: form
    });
    
    const data = await response.json();
    console.log(`\n🔍 Testing POST /api/transcribe/audio (invalid audio)`);
    console.log(`Status: ${response.status}`);
    console.log(`Response:`, JSON.stringify(data, null, 2));
    
  } catch (error) {
    console.error('❌ Error testing audio upload:', error.message);
  } finally {
    // Clean up test file
    try {
      fs.unlinkSync('test-audio.webm');
    } catch (e) {
      // File might not exist
    }
  }
  
  // Test 5: Final Status Check
  console.log('\n' + '='.repeat(50));
  console.log('TEST 5: Final Status Check');
  console.log('='.repeat(50));
  await testEndpoint('/api/status');
  
  console.log('\n✅ All tests completed!');
}

// Run tests
runTests().catch(console.error);
