#!/usr/bin/env node

// Standalone API server for Lumos (bypass Astro issues)
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Import AI services
import { AudioProcessor } from './dist/services/audio-processor.js';
import { FactChecker } from './dist/services/fact-checker.js';
import { YouTubeProcessor } from './dist/services/youtube-processor.js';
import { RetryHandler, CircuitBreaker } from './dist/services/retry-handler.js';
import { CostTracker } from './dist/services/cost-tracker.js';
import { validateAIConfig } from './dist/lib/ai-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Initialize AI services
let audioProcessor;
let factChecker;
let youtubeProcessor;
let costTracker;
let whisperCircuitBreaker;

try {
  // Validate configuration first
  validateAIConfig();
  
  // Initialize services
  audioProcessor = new AudioProcessor();
  costTracker = new CostTracker();
  factChecker = new FactChecker(costTracker);
  youtubeProcessor = new YouTubeProcessor(audioProcessor, factChecker, costTracker);
  whisperCircuitBreaker = new CircuitBreaker(3, 60000, 2); // 3 failures, 1 min timeout, 2 successes to close
  
  console.log('🤖 AI services initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize AI services:', error.message);
  console.log('💡 Make sure to set OPENAI_API_KEY in your environment');
  process.exit(1);
}

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

// Audio transcription endpoint with real Whisper integration
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

    console.log(`🎤 Processing audio: ${req.file.originalname} (${req.file.size} bytes) for video ${videoId}`);

    // Use retry handler with circuit breaker for robust processing
    const transcriptionResult = await RetryHandler.withRetry(
      () => RetryHandler.withCircuitBreaker(
        () => audioProcessor.transcribeAudio(req.file.buffer, req.file.originalname),
        whisperCircuitBreaker
      ),
      3, // max retries
      1000 // base delay
    );

    // Track cost
    await costTracker.trackWhisperCost(transcriptionResult.duration, 'transcription');

    // Prepare response
    const response = {
      success: true,
      transcript: transcriptionResult.text,
      segments: transcriptionResult.segments,
      language: transcriptionResult.language,
      duration: transcriptionResult.duration,
      alerts: [], // Will be populated by GPT-4 in Phase 3
      overallConfidence: 1.0, // Will be calculated by GPT-4 in Phase 3
      processingTime: transcriptionResult.processingTime,
      cost: transcriptionResult.cost,
      chunkMetadata: {
        timestamp: parseInt(timestamp) || Date.now(),
        duration: transcriptionResult.duration,
        processingTime: transcriptionResult.processingTime,
        chunkIndex: 0 // Will be calculated properly in future versions
      },
      videoId
    };

    console.log(`✅ Transcription completed: ${transcriptionResult.text.substring(0, 100)}... (${transcriptionResult.processingTime}ms, $${transcriptionResult.cost.toFixed(4)})`);
    res.json(response);

  } catch (error) {
    console.error('❌ Transcription failed:', error);
    
    // Handle different error types
    let statusCode = 500;
    let errorMessage = 'Transcription failed';
    
    if (error.message.includes('Rate limit exceeded')) {
      statusCode = 429;
      errorMessage = 'Rate limit exceeded. Please try again later.';
    } else if (error.message.includes('Cost limit exceeded')) {
      statusCode = 402;
      errorMessage = 'Daily cost limit exceeded. Please try again tomorrow.';
    } else if (error.message.includes('Invalid audio file')) {
      statusCode = 400;
      errorMessage = 'Invalid audio file format.';
    } else if (error.message.includes('Circuit breaker is OPEN')) {
      statusCode = 503;
      errorMessage = 'Service temporarily unavailable. Please try again later.';
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: error.message,
      retryable: error.retryable !== false
    });
  }
});

// Cost monitoring endpoints
app.get('/api/costs/daily', (req, res) => {
  try {
    const whisperCost = costTracker.getDailyCost('whisper');
    const gptCost = costTracker.getDailyCost('gpt');
    const totalCost = costTracker.getTotalDailyCost();
    const costLimit = costTracker.getCostTrackingInfo('whisper').costLimit;
    
    res.json({
      success: true,
      data: {
        whisper: whisperCost,
        gpt: gptCost,
        total: totalCost,
        limit: costLimit,
        percentage: (totalCost / costLimit) * 100,
        alerts: costTracker.getCostAlerts()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get cost information',
      error: error.message
    });
  }
});

app.get('/api/costs/summary', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const summary = costTracker.getCostSummary(days);
    const estimatedMonthly = costTracker.estimateMonthlyCost();
    
    res.json({
      success: true,
      data: {
        summary,
        estimatedMonthly,
        isApproachingLimit: costTracker.isCostLimitApproaching()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get cost summary',
      error: error.message
    });
  }
});

// Fact-checking analysis endpoint
app.post('/api/fact-check', async (req, res) => {
  try {
    const { transcription, videoId } = req.body;
    
    if (!transcription || !videoId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: transcription, videoId'
      });
    }

    console.log(`🔍 Starting fact-check analysis for video ${videoId}`);
    
    const factCheckResult = await factChecker.analyzeTranscription(transcription, videoId);
    
    res.json({
      success: true,
      data: factCheckResult
    });
  } catch (error) {
    console.error('❌ Fact-check analysis failed:', error);
    
    res.status(500).json({
      success: false,
      message: 'Fact-check analysis failed',
      error: error.message,
      retryable: error.retryable || false
    });
  }
});

// YouTube video processing endpoint
app.post('/api/process-youtube', async (req, res) => {
  try {
    const { videoUrl, videoId } = req.body;
    
    if (!videoUrl || !videoId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: videoUrl, videoId'
      });
    }

    console.log(`🎥 Processing YouTube video: ${videoId}`);
    
    // Check dependencies first
    const depsAvailable = await youtubeProcessor.checkDependencies();
    if (!depsAvailable) {
      return res.status(500).json({
        success: false,
        message: 'yt-dlp is not installed. Please install it first: brew install yt-dlp'
      });
    }

    const result = await youtubeProcessor.processVideo(videoUrl, videoId);
    
    res.json({
      success: true,
      data: {
        videoId,
        videoUrl,
        transcription: result.transcription,
        factCheck: result.factCheck,
        totalCost: result.totalCost,
        processingTime: result.processingTime
      }
    });
  } catch (error) {
    console.error('❌ YouTube processing failed:', error);
    
    res.status(500).json({
      success: false,
      message: 'YouTube processing failed',
      error: error.message,
      retryable: error.retryable || false
    });
  }
});

// YouTube video info endpoint
app.post('/api/youtube-info', async (req, res) => {
  try {
    const { videoUrl } = req.body;
    
    if (!videoUrl) {
      return res.status(400).json({
        success: false,
        message: 'Missing required field: videoUrl'
      });
    }

    console.log(`ℹ️ Getting YouTube video info: ${videoUrl}`);
    
    // Check dependencies first
    const depsAvailable = await youtubeProcessor.checkDependencies();
    if (!depsAvailable) {
      return res.status(500).json({
        success: false,
        message: 'yt-dlp is not installed. Please install it first: brew install yt-dlp'
      });
    }

    const videoInfo = await youtubeProcessor.getVideoInfo(videoUrl);
    
    res.json({
      success: true,
      data: videoInfo
    });
  } catch (error) {
    console.error('❌ Failed to get YouTube video info:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to get video information',
      error: error.message
    });
  }
});

// Service status endpoint
app.get('/api/status', (req, res) => {
  try {
    const whisperRateLimit = audioProcessor.getRateLimitInfo('whisper');
    const whisperCost = costTracker.getDailyCost('whisper');
    const whisperCircuitBreakerState = whisperCircuitBreaker.getState();
    const gptCircuitBreakerState = factChecker.getCircuitBreakerStatus();
    const gptCost = costTracker.getDailyCost('gpt');
    
    res.json({
      success: true,
      data: {
        services: {
          whisper: {
            status: whisperCircuitBreakerState === 'OPEN' ? 'unavailable' : 'available',
            rateLimit: whisperRateLimit,
            dailyCost: whisperCost,
            circuitBreakerState: whisperCircuitBreakerState
          },
          gpt: {
            status: gptCircuitBreakerState === 'OPEN' ? 'unavailable' : 'available',
            dailyCost: gptCost,
            circuitBreakerState: gptCircuitBreakerState
          }
        },
        timestamp: Date.now()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get service status',
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


