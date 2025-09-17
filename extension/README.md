# Lumos Browser Extension

Real-time fact-checking for YouTube videos using AI.

## Features

- 🎤 **Real-time Audio Monitoring**: Captures audio from YouTube videos as you watch
- 🤖 **AI-Powered Analysis**: Uses OpenAI Whisper for transcription and GPT-4 for fact-checking
- 🚨 **Instant Alerts**: Shows browser notifications for potential misinformation
- 📊 **Detailed Analysis**: Links to detailed fact-check reports
- ⚙️ **Configurable**: Auto-start monitoring, confidence thresholds

## Installation

### Development Mode

1. Open Chrome/Edge and go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked" and select the `extension` folder
4. The Lumos icon should appear in your browser toolbar

### Required Setup

1. Make sure the Lumos backend is running at `http://localhost:4322`
2. Configure your OpenAI API key in the backend `.env` file
3. Grant necessary permissions when prompted:
   - **Notifications**: For fact-check alerts
   - **Audio Capture**: For monitoring YouTube audio

## Usage

1. **Navigate to YouTube**: Go to any YouTube video
2. **Open Extension**: Click the Lumos icon in toolbar
3. **Start Monitoring**: Click "Start Monitoring" button
4. **Automatic Analysis**: Extension will:
   - Capture audio in 10-second chunks
   - Send to Whisper API for transcription
   - Analyze transcript for misinformation
   - Show notifications for suspicious content

## How It Works

```
YouTube Video → Audio Capture → Whisper API → Transcript
                    ↓
Browser Notification ← LLM Analysis ← Fact-Check API
```

1. **Audio Capture**: Uses `MediaRecorder` API to capture YouTube audio
2. **Chunking**: Splits audio into 10-second chunks for real-time processing
3. **Transcription**: Sends audio to OpenAI Whisper API
4. **Analysis**: LLM analyzes transcript for potential misinformation
5. **Alerts**: High-confidence alerts trigger browser notifications

## Configuration

### Auto-Start Monitoring
- Toggle in popup to automatically start monitoring new videos

### Alert Threshold
- Confidence level (0.7-1.0) for showing notifications
- Higher = fewer false positives, lower = more sensitive

### API Endpoint
- Default: `http://localhost:4322`
- Configurable for different backend deployments

## Permissions Required

- **activeTab**: Access current YouTube tab
- **notifications**: Show fact-check alerts
- **storage**: Save user preferences
- **background**: Background processing
- **host permissions**: Access YouTube and local API

## Privacy & Data

- **Audio Processing**: Audio chunks are sent to OpenAI for transcription
- **Local Storage**: Only user preferences stored locally
- **No Persistent Recording**: Audio is processed in real-time, not stored
- **Anonymized**: No personal data linked to fact-checks

## Troubleshooting

### Extension Not Working
1. Check developer console for errors (`F12` → Console)
2. Verify backend is running at `http://localhost:4322`
3. Refresh YouTube page and retry

### No Audio Capture
1. Grant microphone/screen capture permissions
2. Try refreshing the page
3. Check if other apps are using audio

### No Notifications
1. Enable notifications in browser settings
2. Check notification permissions for the extension
3. Try lowering confidence threshold

## Development

### Project Structure
```
extension/
├── manifest.json          # Extension configuration
├── background.js          # Service worker
├── content.js            # YouTube page integration
├── popup.html            # Extension popup UI
├── popup.js              # Popup functionality
└── icons/                # Extension icons
```

### Testing
1. Load extension in developer mode
2. Open YouTube video with captions/speech
3. Monitor console logs in background page
4. Test with known misinformation content

### Building
No build process required - extension runs directly from source files.

## API Endpoints

- `POST /api/transcribe/audio` - Transcribe audio chunk
- `GET /api/alerts?video_id=X` - Get alerts for video
- `GET /api/jobs/{id}` - Check processing status

## Costs

- **Whisper API**: ~$0.006 per minute of audio
- **GPT-4o-mini**: ~$0.01 per fact-check analysis
- **Total**: ~$0.02-0.05 per hour of monitored content

## License

MIT License - See LICENSE file for details.


