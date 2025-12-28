/**
 * Rolling Buffer for Live Mode
 * Maintains a sliding window of transcript chunks for claim extraction
 */

export class RollingBuffer {
  private chunks: string[] = [];
  private readonly BUFFER_SIZE = 3;          // 3 chunks
  private readonly CHUNK_DURATION_SEC = 10;  // 10 seconds each = 30s window
  
  /**
   * Add a new chunk and return the combined transcript
   */
  addChunk(chunk: string): string {
    this.chunks.push(chunk);
    if (this.chunks.length > this.BUFFER_SIZE) {
      this.chunks.shift();
    }
    return this.chunks.join(' ');
  }
  
  /**
   * Get current buffer contents without adding
   */
  getTranscript(): string {
    return this.chunks.join(' ');
  }
  
  /**
   * Clear the buffer (e.g., on new session)
   */
  clear(): void {
    this.chunks = [];
  }
  
  /**
   * Get approximate timestamps for current window
   */
  getTimestamps(windowId: number): { start: string; end: string } {
    const endSec = windowId * this.CHUNK_DURATION_SEC;
    const startSec = Math.max(0, endSec - (this.BUFFER_SIZE * this.CHUNK_DURATION_SEC));
    return {
      start: this.formatTime(startSec),
      end: this.formatTime(endSec)
    };
  }
  
  /**
   * Get buffer size info
   */
  getInfo(): { chunks: number; maxChunks: number; chunkDuration: number } {
    return {
      chunks: this.chunks.length,
      maxChunks: this.BUFFER_SIZE,
      chunkDuration: this.CHUNK_DURATION_SEC
    };
  }
  
  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}

