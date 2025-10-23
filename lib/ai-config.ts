import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * AI Services Configuration
 * Centralized configuration for OpenAI services and limits
 */
export const AI_CONFIG = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    organization: process.env.OPENAI_ORGANIZATION || undefined,
  },
  whisper: {
    model: process.env.WHISPER_MODEL || 'whisper-1',
    maxDuration: parseInt(process.env.MAX_AUDIO_DURATION || '300'), // 5 minutes
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '25000000'), // 25MB
  },
  gpt: {
    model: process.env.GPT_MODEL || 'gpt-4-turbo-preview',
    maxTokens: 2000,
    temperature: 0.3,
  },
  claims: {
    contextWindowChunks: parseInt(process.env.CLAIMS_CONTEXT_WINDOW_CHUNKS || '5'),
  },
  limits: {
    rateLimit: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '50'),
    costLimit: parseFloat(process.env.COST_LIMIT_PER_DAY || '10.00'),
  },
  environment: process.env.NODE_ENV || 'development',
};

/**
 * Validate AI configuration
 * Throws error if required configuration is missing
 */
export function validateAIConfig(): void {
  if (!AI_CONFIG.openai.apiKey) {
    throw new Error('OPENAI_API_KEY is required but not set');
  }

  if (AI_CONFIG.whisper.maxDuration > 300) {
    throw new Error('MAX_AUDIO_DURATION cannot exceed 300 seconds (5 minutes)');
  }

  if (AI_CONFIG.whisper.maxFileSize > 25000000) {
    throw new Error('MAX_FILE_SIZE cannot exceed 25MB (OpenAI limit)');
  }

  if (AI_CONFIG.limits.rateLimit <= 0) {
    throw new Error('RATE_LIMIT_PER_MINUTE must be greater than 0');
  }

  if (AI_CONFIG.limits.costLimit <= 0) {
    throw new Error('COST_LIMIT_PER_DAY must be greater than 0');
  }

  if (AI_CONFIG.claims.contextWindowChunks <= 0) {
    throw new Error('CLAIMS_CONTEXT_WINDOW_CHUNKS must be greater than 0');
  }
}

/**
 * Get cost estimates for API calls
 */
export const COST_ESTIMATES = {
  whisper: {
    costPerMinute: 0.006, // $0.006 per minute
    costPerChunk: (durationSeconds: number) => (durationSeconds / 60) * 0.006,
  },
  gpt: {
    inputCostPer1K: 0.01, // $0.01 per 1K input tokens
    outputCostPer1K: 0.03, // $0.03 per 1K output tokens
    estimateCost: (inputTokens: number, outputTokens: number) => {
      const inputCost = (inputTokens / 1000) * 0.01;
      const outputCost = (outputTokens / 1000) * 0.03;
      return inputCost + outputCost;
    },
  },
};

/**
 * Development vs Production configuration
 */
export function isDevelopment(): boolean {
  return AI_CONFIG.environment === 'development';
}

export function isProduction(): boolean {
  return AI_CONFIG.environment === 'production';
}

/**
 * Get appropriate rate limits based on environment
 */
export function getRateLimit(): number {
  return isDevelopment() 
    ? Math.min(AI_CONFIG.limits.rateLimit, 10) // Lower limit for dev
    : AI_CONFIG.limits.rateLimit;
}

/**
 * Get appropriate cost limits based on environment
 */
export function getCostLimit(): number {
  return isDevelopment()
    ? Math.min(AI_CONFIG.limits.costLimit, 5.00) // Lower limit for dev
    : AI_CONFIG.limits.costLimit;
}
