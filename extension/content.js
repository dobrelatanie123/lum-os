// Content script for YouTube pages - Hybrid Mode (Gemini 3 Flash)
class LumosYouTubeMonitor {
  constructor() {
    this.currentVideoId = null;
    this.apiUrl = 'http://localhost:3001';
    this.pollInterval = null;
    this.shownClaimIds = new Set();
    this.isProcessing = false;
    this.allClaims = []; // Store all claims from API
    this.lastCheckTime = -1; // Track video time for triggering alerts
    
    this.init();
  }

  init() {
    console.log('🔍 Lumos YouTube Monitor initialized (Hybrid Mode)');
    
    this.observeVideoChanges();
    this.checkCurrentVideo();
    
    // Also watch for video play event to trigger analysis
    this.watchVideoPlay();
    
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sendResponse);
      return true;
    });

    try { this.ensureToastHost(); } catch {}
  }

  watchVideoPlay() {
    // YouTube loads video element dynamically, so we need to watch for it
    const setupPlayListener = () => {
      const video = document.querySelector('video');
      if (video && !video._lumosWatching) {
        video._lumosWatching = true;
        
        video.addEventListener('play', () => {
          console.log('▶️ Video play detected');
          if (!this.isProcessing && this.currentVideoId) {
            chrome.storage.sync.get(['autoAnalyze'], (result) => {
              if (result.autoAnalyze !== false) {
                console.log('🚀 Auto-starting analysis on play...');
                this.startHybridProcessing();
              }
            });
          }
        });
        
        console.log('👀 Video play listener attached');
      }
    };

    // Try immediately and also observe for video element
    setupPlayListener();
    
    const observer = new MutationObserver(() => {
      setupPlayListener();
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
  }

  observeVideoChanges() {
    let currentUrl = location.href;
    
    const observer = new MutationObserver(() => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        this.onVideoChange();
      }
    });
    
    observer.observe(document, { childList: true, subtree: true });
    window.addEventListener('popstate', () => this.onVideoChange());
  }

  onVideoChange() {
    console.log('📺 Video changed:', location.href);
    this.stopPolling();
    this.shownClaimIds.clear();
    this.allClaims = [];
    this.lastCheckTime = -1;
    this.isProcessing = false;
    
    setTimeout(() => {
      this.checkCurrentVideo();
    }, 1000);
  }

  async checkCurrentVideo() {
    const videoId = this.extractVideoId();
    if (videoId && videoId !== this.currentVideoId) {
      this.currentVideoId = videoId;
      console.log('🎬 New video detected:', videoId);
      
      // Always start polling immediately - in case video was already processed
      console.log('🔄 Starting polling for existing claims...');
      this.startPolling();
      this.startTimeWatcher();
      
      // Also trigger analysis if auto-analyze is enabled
      chrome.storage.sync.get(['autoAnalyze'], async (result) => {
        if (result.autoAnalyze !== false) {
          await this.startHybridProcessing();
        }
      });
    }
  }

  extractVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
  }

  // ─────────────────────────────────────────────────────────────
  // Hybrid Processing
  // ─────────────────────────────────────────────────────────────

  async startHybridProcessing() {
    if (this.isProcessing) {
      console.log('⏳ Already processing this video');
      return;
    }

    const youtubeUrl = `https://www.youtube.com/watch?v=${this.currentVideoId}`;
    console.log('🚀 Starting hybrid processing:', youtubeUrl);
    
    this.isProcessing = true;
    this.updateBadge('...');

    try {
      console.log('📡 Calling API: POST /api/video/start');
      const response = await fetch(`${this.apiUrl}/api/video/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtube_url: youtubeUrl })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Processing started:', data);

      // Start polling for claims AND watching video time
      console.log('🔄 Starting polling and time watcher...');
      this.startPolling();
      this.startTimeWatcher();

    } catch (error) {
      console.error('❌ Failed to start processing:', error);
      this.isProcessing = false;
      this.updateBadge('!');
      
      // Check if it's a network error (API not running)
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        console.error('🔌 API server appears to be offline');
      }
      
      this.showNotification('Lumos Error', 'Failed to analyze video. Is the API server running?');
    }
  }

  startPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    console.log('🔄 Starting claim polling...');

    // Poll every 3 seconds to get NEW claims from API
    this.pollInterval = setInterval(() => {
      this.fetchAllClaims();
    }, 3000);

    this.fetchAllClaims();
  }

  // Separate watcher for video time - checks every 500ms
  startTimeWatcher() {
    if (this.timeWatcher) {
      clearInterval(this.timeWatcher);
    }

    this.timeWatcher = setInterval(() => {
      this.checkClaimsForCurrentTime();
    }, 500);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.timeWatcher) {
      clearInterval(this.timeWatcher);
      this.timeWatcher = null;
    }
    console.log('⏹️ Stopped polling');
  }

  async fetchAllClaims() {
    if (!this.currentVideoId) return;

    const url = `${this.apiUrl}/api/video/claims/yt-${this.currentVideoId}`;
    
    try {
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`📭 No claims yet for yt-${this.currentVideoId}`);
          return;
        }
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success) {
        const prevCount = this.allClaims.length;
        this.allClaims = data.data.claims || [];
        
        if (this.allClaims.length !== prevCount) {
          console.log(`📊 Claims updated: ${this.allClaims.length} total, status: ${data.data.status}`);
          // Log each claim's timestamp for debugging
          this.allClaims.forEach((c, i) => {
            console.log(`   [${i}] @ ${c.timestamp} (${this.parseTimestamp(c.timestamp)}s)`);
          });
        }
        
        this.updateBadgeFromStatus(data.data.status, this.allClaims.length);
        
        // Immediately check if any claims should show now
        this.checkClaimsForCurrentTime();
      }

    } catch (error) {
      console.warn('❌ Fetch claims error:', error.message);
    }
  }

  // Check which claims should be shown based on current video time
  checkClaimsForCurrentTime() {
    const video = document.querySelector('video');
    if (!video) return;
    
    const currentTimeSec = Math.floor(video.currentTime);
    
    // Don't re-check same second
    if (currentTimeSec === this.lastCheckTime) return;
    this.lastCheckTime = currentTimeSec;

    // Log every 5 seconds for debugging (more frequent)
    if (currentTimeSec % 5 === 0) {
      const nextClaim = this.allClaims.find(c => {
        const t = this.parseTimestamp(c.timestamp);
        return !this.shownClaimIds.has(`${c.timestamp}_${c.finding?.slice(0, 30)}`) && t > currentTimeSec;
      });
      const nextTs = nextClaim ? nextClaim.timestamp : 'none';
      console.log(`⏱️ ${this.formatTime(currentTimeSec)} | Claims: ${this.allClaims.length} | Shown: ${this.shownClaimIds.size} | Next: ${nextTs}`);
    }

    // Find claims that should trigger NOW
    for (const claim of this.allClaims) {
      const claimTimeSec = this.parseTimestamp(claim.timestamp);
      const claimKey = `${claim.timestamp}_${claim.finding?.slice(0, 30)}`;
      
      // Show claim if:
      // 1. We haven't shown it yet
      // 2. Current video time has passed the claim's timestamp
      if (!this.shownClaimIds.has(claimKey) && currentTimeSec >= claimTimeSec) {
        this.shownClaimIds.add(claimKey);
        
        console.log(`🚨 ALERT! Time ${this.formatTime(currentTimeSec)} >= claim @ ${claim.timestamp}`);
        console.log(`   📝 ${claim.finding?.slice(0, 60)}...`);
        
        // Show toast notification!
        this.showClaimToast(claim);
        
        // Notify popup/background
        chrome.runtime.sendMessage({
          type: 'CLAIM_TRIGGERED',
          claim,
          videoId: this.currentVideoId,
          triggeredAt: currentTimeSec
        });
      }
    }
  }

  parseTimestamp(ts) {
    if (!ts) return 0;
    const parts = ts.split(':').map(Number);
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  updateBadgeFromStatus(status, totalClaims) {
    const shownCount = this.shownClaimIds.size;
    
    if (status === 'complete') {
      this.updateBadge(shownCount > 0 ? shownCount.toString() : '✓');
    } else if (status === 'fast_track_complete' || status === 'processing') {
      this.updateBadge('...');
    }
  }

  // Get claims that have been revealed (for popup)
  getRevealedClaims() {
    const video = document.querySelector('video');
    const currentTimeSec = video ? Math.floor(video.currentTime) : 0;
    
    return this.allClaims.filter(claim => {
      const claimTimeSec = this.parseTimestamp(claim.timestamp);
      return currentTimeSec >= claimTimeSec;
    });
  }

  // ─────────────────────────────────────────────────────────────
  // UI: Toast Notifications
  // ─────────────────────────────────────────────────────────────

  showClaimToast(claim) {
    try {
      const host = this.ensureToastHost();

      const card = document.createElement('div');
      card.className = 'lumos-toast-card';
      card.style.cssText = `
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid rgba(99, 102, 241, 0.4);
        box-shadow: 0 10px 40px rgba(0,0,0,0.5), 0 0 30px rgba(99, 102, 241, 0.3);
        border-radius: 16px;
        padding: 16px 18px;
        margin-top: 12px;
        color: #e5e7eb;
        line-height: 1.4;
        cursor: pointer;
        pointer-events: auto;
        max-width: 380px;
        animation: lumos-slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        transform-origin: right center;
      `;

      // Header with icon and timestamp
      const header = document.createElement('div');
      header.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 10px;';
      
      const icon = document.createElement('span');
      icon.textContent = '🔬';
      icon.style.fontSize = '20px';
      
      const badge = document.createElement('span');
      badge.style.cssText = `
        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
        color: white;
        padding: 4px 10px;
        border-radius: 20px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.5px;
      `;
      badge.textContent = `CLAIM @ ${claim.timestamp}`;
      
      const confidence = document.createElement('span');
      confidence.style.cssText = `
        font-size: 10px; 
        padding: 3px 8px; 
        border-radius: 6px; 
        font-weight: 600;
        margin-left: auto;
        background: ${claim.confidence === 'high' ? '#10b981' : claim.confidence === 'medium' ? '#f59e0b' : '#6b7280'};
        color: white;
      `;
      confidence.textContent = (claim.confidence || 'MEDIUM').toUpperCase();
      
      header.appendChild(icon);
      header.appendChild(badge);
      header.appendChild(confidence);
      card.appendChild(header);

      // Author (if present)
      if (claim.author) {
        const author = document.createElement('div');
        author.style.cssText = 'font-size: 13px; color: #c4b5fd; margin-bottom: 8px; font-weight: 500;';
        author.textContent = `👤 ${claim.author}`;
        card.appendChild(author);
      }

      // Finding
      const finding = document.createElement('div');
      finding.style.cssText = 'font-size: 14px; color: #f3f4f6; margin-bottom: 12px; line-height: 1.5;';
      const findingText = claim.finding || claim.segment || '';
      finding.textContent = findingText.length > 160 ? findingText.slice(0, 160) + '...' : findingText;
      card.appendChild(finding);

      // Action button
      const btn = document.createElement('div');
      btn.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: #818cf8;
        padding: 6px 12px;
        background: rgba(99, 102, 241, 0.1);
        border-radius: 8px;
        transition: background 0.2s;
      `;
      btn.innerHTML = '📚 Verify this claim →';
      btn.onmouseover = () => btn.style.background = 'rgba(99, 102, 241, 0.2)';
      btn.onmouseout = () => btn.style.background = 'rgba(99, 102, 241, 0.1)';
      card.appendChild(btn);

      // Click to open verification
      card.addEventListener('click', () => {
        chrome.runtime.sendMessage({ 
          type: 'OPEN_VERIFICATION', 
          claim,
          videoId: this.currentVideoId 
        });
        try { host.removeChild(card); } catch {}
      });

      host.appendChild(card);

      // Play a subtle sound (if available)
      try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2Onp2TgXVqan2Ok5yZjoF2b3N/ipKUko+HfXZzdH6Gi46OjIeCfHh4e4CGioyMioaDf3x6e36ChoqLiomGg4B9fH1/gYWIiomIhoSBf31+f4GEh4iIh4aEgn9+f4CChIaHh4aFg4F/fn5/gIKEhYaGhYSDgX9+fn+Ag4SFhYWEg4GAf35/gIGDhIWFhIOCgH9+fn+AgYOEhISEg4KAf35/f4CCg4SEhIOCgYB/fn9/gIGCg4SEg4OCgX9/f3+AgYKDg4OCgoGAf39/gIGCg4ODg4KBgH9/f4CAgYKDg4OCgoGAf39/gIGBgoODg4KCgYB/f3+AgIGCg4ODgoKBgH9/f4CAgYKCg4OCgoGAf39/gICBgoKDg4KCgYB/f3+AgIGCgoODgoKBgH9/f4CAgYKCgoKCgYGAf39/gICBgoKCgoKBgYB/f3+AgIGBgoKCgoGBgH9/f4CAgYGCgoKCgYGAf39/gICAgoKCgoKBgYB/f3+AgICBgoKCgoGBgH9/f4CAgIGCgoKCgYGAf39/gICAgYKCgoKBgYB/f3+AgICBgoKCgoGBgH9/f4CAgIGBgoKCgYGAf39/gICAgYGCgoKBgYB/f3+AgICBgYKCgoGBgH9/f4CAgIGBgoKBgYGAf39/gICAgYGCgoGBgYB/f3+AgICBgYKCgYGBgH9/f4CAgIGBgoKBgYGAf3+AgICAgYGBgoGBgYB/f4CAgICBgYGCgYGBgH9/gICAgIGBgYKBgYGAf3+AgICAgYGBgoGBgYB/f4CAgICBgYGBgYGBgH9/gICAgIGBgYGBgYGAf3+AgICAgYGBgYGBgYB/f4CAgICAgYGBgYGBgH9/gICAgIGBgYGBgYGAf3+AgICAgYGBgYGBgYB/f4CAgICBgYGBgYGBgH9/gICAgIGBgYGBgYGAf3+AgICAgYGBgYGBgICAf3+AgICAgYGBgYGBgICAf3+AgICAgYGBgYGBgICAf3+AgICAgYGBgYGAgICAf3+AgICAgYGBgYGAgICAf3+AgICAgIGBgYGAgICAf3+AgICAgIGBgYGAgICAf3+AgICAgIGBgYGAgICAf3+AgICAgIGBgYGAgICAf3+AgICAgIGBgYGAgICAf3+AgICAgIGBgYGAgICAf3+AgICAgIGBgYCAgICAf3+AgICAgIGBgYCAgICAf3+AgICAgIGBgYCAgICAf3+AgICAgIGBgYCAgICAf3+AgICAgIGBgYCAgICAf3+AgICAgIGBgICAgICAf3+AgICAgICBgICAgICAf3+AgICAgICBgICAgICAf3+AgICAgICBgICAgICAf3+AgICAgICBgICAgICAf3+AgICAgICAgICAgICAf3+AgICAgICAgICAgICAf3+AgICAgICAgICAgICAf3+AgICAgICAgICAgICAf3+AgICAgICAgICAgICAf3+AgICAgICAgICAgICAf3+AgICAgICAgICAgICAfw==');
        audio.volume = 0.3;
        audio.play().catch(() => {});
      } catch {}

      // Auto-remove after 10 seconds with fade out
      setTimeout(() => {
        try { 
          card.style.animation = 'lumos-slide-out 0.4s ease-in forwards';
          setTimeout(() => { try { host.removeChild(card); } catch {} }, 400);
        } catch {}
      }, 10000);

    } catch (e) {
      console.warn('Toast error:', e);
    }
  }

  ensureToastHost() {
    let host = document.getElementById('lumos-toast');
    if (host) return host;

    // Add animations
    const style = document.createElement('style');
    style.textContent = `
      @keyframes lumos-slide-in {
        from { opacity: 0; transform: translateX(120px) scale(0.9); }
        to { opacity: 1; transform: translateX(0) scale(1); }
      }
      @keyframes lumos-slide-out {
        from { opacity: 1; transform: translateX(0) scale(1); }
        to { opacity: 0; transform: translateX(120px) scale(0.9); }
      }
    `;
    document.head.appendChild(style);

    host = document.createElement('div');
    host.id = 'lumos-toast';
    host.style.cssText = `
      position: fixed;
      right: 24px;
      bottom: 100px;
      z-index: 2147483647;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      pointer-events: none;
    `;
    
    document.documentElement.appendChild(host);
    console.log('🍞 Toast host created');
    return host;
  }

  showNotification(title, message) {
    if (Notification.permission === 'granted') {
      new Notification(title, {
        body: message,
        icon: chrome.runtime.getURL('icons/icon48.png')
      });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }

  updateBadge(text) {
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', text });
  }

  handleMessage(message, sendResponse) {
    switch (message.type) {
      case 'GET_STATUS':
        sendResponse({
          isProcessing: this.isProcessing,
          videoId: this.currentVideoId,
          claimsShown: this.shownClaimIds.size,
          totalClaims: this.allClaims.length,
          url: location.href
        });
        break;
        
      case 'GET_REVEALED_CLAIMS':
        // Return only claims that have been revealed based on video time
        sendResponse({
          claims: this.getRevealedClaims()
        });
        break;
        
      case 'START_ANALYSIS':
        this.startHybridProcessing();
        sendResponse({ success: true });
        break;
        
      case 'GET_TIME':
        const v = document.querySelector('video');
        sendResponse({ timeSec: Math.floor(v?.currentTime || 0) });
        break;
        
      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }
}

// Initialize
console.log('🔧 Lumos content script loaded (Hybrid Mode v2)');

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.LumosMonitor = new LumosYouTubeMonitor();
  });
} else {
  window.LumosMonitor = new LumosYouTubeMonitor();
}
