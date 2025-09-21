import OpenAI from 'openai';
import { AI_CONFIG, validateAIConfig, COST_ESTIMATES } from '../lib/ai-config.js';
import type { 
  TranscriptionResult, 
  WhisperTranscription, 
  RateLimitInfo 
} from '../lib/ai-types.js';
import { WhisperError } from '../lib/ai-types.js';

/**
 * Audio Processing Service
 * Handles OpenAI Whisper API integration for audio transcription
 */
export class AudioProcessor {
  private openai: OpenAI;
  private rateLimiter: Map<string, number[]> = new Map();
  private costTracker: Map<string, number> = new Map();

  constructor() {
    // Validate configuration before initializing
    validateAIConfig();
    
    const openaiConfig: any = {
      apiKey: AI_CONFIG.openai.apiKey,
    };
    
    if (AI_CONFIG.openai.organization) {
      openaiConfig.organization = AI_CONFIG.openai.organization;
    }
    
    this.openai = new OpenAI(openaiConfig);
  }

  /**
   * Transcribe audio using OpenAI Whisper API
   */
  async transcribeAudio(audioBuffer: Buffer, filename: string): Promise<TranscriptionResult> {
    const startTime = Date.now();
    
    try {
      // Rate limiting check
      if (!this.checkRateLimit('whisper')) {
        throw new WhisperError(
          'Rate limit exceeded for Whisper API',
          'RATE_LIMIT_EXCEEDED',
          true
        );
      }

      // Validate audio file
      this.validateAudioFile(audioBuffer, filename);

      console.log(`🎤 Transcribing audio: ${filename} (${audioBuffer.length} bytes)`);

      // Call OpenAI Whisper API
      const transcription = await this.openai.audio.transcriptions.create({
        file: new File([new Uint8Array(audioBuffer)], filename, { type: 'audio/webm' }),
        model: AI_CONFIG.whisper.model,
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      });

      const processingTime = Date.now() - startTime;
      const cost = this.calculateCost(transcription.duration || 0);

      // Track cost
      this.trackCost('whisper', cost);

      console.log(`✅ Transcription completed in ${processingTime}ms (cost: $${cost.toFixed(4)})`);

      return {
        text: transcription.text,
        segments: transcription.segments || [],
        language: transcription.language || 'unknown',
        duration: transcription.duration || 0,
        processingTime,
        cost
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      console.error('❌ Whisper transcription failed:', error);
      
      // Handle different types of errors
      if (error instanceof Error) {
        if (error.message.includes('rate_limit_exceeded')) {
          throw new WhisperError(
            'OpenAI rate limit exceeded',
            'OPENAI_RATE_LIMIT',
            true,
            this.calculateCost(0)
          );
        }
        
        if (error.message.includes('invalid_file_format')) {
          throw new WhisperError(
            'Invalid audio file format',
            'INVALID_FORMAT',
            false
          );
        }
        
        if (error.message.includes('file_too_large')) {
          throw new WhisperError(
            'Audio file too large',
            'FILE_TOO_LARGE',
            false
          );
        }
      }

      throw new WhisperError(
        `Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'TRANSCRIPTION_FAILED',
        true,
        this.calculateCost(0)
      );
    }
  }

  /**
   * Validate audio file before processing
   */
  private validateAudioFile(buffer: Buffer, filename: string): void {
    // Check file size (25MB limit)
    if (buffer.length > AI_CONFIG.whisper.maxFileSize) {
      throw new WhisperError(
        `Audio file too large: ${buffer.length} bytes (max: ${AI_CONFIG.whisper.maxFileSize})`,
        'FILE_TOO_LARGE',
        false
      );
    }

    // Check minimum file size (skip very small chunks)
    if (buffer.length < 1000) {
      throw new WhisperError(
        'Audio file too small to process',
        'FILE_TOO_SMALL',
        false
      );
    }

    // Validate file extension
    const validExtensions = ['.webm', '.mp3', '.mp4', '.m4a', '.wav', '.ogg'];
    const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    
    if (!validExtensions.includes(extension)) {
      throw new WhisperError(
        `Unsupported file format: ${extension}`,
        'UNSUPPORTED_FORMAT',
        false
      );
    }
  }

  /**
   * Check rate limiting for service
   */
  private checkRateLimit(service: string): boolean {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window
    const limit = AI_CONFIG.limits.rateLimit;

    if (!this.rateLimiter.has(service)) {
      this.rateLimiter.set(service, []);
    }

    const requests = this.rateLimiter.get(service)!;
    const recentRequests = requests.filter(time => now - time < windowMs);
    
    if (recentRequests.length >= limit) {
      console.warn(`⚠️ Rate limit exceeded for ${service}: ${recentRequests.length}/${limit} requests`);
      return false;
    }

    recentRequests.push(now);
    this.rateLimiter.set(service, recentRequests);
    return true;
  }

  /**
   * Calculate cost for transcription
   */
  private calculateCost(durationSeconds: number): number {
    return COST_ESTIMATES.whisper.costPerChunk(durationSeconds);
  }

  /**
   * Track daily costs
   */
  private trackCost(service: string, cost: number): void {
    const today = new Date().toISOString().split('T')[0];
    const key = `${service}_${today}`;
    const currentCost = this.costTracker.get(key) || 0;
    const newCost = currentCost + cost;

    // Check daily cost limit
    if (newCost > AI_CONFIG.limits.costLimit) {
      throw new WhisperError(
        `Daily cost limit exceeded for ${service}: $${newCost.toFixed(2)} (limit: $${AI_CONFIG.limits.costLimit})`,
        'COST_LIMIT_EXCEEDED',
        false,
        cost
      );
    }

    this.costTracker.set(key, newCost);
    console.log(`💰 ${service} cost: $${cost.toFixed(4)} (daily total: $${newCost.toFixed(2)})`);
  }

  /**
   * Get rate limit information
   */
  getRateLimitInfo(service: string): RateLimitInfo {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const requests = this.rateLimiter.get(service) || [];
    const recentRequests = requests.filter(time => now - time < windowMs);
    
    return {
      service,
      requests: recentRequests,
      limit: AI_CONFIG.limits.rateLimit,
      windowMs,
      resetTime: now + windowMs
    };
  }

  /**
   * Get daily cost for service
   */
  getDailyCost(service: string): number {
    const today = new Date().toISOString().split('T')[0];
    const key = `${service}_${today}`;
    return this.costTracker.get(key) || 0;
  }

  /**
   * Reset rate limiter (for testing)
   */
  resetRateLimiter(): void {
    this.rateLimiter.clear();
  }

  /**
   * Reset cost tracker (for testing)
   */
  resetCostTracker(): void {
    this.costTracker.clear();
  }
}
