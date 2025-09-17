// Content script for YouTube pages
class LumosYouTubeMonitor {
  constructor() {
    this.isRecording = false;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.currentVideoId = null;
    this.apiUrl = 'http://localhost:3001'; // Standalone API server
    this.chunkDuration = 10000; // 10 seconds chunks
    this.recordingTimer = null;
    
    this.init();
  }

  init() {
    console.log('🔍 Lumos YouTube Monitor initialized');
    
    // Monitor for video changes
    this.observeVideoChanges();
    
    // Check current video
    this.checkCurrentVideo();
    
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sendResponse);
      return true; // Keep response channel open
    });
  }

  observeVideoChanges() {
    // YouTube is SPA, so we need to monitor URL changes
    let currentUrl = location.href;
    
    const observer = new MutationObserver(() => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        this.onVideoChange();
      }
    });
    
    observer.observe(document, { childList: true, subtree: true });
    
    // Also listen to popstate (back/forward navigation)
    window.addEventListener('popstate', () => this.onVideoChange());
  }

  onVideoChange() {
    console.log('📺 Video changed:', location.href);
    this.stopRecording();
    
    setTimeout(() => {
      this.checkCurrentVideo();
    }, 1000); // Wait for YouTube to load new video
  }

  checkCurrentVideo() {
    const videoId = this.extractVideoId();
    if (videoId && videoId !== this.currentVideoId) {
      this.currentVideoId = videoId;
      console.log('🎬 New video detected:', videoId);
      
      // Check user preferences and auto-start if enabled
      chrome.storage.sync.get(['autoRecord'], (result) => {
        if (result.autoRecord) {
          this.startRecording();
        }
      });
    }
  }

  extractVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
  }

  async startRecording() {
    if (this.isRecording) {
      console.log('⚠️ Already recording');
      return;
    }

    try {
      console.log('🎤 Starting audio recording...');
      
      // Try to capture from YouTube video element directly first
      const videoElement = document.querySelector('video');
      if (videoElement && videoElement.captureStream) {
        console.log('📺 Using video element captureStream...');
        const videoStream = videoElement.captureStream();
        const audioTrack = videoStream.getAudioTracks()[0];
        if (audioTrack) {
          const audioStream = new MediaStream([audioTrack]);
          this.setupRecorder(audioStream);
          return;
        }
      }

      // Fallback to getUserMedia for microphone
      console.log('🎤 Fallback to getUserMedia...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000, // Whisper prefers 16kHz
          sampleSize: 16,
          echoCancellation: false,
          noiseSuppression: false
        }
      });

      this.setupRecorder(stream);
      
    } catch (error) {
      console.error('❌ Failed to start recording:', error);
      this.showNotification('Failed to start recording', 'Please grant microphone permission');
    }
  }

  setupRecorder(stream) {
    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    this.audioChunks = [];

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      this.processAudioChunk();
    };

    // Start recording and set up chunking
    this.mediaRecorder.start();
    this.isRecording = true;
    
    // Process chunks every N seconds
    this.recordingTimer = setInterval(() => {
      if (this.isRecording && this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        console.log('📦 Processing chunk...');
        this.mediaRecorder.stop();
        
        // Restart recording for next chunk
        setTimeout(() => {
          if (this.isRecording && this.mediaRecorder) {
            this.mediaRecorder.start();
            this.audioChunks = [];
          }
        }, 100);
      }
    }, this.chunkDuration);

    console.log('✅ Recording started');
    this.updateBadge('REC');
  }

  async processAudioChunk() {
    if (this.audioChunks.length === 0) return;

    try {
      // Convert chunks to blob
      const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
      
      if (audioBlob.size < 1000) { // Skip very small chunks
        return;
      }

      console.log(`📤 Sending audio chunk (${audioBlob.size} bytes) to API...`);

      // Send to our API
      const formData = new FormData();
      formData.append('audio', audioBlob, 'chunk.webm');
      formData.append('videoId', this.currentVideoId);
      formData.append('timestamp', Date.now().toString());

      const response = await fetch(`${this.apiUrl}/api/transcribe/audio`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success && result.alerts && result.alerts.length > 0) {
        console.log('🚨 Alerts detected:', result.alerts);
        this.handleAlerts(result.alerts, result.transcript);
      }

    } catch (error) {
      console.error('❌ Failed to process audio chunk:', error);
      
      // Check if it's ad blocker related
      if (error.message.includes('ERR_BLOCKED_BY_CLIENT') || 
          error.message.includes('NetworkError') ||
          error.message.includes('Failed to fetch')) {
        
        this.handleAdBlockerDetection();
      }
    }
  }

  handleAdBlockerDetection() {
    console.warn('🛡️ Ad blocker detected! Showing instructions...');
    
    // Stop recording to prevent spam
    this.stopRecording();
    
    // Show notification with instructions
    this.showNotification(
      '🛡️ Ad Blocker Detected',
      'Lumos is being blocked. Click for setup instructions.'
    );
    
    // Send message to popup to show ad blocker instructions
    chrome.runtime.sendMessage({
      type: 'AD_BLOCKER_DETECTED',
      userAgent: navigator.userAgent,
      url: window.location.href
    });
  }

  handleAlerts(alerts, transcript) {
    // Show notifications for high-priority alerts
    alerts.forEach(alert => {
      this.showNotification(
        `⚠️ Potential ${alert.verdict}: ${alert.claim}`,
        alert.reasoning.substring(0, 100) + '...'
      );
    });

    // Update badge with alert count
    this.updateBadge(alerts.length.toString());

    // Send to popup/background for storage
    chrome.runtime.sendMessage({
      type: 'ALERTS_DETECTED',
      alerts,
      transcript,
      videoId: this.currentVideoId,
      timestamp: Date.now()
    });
  }

  stopRecording() {
    if (!this.isRecording) return;

    console.log('⏹️ Stopping recording...');
    
    this.isRecording = false;
    
    // Clear timer first
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }

    // Stop media recorder
    if (this.mediaRecorder) {
      if (this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
      
      // Stop all tracks
      if (this.mediaRecorder.stream) {
        this.mediaRecorder.stream.getTracks().forEach(track => {
          track.stop();
          console.log('🔇 Stopped track:', track.kind);
        });
      }
      
      this.mediaRecorder = null;
    }

    this.updateBadge('');
    console.log('✅ Recording fully stopped');
  }

  handleMessage(message, sendResponse) {
    console.log('📩 Received message:', message);
    
    switch (message.type) {
      case 'START_RECORDING':
        this.startRecording();
        sendResponse({ success: true });
        break;
        
      case 'STOP_RECORDING':
        this.stopRecording();
        sendResponse({ success: true });
        break;
        
      case 'GET_STATUS':
        sendResponse({
          isRecording: this.isRecording,
          videoId: this.currentVideoId,
          url: location.href
        });
        break;
        
      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }

  showNotification(title, message) {
    // Request notification permission if needed
    if (Notification.permission === 'granted') {
      new Notification(title, {
        body: message,
        icon: chrome.runtime.getURL('icons/icon48.png')
      });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification(title, { body: message });
        }
      });
    }
  }

  updateBadge(text) {
    chrome.runtime.sendMessage({
      type: 'UPDATE_BADGE',
      text
    });
  }
}

// Initialize when DOM is ready
console.log('🔧 Lumos content script loaded!', window.location.href);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('🔧 DOM ready, initializing...');
    window.LumosYouTubeMonitor = new LumosYouTubeMonitor();
  });
} else {
  console.log('🔧 DOM already ready, initializing...');
  window.LumosYouTubeMonitor = new LumosYouTubeMonitor();
}
