#!/bin/bash

echo "🔍 Monitoring Extension Test"
echo "============================"
echo ""
echo "1. Make sure the API server is running:"
echo "   curl http://localhost:3001/api/health"
echo ""
echo "2. Load the extension in Chrome:"
echo "   - Go to chrome://extensions/"
echo "   - Enable Developer Mode"
echo "   - Click 'Load unpacked'"
echo "   - Select the 'extension/' folder"
echo ""
echo "3. Test with YouTube video:"
echo "   https://www.youtube.com/watch?v=xXVB8A5xvSw"
echo ""
echo "4. Click the Lumos extension icon and 'Start Monitoring'"
echo ""
echo "5. Watch for these logs in the terminal:"
echo "   📤 Received audio transcription request"
echo "   🎤 Processing audio: chunk.webm"
echo "   💰 whisper cost: $0.0500"
echo "   ✅ Transcription completed"
echo "   🔍 Analyzing transcription for fact-checking"
echo "   🔍 Finding studies for claim:"
echo "   📚 Searching academic papers for:"
echo "   ✅ Found X relevant sources for claim"
echo "   💰 gpt cost: $0.0556"
echo "   ✅ GPT-4 fact-check completed"
echo ""
echo "6. Check the extension popup for alerts with study links!"
echo ""
echo "Press Ctrl+C to stop monitoring"
echo ""

# Monitor the server logs
tail -f /dev/null &
MONITOR_PID=$!

# Function to check server status
check_server() {
    if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
        echo "✅ API Server is running"
    else
        echo "❌ API Server is not running - start it with: node api-server.js"
    fi
}

# Check server status every 5 seconds
while true; do
    check_server
    sleep 5
done
