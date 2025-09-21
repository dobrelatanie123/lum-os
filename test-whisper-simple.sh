#!/bin/bash

echo "🧪 Starting Whisper Integration Tests"
echo "======================================"

# Test 1: Health Check
echo -e "\n🔍 TEST 1: Health Check"
echo "------------------------"
curl -s http://localhost:3001/api/health | jq .

# Test 2: Service Status
echo -e "\n🔍 TEST 2: Service Status"
echo "---------------------------"
curl -s http://localhost:3001/api/status | jq .

# Test 3: Cost Monitoring
echo -e "\n🔍 TEST 3: Cost Monitoring"
echo "----------------------------"
echo "Daily costs:"
curl -s http://localhost:3001/api/costs/daily | jq .
echo -e "\nCost summary:"
curl -s http://localhost:3001/api/costs/summary | jq .

# Test 4: Invalid Audio (should fail gracefully)
echo -e "\n🔍 TEST 4: Invalid Audio Handling"
echo "-----------------------------------"
echo "Creating test audio file..."
echo "fake audio content" > test-audio.webm

echo "Testing audio upload with invalid file..."
curl -X POST http://localhost:3001/api/transcribe/audio \
  -F "audio=@test-audio.webm" \
  -F "filename=test-audio.webm" \
  -F "videoId=test-video-123" \
  -F "duration=5" \
  -H "Content-Type: multipart/form-data" | jq .

# Clean up
rm -f test-audio.webm

# Test 5: Final Status Check
echo -e "\n🔍 TEST 5: Final Status Check"
echo "-------------------------------"
curl -s http://localhost:3001/api/status | jq .

echo -e "\n✅ All tests completed!"
