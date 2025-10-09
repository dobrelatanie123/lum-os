// Popup script
class LumosPopup {
  constructor() {
    this.currentTab = null;
    this.currentStatus = null;
    this.astroUrl = 'http://localhost:4321';
    // Promisified helpers for Chrome compatibility
    this.sendMessage = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
    this.tabsQuery = (q) => new Promise((resolve) => chrome.tabs.query(q, resolve));
    this.tabsSend = (tabId, msg) => new Promise((resolve) => chrome.tabs.sendMessage(tabId, msg, resolve));
    this.storageGet = (keys) => new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
    this.init();
  }

  async init() {
    console.log('🔧 Popup initialized');
    
    // Get current tab; if not YouTube, try to find a YouTube tab in the window
    const tabs = await this.tabsQuery({ active: true, currentWindow: true });
    this.currentTab = tabs[0];
    if (!this.isYouTubePage()) {
      const ytTabs = await this.tabsQuery({ url: '*://*.youtube.com/watch*' });
      if (ytTabs?.length) this.currentTab = ytTabs[0];
    }
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Load current status
    await this.loadStatus();
    
    // Load settings
    await this.loadSettings();
    const cfg = await this.storageGet(['astroUrl']);
    if (cfg?.astroUrl) this.astroUrl = cfg.astroUrl;
    
    // Load alerts
    await this.loadAlerts();

    // Listen for live updates from background
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'GROUPED_TOPICS_UPDATED') {
        // Re-render when background storage changes
        this.loadAlerts();
      }
    });

    // Lightweight polling to catch missed events (every 5s)
    this.pollId = setInterval(() => {
      this.loadAlerts();
    }, 5000);
  }

  setupEventListeners() {
    // Control buttons
    document.getElementById('start-btn').addEventListener('click', () => {
      this.startMonitoring();
    });
    
    document.getElementById('stop-btn').addEventListener('click', () => {
      this.stopMonitoring();
    });
    
    // Settings toggle
    document.getElementById('auto-record-toggle').addEventListener('click', (e) => {
      this.toggleAutoRecord(e.target);
    });
    
    // Footer links
    document.getElementById('view-all-alerts').addEventListener('click', (e) => {
      e.preventDefault();
      this.openAlertsPage();
    });
    
    document.getElementById('settings-link').addEventListener('click', (e) => {
      e.preventDefault();
      this.openSettingsPage();
    });
  }

  async loadStatus() {
    if (!this.isYouTubePage()) {
      this.showNotYouTube();
      return;
    }

    try {
      // Send message to content script
      const response = await this.tabsSend(this.currentTab.id, {
        type: 'GET_STATUS'
      });
      
      this.updateStatusDisplay(response);
      
    } catch (error) {
      console.log('Content script not ready:', error);
      this.showNotReady();
    }
  }

  async loadSettings() {
    const result = await chrome.storage.sync.get(['autoRecord', 'alertThreshold']);
    
    const autoRecordToggle = document.getElementById('auto-record-toggle');
    if (result.autoRecord) {
      autoRecordToggle.classList.add('active');
    }
  }

  async loadAlerts() {
    if (!this.currentStatus?.videoId) return;

    try {
      // Try quick local cache first for instant render
      try {
        const key = `grouped_${this.currentStatus.videoId}`;
        const cachedLocal = await chrome.storage.local.get([key]);
        const items = cachedLocal?.[key];
        if (Array.isArray(items) && items.length) {
          this.displayGrouped(items);
        }
      } catch {}

      // Prefer grouped topics (force fetch first to avoid empty cache in some browsers)
      const grouped = await this.sendMessage({
        type: 'FETCH_GROUPED_ALERTS',
        videoId: this.currentStatus.videoId
      });
      if (Array.isArray(grouped?.topics) && grouped.topics.length > 0) {
        this.displayGrouped(grouped.topics);
        return;
      }

      // Fallback to cached grouped
      const cached = await this.sendMessage({
        type: 'GET_GROUPED_ALERTS',
        videoId: this.currentStatus.videoId
      });
      if (Array.isArray(cached?.topics) && cached.topics.length > 0) {
        this.displayGrouped(cached.topics);
        return;
      }

      // Fallback to alert chunks
      const response = await this.sendMessage({
        type: 'GET_ALERTS',
        videoId: this.currentStatus.videoId
      });
      this.displayAlerts(response.alerts || []);
      
    } catch (error) {
      console.error('Failed to load alerts:', error);
    }
  }

  isYouTubePage() {
    return this.currentTab?.url?.includes('youtube.com/watch');
  }

  showNotYouTube() {
    document.getElementById('status-text').textContent = 'Not on YouTube';
    document.getElementById('start-btn').disabled = true;
    document.getElementById('stop-btn').disabled = true;
  }

  showNotReady() {
    document.getElementById('status-text').textContent = 'Loading...';
    document.getElementById('start-btn').disabled = true;
    document.getElementById('stop-btn').disabled = true;
    
    // Retry after a moment
    setTimeout(() => this.loadStatus(), 1000);
  }

  updateStatusDisplay(status) {
    this.currentStatus = status;
    
    const statusEl = document.getElementById('status');
    const statusText = document.getElementById('status-text');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const videoInfo = document.getElementById('video-info');
    
    if (status?.isRecording) {
      statusEl.className = 'status active';
      statusText.textContent = 'Monitoring active';
      startBtn.disabled = true;
      stopBtn.disabled = false;
    } else {
      statusEl.className = 'status inactive';
      statusText.textContent = 'Monitoring inactive';
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
    
    if (status?.videoId) {
      videoInfo.style.display = 'block';
      document.getElementById('video-id').textContent = `Video ID: ${status.videoId}`;
      document.getElementById('video-url').textContent = status.url;
    } else {
      videoInfo.style.display = 'none';
    }
  }

  async startMonitoring() {
    try {
      await chrome.tabs.sendMessage(this.currentTab.id, {
        type: 'START_RECORDING'
      });
      
      // Refresh status
      setTimeout(() => this.loadStatus(), 500);
      
    } catch (error) {
      console.error('Failed to start monitoring:', error);
      alert('Failed to start monitoring. Please refresh the page and try again.');
    }
  }

  async stopMonitoring() {
    try {
      await chrome.tabs.sendMessage(this.currentTab.id, {
        type: 'STOP_RECORDING'
      });
      
      // Refresh status
      setTimeout(() => this.loadStatus(), 500);
      
    } catch (error) {
      console.error('Failed to stop monitoring:', error);
    }
  }

  async toggleAutoRecord(toggleEl) {
    const isActive = toggleEl.classList.toggle('active');
    
    await chrome.storage.sync.set({ autoRecord: isActive });
    
    console.log('Auto-record setting:', isActive);
  }

  displayAlerts(alertChunks) {
    const alertsList = document.getElementById('alerts-list');
    const alertCount = document.getElementById('alert-count');
    
    // Flatten all alerts from all chunks
    const allAlerts = alertChunks.flatMap(chunk => 
      chunk.alerts.map(alert => ({
        ...alert,
        timestamp: chunk.timestamp
      }))
    );
    
    alertCount.textContent = allAlerts.length;
    
    if (allAlerts.length === 0) {
      alertsList.innerHTML = '<div class="no-alerts">No alerts detected</div>';
      return;
    }
    
    // Sort by timestamp (newest first)
    allAlerts.sort((a, b) => b.timestamp - a.timestamp);
    
    // Display recent alerts (max 5)
    const recentAlerts = allAlerts.slice(0, 5);
    
    alertsList.innerHTML = recentAlerts.map(alert => `
      <div class="alert-item">
        <div class="alert-verdict ${alert.verdict}">${alert.verdict}</div>
        <div class="alert-claim">${this.truncateText(alert.claim, 80)}</div>
        <div class="alert-confidence">Confidence: ${Math.round(alert.confidence * 100)}%</div>
      </div>
    `).join('');
  }

  displayGrouped(topics) {
    const alertsList = document.getElementById('alerts-list');
    const alertCount = document.getElementById('alert-count');
    alertCount.textContent = topics.length;
    if (!topics.length) {
      alertsList.innerHTML = '<div class="no-alerts">No alerts detected</div>';
      return;
    }
    const items = topics.slice(0, 5).map(t => {
      const claim = t.details?.canonical_claim || t.details?.claim || 'Grouped topic';
      const urls = (() => { try { return JSON.parse(t.urls || '[]'); } catch { return []; } })();
      const link = urls[0] ? urls[0].replace(/^https?:\/\//, '') : 'no link';
      return `
        <div class="alert-item">
          <div class="alert-verdict">topic</div>
          <div class="alert-claim">${this.truncateText(claim, 120)}</div>
          <div class="alert-confidence">${link}</div>
        </div>
      `;
    }).join('');
    alertsList.innerHTML = items;
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  async openAlertsPage() {
    if (this.currentStatus?.videoId) {
      const url = `${this.astroUrl}/alerts?video_id=${this.currentStatus.videoId}`;
      await chrome.tabs.create({ url });
    } else {
      await chrome.tabs.create({ url: `${this.astroUrl}/alerts` });
    }
    window.close();
  }

  async openSettingsPage() {
    await chrome.tabs.create({ url: `${this.astroUrl}/settings` });
    window.close();
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new LumosPopup();
});


