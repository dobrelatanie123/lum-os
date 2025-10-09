// Content script for YouTube pages
class LumosYouTubeMonitor {
  constructor() {
    this.isRecording = false;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.currentVideoId = null;
    this.apiUrl = 'http://localhost:3001'; // API server
    this.chunkDuration = 10000; // 10 seconds chunks
    this.recordingTimer = null;
    this.groupedTopics = [];
    this.firedTopicKeys = new Set();
    this.topicSchedulerId = null;
    
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

    // Listen for background updates to grouped topics and refresh scheduler
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'GROUPED_TOPICS_UPDATED' && message.videoId === this.currentVideoId) {
        this.fetchGroupedTopics().then(() => this.startTopicScheduler());
      }
    });

    // Prepare toast host early for stricter CSP pages
    try { this.ensureToastHost(); } catch {}
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
    // Stop previous polling
    if (this.currentVideoId) {
      chrome.runtime.sendMessage({ type: 'STOP_POLL', videoId: this.currentVideoId });
    }
    // Reset grouped state
    this.groupedTopics = [];
    this.firedTopicKeys.clear();
    if (this.topicSchedulerId) { clearInterval(this.topicSchedulerId); this.topicSchedulerId = null; }
    
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
        // Start grouped alerts polling regardless of recording
        chrome.runtime.sendMessage({ type: 'START_POLL', videoId: this.currentVideoId });
        // Initial fetch of grouped topics, then start scheduler
        this.fetchGroupedTopics().then(() => this.startTopicScheduler());
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
    const video = document.querySelector('video');
    chrome.runtime.sendMessage({
      type: 'ALERTS_DETECTED',
      alerts,
      transcript,
      videoId: this.currentVideoId,
      timestamp: Date.now(),
      video_time_sec: video ? Math.floor(video.currentTime || 0) : undefined
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

  async fetchGroupedTopics() {
    if (!this.currentVideoId) return;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_GROUPED_ALERTS', videoId: this.currentVideoId });
      const topics = Array.isArray(resp?.topics) ? resp.topics : [];
      this.groupedTopics = topics;
      console.log('📚 Loaded grouped topics:', topics.length);
    } catch (e) { console.warn('Failed to fetch grouped topics', e); }
  }

  startTopicScheduler() {
    if (this.topicSchedulerId) clearInterval(this.topicSchedulerId);
    const video = document.querySelector('video');
    if (!video) return;
    const toSeconds = (t) => {
      if (typeof t === 'number') return t > 1e10 ? Math.floor(t / 1000) : Math.floor(t);
      if (typeof t === 'string') { const n = Date.parse(t); if (!isNaN(n)) return Math.floor(n / 1000); }
      return NaN;
    };
    // Build list of (key, timeSec)
    const schedule = this.groupedTopics.map((t) => {
      const d = t?.details || {};
      const vt = Number(d.video_time_sec);
      const ts = Number.isFinite(vt) && vt >= 0 ? Math.floor(vt) : toSeconds(d.timestamp);
      return { key: String(t?.topic_id || t?.id || Math.random()), t, timeSec: ts };
    }).filter(x => Number.isFinite(x.timeSec));
    // If nothing to schedule, bail early
    if (!schedule.length) return;
    // Sort ascending by time
    schedule.sort((a, b) => a.timeSec - b.timeSec);
    this.topicSchedulerId = setInterval(() => {
      const cur = Math.floor(video.currentTime || 0);
      for (const item of schedule) {
        if (this.firedTopicKeys.has(item.key)) continue;
        if (cur >= item.timeSec) {
          this.firedTopicKeys.add(item.key);
          // Request auto-open popup first (guaranteed supported path)
          try { chrome.runtime.sendMessage({ type: 'OPEN_POPUP', videoId: this.currentVideoId }); } catch {}
          // Fire notification path as well
          chrome.runtime.sendMessage({ type: 'SHOW_GROUPED_TOPIC', topic: item.t, videoId: this.currentVideoId });
          this.showTopicToast(item.t);
        }
      }
      // Refresh topics occasionally
      if (Math.random() < 0.05) this.fetchGroupedTopics();
    }, 1000);
  }

  showTopicToast(topic) {
    try {
      const claim = (topic?.details?.canonical_claim || topic?.details?.claim || 'Fact-check topic').toString();
      const urls = (() => { try { return JSON.parse(topic?.urls || '[]'); } catch { return []; } })();
      const primary = (Array.isArray(urls) && urls[0]) ? urls[0] : `http://localhost:4321/alerts?video_id=${encodeURIComponent(this.currentVideoId || '')}`;

      const host = this.ensureToastHost();

      const card = document.createElement('div');
      card.style.background = '#ffffff';
      card.style.border = '1px solid rgba(0,0,0,0.1)';
      card.style.boxShadow = '0 10px 24px rgba(0,0,0,0.14)';
      card.style.borderRadius = '12px';
      card.style.padding = '12px 14px';
      card.style.marginTop = '12px';
      card.style.color = '#111827';
      card.style.lineHeight = '1.35';
      card.style.cursor = 'pointer';
      card.style.pointerEvents = 'auto';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.gap = '8px';
      header.style.marginBottom = '6px';
      const dot = document.createElement('span');
      dot.style.display = 'inline-block';
      dot.style.width = '8px';
      dot.style.height = '8px';
      dot.style.borderRadius = '999px';
      dot.style.background = '#f59e0b';
      const title = document.createElement('strong');
      title.style.fontSize = '13px';
      title.style.letterSpacing = '0.2px';
      title.style.color = '#374151';
      title.textContent = 'Lumos topic alert';
      header.appendChild(dot);
      header.appendChild(title);

      const claimEl = document.createElement('div');
      claimEl.style.fontSize = '14px';
      claimEl.style.marginBottom = '8px';
      claimEl.textContent = claim.length > 180 ? (claim.slice(0,180) + '…') : claim;

      const linkEl = document.createElement('div');
      linkEl.style.fontSize = '12px';
      linkEl.style.color = '#2563eb';
      linkEl.textContent = 'Open details ↗';

      card.appendChild(header);
      card.appendChild(claimEl);
      card.appendChild(linkEl);

      const open = () => {
        try { window.open(primary, '_blank', 'noopener'); } catch {}
        try { host.removeChild(card); } catch {}
      };
      card.addEventListener('click', open);
      host.appendChild(card);

      // If the card is not visible (e.g., hidden by stacking context), re-attach to body as fixed overlay
      try {
        const rect = card.getBoundingClientRect();
        if ((rect.width === 0 && rect.height === 0) || !document.elementFromPoint(Math.max(0, rect.right-1), Math.max(0, rect.bottom-1))) {
          const bodyHost = document.createElement('div');
          bodyHost.style.position = 'fixed';
          bodyHost.style.right = '16px';
          bodyHost.style.bottom = '24px';
          bodyHost.style.zIndex = '2147483647';
          document.body.appendChild(bodyHost);
          bodyHost.appendChild(card);
          console.log('Lumos: toast fallback to body overlay');
        }
      } catch {}

      setTimeout(() => { try { host.removeChild(card); } catch {} }, 9000);
    } catch {}
  }

  ensureToastHost() {
    let host = document.getElementById('lumos-toast');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'lumos-toast';
    host.style.maxWidth = '380px';
    host.style.fontFamily = 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
    host.style.pointerEvents = 'none';
    // Always attach at top document element to bypass player/body restrictions
    host.style.position = 'fixed';
    host.style.right = '16px';
    host.style.bottom = '24px';
    host.style.zIndex = '2147483647';
    try { document.documentElement.appendChild(host); console.log('Lumos: toast host attached to <html>'); } catch {}
    // Re-attach if removed
    try {
      const obs = new MutationObserver(() => {
        if (!document.getElementById('lumos-toast')) {
          try { document.documentElement.appendChild(host); } catch {}
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch {}
    return host;
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
