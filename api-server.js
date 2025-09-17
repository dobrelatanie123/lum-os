#!/usr/bin/env node

// Standalone API server for Lumos (bypass Astro issues)
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// CORS for browser extension
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Lumos API Server is running',
    timestamp: Date.now() 
  });
});

// Audio transcription endpoint
app.post('/api/transcribe/audio', upload.single('audio'), async (req, res) => {
  try {
    console.log('📤 Received audio transcription request');
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No audio file provided'
      });
    }

    const { videoId, timestamp } = req.body;
    
    if (!videoId) {
      return res.status(400).json({
        success: false,
        message: 'Missing videoId'
      });
    }

    console.log(`Processing audio: ${req.file.originalname} (${req.file.size} bytes) for video ${videoId}`);

    // Mock response for now (replace with real Whisper + LLM later)
    const mockResult = {
      success: true,
      transcript: "This is a mock transcription of the audio chunk.",
      segments: [
        { text: "This is a mock transcription", offset: 0, duration: 2 },
        { text: "of the audio chunk.", offset: 2, duration: 2 }
      ],
      alerts: [
        {
          claim: "Mock potentially false claim detected",
          verdict: "unverified", 
          confidence: 0.8,
          reasoning: "This is a mock alert for testing purposes"
        }
      ],
      timestamp: timestamp || Date.now(),
      videoId
    };

    console.log('✅ Mock transcription completed');
    res.json(mockResult);

  } catch (error) {
    console.error('❌ Transcription failed:', error);
    res.status(500).json({
      success: false,
      message: 'Transcription failed',
      error: error.message
    });
  }
});

// Start server
const PORT = 3001; // Different port to avoid Astro conflicts

app.listen(PORT, () => {
  console.log(`🚀 Lumos API Server running on http://localhost:${PORT}`);
  console.log(`📡 Ready to receive requests from browser extension`);
  console.log(`🧪 Test: curl http://localhost:${PORT}/api/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down Lumos API Server...');
  process.exit(0);
});


