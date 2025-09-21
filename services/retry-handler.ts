import type { AIError } from '../lib/ai-types.js';

/**
 * Retry Handler Service
 * Implements exponential backoff with jitter for AI service calls
 */
export class RetryHandler {
  private static readonly DEFAULT_MAX_RETRIES = 3;
  private static readonly DEFAULT_BASE_DELAY = 1000; // 1 second
  private static readonly DEFAULT_MAX_DELAY = 30000; // 30 seconds
  private static readonly JITTER_FACTOR = 0.1; // 10% jitter

  /**
   * Execute operation with retry logic
   */
  static async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = RetryHandler.DEFAULT_MAX_RETRIES,
    baseDelay: number = RetryHandler.DEFAULT_BASE_DELAY
  ): Promise<T> {
    let lastError: AIError | Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Attempt ${attempt}/${maxRetries}`);
        return await operation();
      } catch (error) {
        lastError = error as AIError | Error;
        
        // Don't retry if it's the last attempt
        if (attempt === maxRetries) {
          console.error(`❌ All ${maxRetries} attempts failed`);
          throw lastError;
        }

        // Don't retry if error is not retryable
        if (this.isAIError(error) && !error.retryable) {
          console.error(`❌ Non-retryable error: ${error.message}`);
          throw error;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt, baseDelay);
        console.log(`⏳ Retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
        
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Execute operation with circuit breaker pattern
   */
  static async withCircuitBreaker<T>(
    operation: () => Promise<T>,
    circuitBreaker: CircuitBreaker
  ): Promise<T> {
    return circuitBreaker.execute(operation);
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private static calculateDelay(attempt: number, baseDelay: number): number {
    // Exponential backoff: delay = baseDelay * 2^(attempt-1)
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    
    // Cap at maximum delay
    const cappedDelay = Math.min(exponentialDelay, RetryHandler.DEFAULT_MAX_DELAY);
    
    // Add jitter: ±10% random variation
    const jitter = cappedDelay * RetryHandler.JITTER_FACTOR;
    const jitterAmount = (Math.random() - 0.5) * 2 * jitter;
    
    return Math.max(0, cappedDelay + jitterAmount);
  }

  /**
   * Sleep for specified milliseconds
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if error is an AIError
   */
  private static isAIError(error: any): error is AIError {
    return error && typeof error.retryable === 'boolean' && error.service;
  }
}

/**
 * Circuit Breaker Implementation
 * Prevents cascading failures by opening circuit when failure threshold is reached
 */
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private failureThreshold: number = 5,
    private timeout: number = 60000, // 1 minute
    private successThreshold: number = 3 // Number of successes needed to close circuit
  ) {}

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        console.log('🔄 Circuit breaker transitioning to HALF_OPEN');
        this.state = 'HALF_OPEN';
        this.failureCount = 0;
      } else {
        throw new Error('Circuit breaker is OPEN - service unavailable');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.failureCount++;
      if (this.failureCount >= this.successThreshold) {
        console.log('✅ Circuit breaker transitioning to CLOSED');
        this.state = 'CLOSED';
        this.failureCount = 0;
      }
    } else {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      console.log(`🚨 Circuit breaker transitioning to OPEN (${this.failureCount} failures)`);
      this.state = 'OPEN';
    }
  }

  /**
   * Get current circuit breaker state
   */
  getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.state;
  }

  /**
   * Get failure count
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Reset circuit breaker (for testing)
   */
  reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.state = 'CLOSED';
  }
}
