#!/usr/bin/env node

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

// Standalone API server for Lumos (bypass Astro issues)
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

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

// Optional Supabase (for live inserts). If not configured, API will still function without persistence
let supabase = null;
try {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('🗄️  Supabase client initialized');
  } else {
    console.log('ℹ️  Supabase env not set; live alerts will not be persisted');
  }
} catch (e) { console.warn('⚠️  Failed to init Supabase:', e?.message || e); }

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

// Root index - friendly status
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    name: 'Lumos API Server',
    status: 'ok',
    endpoints: {
      health: '/api/health',
      analyze: '/api/analyze (NEW - Gemini 3 Flash)',
      transcribe: '/api/transcribe/audio',
      factCheck: '/api/fact-check',
      processYouTube: '/api/process-youtube',
      alertsProxy: '/api/alerts/for-video'
    }
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

    // Best-effort persist to Supabase as well (fallback path used by extension)
    if (supabase) {
      try {
        const podcastId = `yt-${videoId}`;
        const demoUser = process.env.DEMO_USER_ID || 'demo-user-123';
        const { error: upPodcastErr } = await supabase.from('podcasts').upsert({
          id: podcastId,
          title: `YouTube ${videoId}`,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          description: 'Live processed video',
          user_id: demoUser
        }).select('id').maybeSingle();
        if (upPodcastErr) console.warn('⚠️  Fallback upsert podcast error:', upPodcastErr.message);

        const { data: existingT, error: tSelErr } = await supabase
          .from('transcriptions')
          .select('id, transcript')
          .eq('podcast_id', podcastId)
          .maybeSingle();
        if (tSelErr) console.warn('⚠️  Fallback select transcription error:', tSelErr.message);

        let newTranscript = String(transcriptionResult.text || '').trim();
        if (existingT?.transcript) {
          const appended = `${existingT.transcript}\n${newTranscript}`.trim();
          newTranscript = appended.slice(0, 500000);
        }
        const { error: tUpErr } = await supabase
          .from('transcriptions')
          .upsert({ podcast_id: podcastId, transcript: newTranscript }, { onConflict: 'podcast_id' });
        if (tUpErr) console.warn('⚠️  Fallback upsert transcription error:', tUpErr.message);
        else console.log('🗂️  Fallback transcription saved/updated');
      } catch (e) {
        console.warn('⚠️  Fallback transcription persist failed:', e?.message || e);
      }
    }

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

// Live: one-shot chunk → transcription → fact-check → persist (best-effort)
app.post('/api/live/chunk', upload.single('audio'), async (req, res) => {
  try {
    // Log incoming live chunk details
    try {
      const { videoId: vid, videoTimeSec: vts } = req.body || {};
      console.log('➡️  /api/live/chunk', {
        videoId: vid,
        videoTimeSec: vts,
        originalname: req.file?.originalname,
        size: req.file?.size
      });
    } catch {}
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No audio file provided' });
    }
    const { videoId, videoTimeSec, url } = req.body || {};
    if (!videoId) {
      return res.status(400).json({ success: false, message: 'Missing videoId' });
    }

    const start = Date.now();
    // Transcribe with retry + circuit breaker
    const tr = await RetryHandler.withRetry(
      () => RetryHandler.withCircuitBreaker(
        () => audioProcessor.transcribeAudio(req.file.buffer, req.file.originalname || 'chunk.webm'),
        whisperCircuitBreaker
      ),
      3,
      1000
    );
    await costTracker.trackWhisperCost(tr.duration, 'transcription');
    try { console.log('🎤 Live transcription ok', { len: (tr.text || '').length, duration: tr.duration }); } catch {}

    // Fact-check the transcription text (best-effort; do not fail the whole request)
    let fc = null;
    try {
      fc = await factChecker.analyzeTranscription(tr.text, videoId);
    } catch (fcErr) {
      console.warn('⚠️  Fact-check failed for live chunk (continuing with transcript only):', fcErr?.message || fcErr);
      fc = { claims: [], overallCredibility: 'unknown' };
    }

    // Map GPT claims -> alert items expected by extension/background
    const credibilityToVerdict = (c) => {
      const v = (c || '').toLowerCase();
      if (v === 'high') return 'high';
      if (v === 'medium') return 'medium';
      return 'low';
    };
    const credibilityToConf = (c) => {
      const v = (c || '').toLowerCase();
      if (v === 'high') return 0.9;
      if (v === 'medium') return 0.6;
      return 0.3;
    };

    const mappedAlerts = Array.isArray(fc?.claims) ? fc.claims.map((cl) => {
      const srcs = Array.isArray(cl?.sources) ? cl.sources.filter(s => s && typeof s.url === 'string' && /^https?:\/\//.test(s.url)).map(s => s.url) : [];
      return {
        claim: cl?.text || '',
        verdict: credibilityToVerdict(cl?.credibility),
        confidence: credibilityToConf(cl?.credibility),
        reasoning: cl?.analysis || '',
        sources: srcs,
        timestamp: Date.now(),
        video_time_sec: Number.isFinite(Number(videoTimeSec)) ? Math.floor(Number(videoTimeSec)) : 0
      };
    }).filter(a => a.claim) : [];

    // Best-effort persistence to Supabase
    if (supabase) {
      try {
        const podcastId = `yt-${videoId}`;
        const demoUser = process.env.DEMO_USER_ID || 'demo-user-123';
        // Ensure podcast exists
        const { data: upPodcast, error: upPodcastErr } = await supabase.from('podcasts').upsert({
          id: podcastId,
          title: url || `YouTube ${videoId}`,
          url: url || `https://www.youtube.com/watch?v=${videoId}`,
          description: 'Live processed video',
          user_id: demoUser
        }).select('id').maybeSingle();
        if (upPodcastErr) {
          console.warn('⚠️  Live upsert podcast error:', upPodcastErr.message);
        } else {
          console.log('✅ Live upsert podcast ok', { podcastId });
        }

        // Upsert/append transcript text for this podcast
        try {
          const { data: existingT, error: tSelErr } = await supabase
            .from('transcriptions')
            .select('id, transcript')
            .eq('podcast_id', podcastId)
            .maybeSingle();
          if (tSelErr) {
            console.warn('⚠️  Live select transcription error:', tSelErr.message);
          }
          let newTranscript = String(tr.text || '').trim();
          if (existingT && existingT.transcript) {
            const appended = `${existingT.transcript}\n${newTranscript}`.trim();
            // Safety cap to avoid unbounded growth in dev
            newTranscript = appended.slice(0, 500000);
          }
          const { error: tUpErr } = await supabase
            .from('transcriptions')
            .upsert({ podcast_id: podcastId, transcript: newTranscript }, { onConflict: 'podcast_id' });
          if (tUpErr) {
            console.warn('⚠️  Live upsert transcription error:', tUpErr.message);
          } else {
            console.log('🗂️  Live transcription saved/updated');
          }
        } catch (tErr) {
          console.warn('⚠️  Live transcription persist failed:', tErr?.message || tErr);
        }

        // Insert alerts (if any)
        if (mappedAlerts.length) {
          const rows = mappedAlerts.map(a => ({
            podcast_id: podcastId,
            user_id: demoUser,
            alert_type: 'fact_check',
            details: JSON.stringify({
              claim: a.claim,
              verdict: a.verdict,
              reasoning: a.reasoning,
              sources: a.sources,
              timestamp: a.timestamp,
              video_time_sec: a.video_time_sec
            }),
            urls: JSON.stringify(a.sources)
          }));
          const { data: inserted, error: upErr } = await supabase.from('alerts').insert(rows).select('id');
          if (upErr) {
            console.warn('⚠️  Live insert alerts error:', upErr.message);
          } else {
            console.log('✅ Live insert alerts ok', { count: inserted?.length || 0, videoId });
          }
        }
      } catch (persistErr) {
        console.warn('⚠️  Live insert failed (non-fatal):', persistErr?.message || persistErr);
      }
    }

    const elapsed = Date.now() - start;
    try {
      console.log('⬅️  /api/live/chunk done', { videoId, elapsed, alerts: mappedAlerts.length, transcriptLen: (tr.text || '').length });
    } catch {}
    return res.json({
      success: true,
      transcript: tr.text,
      alerts: mappedAlerts,
      duration: tr.duration,
      processingTime: elapsed,
      videoId
    });
  } catch (err) {
    console.error('❌ /api/live/chunk failed:', err);
    return res.status(200).json({ success: false, message: 'Live processing failed', error: err?.message || String(err) });
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

// Proxy grouped alerts from Astro to keep extension on port 3001
app.get('/api/alerts/for-video', async (req, res) => {
  try {
    console.log('🔎 Proxy /api/alerts/for-video request', req.query);
    const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?') + 1) : '';
    const target = `http://localhost:4321/api/alerts/for-video${qs ? `?${qs}` : ''}`;
    console.log('↗️  Forwarding to', target);
    const resp = await fetch(target, { method: 'GET' });
    const text = await resp.text();
    res.status(resp.status).set('Content-Type', resp.headers.get('content-type') || 'application/json').send(text);
  } catch (err) {
    console.error('❌ Proxy /api/alerts/for-video failed:', err);
    res.status(502).json({ success: false, message: 'Proxy failed', error: (err && err.message) || String(err) });
  }
});

// YouTube video processing endpoint
// Pass transcribeOnly=true for faster processing (skips GPT fact-checking)
app.post('/api/process-youtube', async (req, res) => {
  try {
    const { videoUrl, videoId, transcribeOnly } = req.body;
    
    if (!videoUrl || !videoId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: videoUrl, videoId'
      });
    }

    const fastMode = transcribeOnly === true;
    console.log(`🎥 Processing YouTube video: ${videoId}${fastMode ? ' (FAST MODE - transcript only)' : ''}`);
    
    // Check dependencies first
    const depsAvailable = await youtubeProcessor.checkDependencies();
    if (!depsAvailable) {
      return res.status(500).json({
        success: false,
        message: 'yt-dlp is not installed. Please install it first: brew install yt-dlp'
      });
    }

    const result = await youtubeProcessor.processVideo(videoUrl, videoId, fastMode);
    
    // Save to Supabase
    if (supabase) {
      try {
        const podcastId = `yt-${videoId}`;
        const demoUser = process.env.DEMO_USER_ID || 'demo-user-123';
        
        // Upsert podcast record
        await supabase.from('podcasts').upsert({
          id: podcastId,
          title: `YouTube ${videoId}`,
          url: videoUrl,
          description: fastMode ? 'Transcript only' : (result.factCheck?.summary || 'Processed video'),
          user_id: demoUser
        }, { onConflict: 'id' });
        
        // Save transcription
        await supabase.from('transcriptions').upsert({
          podcast_id: podcastId,
          transcript: result.transcription.text
        }, { onConflict: 'podcast_id' });
        
        console.log(`💾 Saved to Supabase: ${podcastId}`);
      } catch (dbErr) {
        console.warn('⚠️ Supabase save failed:', dbErr?.message || dbErr);
      }
    }
    
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

// ============================================================
// Gemini 3 Flash - Video Analysis
// ============================================================

let geminiExtractor = null;
let hybridProcessor = null;

async function getGeminiExtractor() {
  if (!geminiExtractor) {
    const { GeminiExtractor } = await import('./services/claim-extraction/gemini-extractor.js');
    geminiExtractor = new GeminiExtractor();
  }
  return geminiExtractor;
}

async function getHybridProcessor() {
  if (!hybridProcessor) {
    const { HybridProcessor } = await import('./services/claim-extraction/hybrid-processor.js');
    hybridProcessor = new HybridProcessor({ supabase });
  }
  return hybridProcessor;
}

app.post('/api/analyze', async (req, res) => {
  try {
    const { youtube_url } = req.body;
    
    if (!youtube_url) {
      return res.status(400).json({
        success: false,
        message: 'Missing youtube_url parameter'
      });
    }
    
    // Validate YouTube URL
    const videoIdMatch = youtube_url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!videoIdMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid YouTube URL'
      });
    }
    
    const videoId = `yt-${videoIdMatch[1]}`;
    console.log(`\n🎬 Analyzing video: ${youtube_url}`);
    
    // Get Gemini extractor
    const extractor = await getGeminiExtractor();
    
    // Extract claims directly from YouTube URL
    const { videoTitle, claims, processingTime } = await extractor.extractFromYouTube(youtube_url);
    
    console.log(`✅ Extracted ${claims.length} claims in ${(processingTime / 1000).toFixed(1)}s`);
    
    // Save to database
    if (supabase) {
      try {
        // Save video entry first
        await supabase.from('videos').upsert({
          id: videoId,
          title: videoTitle,
          url: youtube_url,
          claims_count: claims.length,
          first_analyzed_at: new Date().toISOString()
        }, { onConflict: 'id' });
        
        // Save claims
        for (const claim of claims) {
          await supabase.from('claims').upsert({
            claim_id: claim.claim_id,
            video_id: claim.video_id,
            timestamp: claim.timestamp,
            segment_text: claim.segment?.full_text || '',
            author_mentioned: claim.extraction?.author_mentioned,
            author_normalized: claim.extraction?.author_normalized,
            institution_mentioned: claim.extraction?.institution_mentioned,
            finding_summary: claim.extraction?.finding_summary,
            confidence: claim.extraction?.confidence,
            primary_query: claim.search?.primary_query
          }, { onConflict: 'claim_id' });
        }
        
        console.log(`💾 Saved video + ${claims.length} claims to database`);
      } catch (dbError) {
        console.warn('⚠️ Failed to save to database:', dbError.message);
      }
    }
    
    res.json({
      success: true,
      data: {
        video_id: videoId,
        video_title: videoTitle,
        video_url: youtube_url,
        claims_count: claims.length,
        claims: claims.map(c => ({
          timestamp: c.timestamp,
          segment: c.segment.full_text,
          author: c.extraction.author_normalized || c.extraction.author_mentioned,
          institution: c.extraction.institution_mentioned,
          finding: c.extraction.finding_summary,
          confidence: c.extraction.confidence,
          search_queries: c.search
        })),
        processing_time_ms: processingTime
      }
    });
    
  } catch (error) {
    console.error('❌ Video analysis failed:', error);
    res.status(500).json({
      success: false,
      message: 'Video analysis failed',
      error: error.message
    });
  }
});

// ============================================================
// Hybrid Processing - Real-time alerts for long podcasts
// Fast track (first 10 min) + Background (full video)
// ============================================================

// Start hybrid processing (call when video starts playing)
app.post('/api/video/start', async (req, res) => {
  try {
    const { youtube_url, video_title } = req.body;
    
    if (!youtube_url) {
      return res.status(400).json({ success: false, message: 'Missing youtube_url' });
    }
    
    const processor = await getHybridProcessor();
    const videoId = await processor.startProcessing(youtube_url, video_title);
    
    res.json({
      success: true,
      data: {
        video_id: videoId,
        message: 'Processing started. Poll /api/video/claims for results.'
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to start video processing:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get processing status
app.get('/api/video/status/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const processor = await getHybridProcessor();
    const status = processor.getStatus(videoId);
    
    if (!status) {
      return res.status(404).json({ success: false, message: 'Video not found' });
    }
    
    res.json({
      success: true,
      data: {
        video_id: status.videoId,
        status: status.status,
        fast_track_complete: status.fastTrackCompletedAt !== null,
        full_processing_complete: status.fullProcessingCompletedAt !== null,
        fast_track_claims_count: status.fastTrackClaims.length,
        total_claims_count: status.allClaims.length,
        error: status.error
      }
    });
    
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get claims up to current playback position
app.get('/api/video/claims/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { timestamp } = req.query; // e.g., "05:30" or "1:23:45"
    
    const processor = await getHybridProcessor();
    const status = processor.getStatus(videoId);
    
    if (!status) {
      return res.status(404).json({ success: false, message: 'Video not found' });
    }
    
    // If timestamp provided, filter claims up to that point
    const claims = timestamp 
      ? processor.getClaimsUpTo(videoId, timestamp)
      : (status.allClaims.length > 0 ? status.allClaims : status.fastTrackClaims);
    
    res.json({
      success: true,
      data: {
        video_id: videoId,
        status: status.status,
        claims_count: claims.length,
        claims: claims.map(c => ({
          timestamp: c.timestamp,
          segment: c.segment.full_text,
          author: c.extraction.author_normalized || c.extraction.author_mentioned,
          finding: c.extraction.finding_summary,
          confidence: c.extraction.confidence,
          search_queries: c.search
        }))
      }
    });
    
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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


