import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AudioProcessor } from './audio-processor.js';
import { FactChecker } from './fact-checker.js';
import { CostTracker } from './cost-tracker.js';
import { TranscriptionResult, FactCheckResult } from '../lib/ai-types.js';

/**
 * YouTube Video Processing Service
 * Extracts audio from YouTube videos and processes them through the AI pipeline
 */
export class YouTubeProcessor {
  private audioProcessor: AudioProcessor;
  private factChecker: FactChecker;
  private costTracker: CostTracker;
  private tempDir: string;

  constructor(audioProcessor: AudioProcessor, factChecker: FactChecker, costTracker: CostTracker) {
    this.audioProcessor = audioProcessor;
    this.factChecker = factChecker;
    this.costTracker = costTracker;
    this.tempDir = path.join(process.cwd(), 'temp');
    
    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Process a YouTube video through the complete AI pipeline
   */
  async processVideo(videoUrl: string, videoId: string): Promise<{
    transcription: TranscriptionResult;
    factCheck: FactCheckResult;
    totalCost: number;
    processingTime: number;
  }> {
    const startTime = Date.now();
    let audioPath: string | null = null;

    try {
      console.log(`🎥 Processing YouTube video: ${videoId}`);
      console.log(`🔗 URL: ${videoUrl}`);

      // Step 1: Extract audio from YouTube video
      console.log('📥 Extracting audio from YouTube video...');
      audioPath = await this.extractAudio(videoUrl, videoId);
      
      // Step 2: Transcribe audio using Whisper
      console.log('🎤 Transcribing audio with Whisper...');
      const transcription = await this.audioProcessor.transcribeAudio(
        fs.readFileSync(audioPath),
        `${videoId}.webm`
      );

      // Step 3: Fact-check the transcription using GPT-4
      console.log('🔍 Analyzing transcription for fact-checking...');
      const factCheck = await this.factChecker.analyzeTranscription(
        transcription.text,
        videoId
      );

      const processingTime = Date.now() - startTime;
      const totalCost = transcription.cost + factCheck.cost;

      console.log(`✅ Video processing completed in ${processingTime}ms`);
      console.log(`💰 Total cost: $${totalCost.toFixed(4)}`);

      return {
        transcription,
        factCheck,
        totalCost,
        processingTime
      };

    } catch (error) {
      console.error('❌ Video processing failed:', error);
      throw error;
    } finally {
      // Clean up temporary audio file
      if (audioPath && fs.existsSync(audioPath)) {
        try {
          fs.unlinkSync(audioPath);
          console.log('🧹 Cleaned up temporary audio file');
        } catch (cleanupError) {
          console.warn('⚠️ Failed to clean up temporary file:', cleanupError);
        }
      }
    }
  }

  /**
   * Extract audio from YouTube video using yt-dlp
   */
  private async extractAudio(videoUrl: string, videoId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const audioPath = path.join(this.tempDir, `${videoId}.mp3`);
      
      // Check if yt-dlp is available
      const ytdlp = spawn('yt-dlp', [
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0', // Best quality
        '--output', audioPath,
        videoUrl
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      ytdlp.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ytdlp.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ytdlp.on('close', (code) => {
        if (code === 0) {
          if (fs.existsSync(audioPath)) {
            console.log(`✅ Audio extracted successfully: ${audioPath}`);
            resolve(audioPath);
          } else {
            reject(new Error('Audio file was not created'));
          }
        } else {
          reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
        }
      });

      ytdlp.on('error', (error) => {
        if (error.message.includes('ENOENT')) {
          reject(new Error('yt-dlp is not installed. Please install it first: brew install yt-dlp'));
        } else {
          reject(error);
        }
      });
    });
  }

  /**
   * Get video information without downloading
   */
  async getVideoInfo(videoUrl: string): Promise<{
    title: string;
    duration: number;
    uploader: string;
    viewCount: number;
    description: string;
  }> {
    return new Promise((resolve, reject) => {
      const ytdlp = spawn('yt-dlp', [
        '--dump-json',
        '--no-download',
        videoUrl
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      ytdlp.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ytdlp.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ytdlp.on('close', (code) => {
        if (code === 0) {
          try {
            const info = JSON.parse(stdout);
            resolve({
              title: info.title || 'Unknown Title',
              duration: info.duration || 0,
              uploader: info.uploader || 'Unknown Uploader',
              viewCount: info.view_count || 0,
              description: info.description || ''
            });
          } catch (parseError) {
            reject(new Error('Failed to parse video information'));
          }
        } else {
          reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
        }
      });

      ytdlp.on('error', (error) => {
        if (error.message.includes('ENOENT')) {
          reject(new Error('yt-dlp is not installed. Please install it first: brew install yt-dlp'));
        } else {
          reject(error);
        }
      });
    });
  }

  /**
   * Check if yt-dlp is available
   */
  async checkDependencies(): Promise<boolean> {
    return new Promise((resolve) => {
      const ytdlp = spawn('yt-dlp', ['--version'], { stdio: 'pipe' });
      
      ytdlp.on('close', (code) => {
        resolve(code === 0);
      });

      ytdlp.on('error', () => {
        resolve(false);
      });
    });
  }
}
