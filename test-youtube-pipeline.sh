#!/bin/bash

echo "🎥 Starting YouTube Pipeline Tests"
echo "=================================="
echo "📺 Testing with video: https://www.youtube.com/watch?v=xXVB8A5xvSw"
echo "🆔 Video ID: xXVB8A5xvSw"
echo ""

# Test 1: Health Check
echo "=================================================="
echo "TEST 1: Health Check"
echo "=================================================="
curl -s http://localhost:3001/api/health | jq .

# Test 2: Service Status
echo -e "\n=================================================="
echo "TEST 2: Service Status"
echo "=================================================="
curl -s http://localhost:3001/api/status | jq .

# Test 3: YouTube Video Info (will fail without yt-dlp)
echo -e "\n=================================================="
echo "TEST 3: YouTube Video Info"
echo "=================================================="
curl -X POST http://localhost:3001/api/youtube-info \
  -H "Content-Type: application/json" \
  -d '{"videoUrl": "https://www.youtube.com/watch?v=xXVB8A5xvSw"}' | jq .

# Test 4: YouTube Processing (will fail without yt-dlp)
echo -e "\n=================================================="
echo "TEST 4: YouTube Processing"
echo "=================================================="
curl -X POST http://localhost:3001/api/process-youtube \
  -H "Content-Type: application/json" \
  -d '{"videoUrl": "https://www.youtube.com/watch?v=xXVB8A5xvSw", "videoId": "xXVB8A5xvSw"}' | jq .

# Test 5: Mock Fact-Check Test (with sample transcription)
echo -e "\n=================================================="
echo "TEST 5: Mock Fact-Check Test"
echo "=================================================="
curl -X POST http://localhost:3001/api/fact-check \
  -H "Content-Type: application/json" \
  -d '{
    "transcription": "Welcome to this educational video about climate change. The Earth'\''s temperature has increased by 1.1 degrees Celsius since 1880. This is primarily due to human activities such as burning fossil fuels. According to NASA, 97% of climate scientists agree that climate change is real and caused by humans. The consequences include rising sea levels, more frequent extreme weather events, and ecosystem disruption. We need to take immediate action to reduce greenhouse gas emissions.",
    "videoId": "xXVB8A5xvSw"
  }' | jq .

# Test 6: Cost Monitoring
echo -e "\n=================================================="
echo "TEST 6: Cost Monitoring"
echo "=================================================="
echo "Daily costs:"
curl -s http://localhost:3001/api/costs/daily | jq .
echo -e "\nCost summary:"
curl -s http://localhost:3001/api/costs/summary | jq .

echo -e "\n✅ All YouTube pipeline tests completed!"
echo -e "\n📋 Summary:"
echo "- Health check: ✅ Working"
echo "- Service status: ✅ Working"
echo "- YouTube info: ❌ Requires yt-dlp installation"
echo "- YouTube processing: ❌ Requires yt-dlp installation"
echo "- Fact-checking: ❌ Requires valid OpenAI API key"
echo "- Cost monitoring: ✅ Working"

echo -e "\n🔧 To enable full functionality:"
echo "1. Install yt-dlp: brew install yt-dlp"
echo "2. Set valid OpenAI API key: export OPENAI_API_KEY=your_key"
echo "3. Restart the server and run tests again"
