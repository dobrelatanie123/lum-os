#!/bin/bash

echo "🎬 Testing YouTube Pipeline Debug"
echo "================================="

# Test 1: Health check
echo "1. Health Check:"
curl -s http://localhost:3001/api/health | jq .

echo -e "\n2. Service Status:"
curl -s http://localhost:3001/api/status | jq .

echo -e "\n3. YouTube Info (should work):"
curl -s -X POST "http://localhost:3001/api/youtube-info" \
  -H "Content-Type: application/json" \
  -d '{"videoUrl": "https://www.youtube.com/watch?v=xXVB8A5xvSw"}' | jq .

echo -e "\n4. Testing YouTube Processing (this might take a while):"
echo "Starting YouTube processing..."

# Start the request in background and monitor
curl -X POST "http://localhost:3001/api/process-youtube" \
  -H "Content-Type: application/json" \
  -d '{"videoUrl": "https://www.youtube.com/watch?v=xXVB8A5xvSw", "videoId": "xXVB8A5xvSw"}' \
  --max-time 120 \
  -w "\nHTTP Status: %{http_code}\nTotal Time: %{time_total}s\n" \
  | jq . &

# Monitor the process
CURL_PID=$!
echo "Curl PID: $CURL_PID"

# Wait for completion or timeout
wait $CURL_PID
EXIT_CODE=$?

echo -e "\nProcess completed with exit code: $EXIT_CODE"
