/**
 * TypeScript types for AI services
 * Defines interfaces for Whisper and GPT-4 responses
 */

/**
 * Whisper API Response Types
 */
export interface WhisperSegment {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
}

export interface WhisperTranscription {
  text: string;
  segments: WhisperSegment[];
  language: string;
  duration: number;
}

export interface TranscriptionResult {
  text: string;
  segments: WhisperSegment[];
  language: string;
  duration: number;
  processingTime: number;
  cost: number;
}

/**
 * GPT-4 Fact-Checking Types
 */
export interface Claim {
  text: string;
  type: 'factual' | 'opinion' | 'speculation' | 'anecdotal';
  verifiability: 'verifiable' | 'partially_verifiable' | 'unverifiable';
  credibility: 'high' | 'medium' | 'low';
  analysis: string;
  sources: Source[];
  timestamp: string;
}

export interface FactCheckAnalysis {
  totalClaims: number;
  verifiableClaims: number;
  highCredibilityClaims: number;
  sources: Source[];
}

export interface FactCheckResult {
  videoId: string;
  overallCredibility: 'high' | 'medium' | 'low';
  confidence: number;
  claims: Claim[];
  summary: string;
  recommendations: string[];
  analysis: FactCheckAnalysis;
  cost: number;
  timestamp: string;
}

export interface Source {
  title: string;
  url: string;
  credibility: 'high' | 'medium' | 'low';
  type: 'academic' | 'news' | 'government' | 'expert' | 'other';
  authors?: string[];
  journal?: string;
  year?: number;
  abstract?: string;
  doi?: string;
  relevanceScore?: number;
}

/**
 * API Request/Response Types
 */
export interface AudioProcessingRequest {
  videoId: string;
  timestamp: number;
  audioBuffer: Buffer;
  filename: string;
}

export interface AudioProcessingResponse {
  success: boolean;
  transcript: string;
  segments: WhisperSegment[];
  language: string;
  duration: number;
  alerts: Claim[];
  overallConfidence: number;
  processingTime: number;
  cost: number;
  chunkMetadata: {
    timestamp: number;
    duration: number;
    processingTime: number;
    chunkIndex: number;
  };
  videoId: string;
}

/**
 * Error Types
 */
export type GPTErrorCode = 'GPT_ERROR' | 'RATE_LIMIT' | 'INVALID_REQUEST' | 'QUOTA_EXCEEDED' | 'SERVICE_UNAVAILABLE';

export interface AIError extends Error {
  code: string;
  service: 'whisper' | 'gpt' | 'general';
  retryable: boolean;
  cost?: number;
}

export class WhisperError extends Error implements AIError {
  code: string;
  service: 'whisper' = 'whisper';
  retryable: boolean;
  cost?: number;

  constructor(message: string, code: string, retryable: boolean = true, cost?: number) {
    super(message);
    this.name = 'WhisperError';
    this.code = code;
    this.retryable = retryable;
    if (cost !== undefined) {
      this.cost = cost;
    }
  }
}

export class GPTError extends Error implements AIError {
  code: string;
  service: 'gpt' = 'gpt';
  retryable: boolean;
  cost?: number;

  constructor(message: string, code: string, retryable: boolean = true, cost?: number) {
    super(message);
    this.name = 'GPTError';
    this.code = code;
    this.retryable = retryable;
    if (cost !== undefined) {
      this.cost = cost;
    }
  }
}

/**
 * Rate Limiting Types
 */
export interface RateLimitInfo {
  service: string;
  requests: number[];
  limit: number;
  windowMs: number;
  resetTime: number;
}

export interface CostTrackingInfo {
  service: string;
  dailyCost: number;
  monthlyCost: number;
  costLimit: number;
  lastReset: Date;
}

/**
 * Chunk Processing Log Types
 */
export interface ChunkProcessingLog {
  id: string;
  videoId: string;
  chunkTimestamp: number;
  chunkDuration: number;
  processingTimeMs: number;
  success: boolean;
  errorMessage?: string;
  whisperCost?: number;
  gptCost?: number;
  totalCost?: number;
  createdAt: Date;
}

/**
 * Configuration Types
 */
export interface AIServiceConfig {
  openai: {
    apiKey: string;
    organization?: string;
  };
  whisper: {
    model: string;
    maxDuration: number;
    maxFileSize: number;
  };
  gpt: {
    model: string;
    maxTokens: number;
    temperature: number;
  };
  limits: {
    rateLimit: number;
    costLimit: number;
  };
  environment: string;
}
