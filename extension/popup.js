// Popup script for Lumos (Hybrid Mode)
class LumosPopup {
  constructor() {
    this.currentTab = null;
    this.currentStatus = null;
    this.apiUrl = 'http://localhost:3001';
    this.astroUrl = 'http://localhost:4321';
    this.pollInterval = null;
    
    this.init();
  }

  async init() {
    console.log('🔧 Lumos popup initialized');
    
    // Get current tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    this.currentTab = tabs[0];
    
    // If not on YouTube, try to find a YouTube tab
    if (!this.isYouTubePage()) {
      const ytTabs = await chrome.tabs.query({ url: '*://*.youtube.com/watch*' });
      if (ytTabs?.length) this.currentTab = ytTabs[0];
    }
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Load current status
    await this.loadStatus();
    
    // Load settings
    await this.loadSettings();
    
    // Start polling for claims if on YouTube
    if (this.isYouTubePage()) {
      this.startPolling();
    }
  }

  setupEventListeners() {
    document.getElementById('analyze-btn').addEventListener('click', () => {
      this.triggerAnalysis();
    });
    
    document.getElementById('auto-analyze-toggle').addEventListener('click', (e) => {
      this.toggleAutoAnalyze(e.currentTarget);
    });
    
    document.getElementById('view-all').addEventListener('click', (e) => {
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
      const response = await chrome.tabs.sendMessage(this.currentTab.id, {
        type: 'GET_STATUS'
      });
      
      this.updateStatusDisplay(response);
      
    } catch (error) {
      console.log('Content script not ready:', error);
      this.showNotReady();
    }
  }

  async loadSettings() {
    const result = await chrome.storage.sync.get(['autoAnalyze']);
    
    const toggle = document.getElementById('auto-analyze-toggle');
    if (result.autoAnalyze !== false) { // Default to true
      toggle.classList.add('active');
    } else {
      toggle.classList.remove('active');
    }
  }

  startPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    
    // Poll every 2 seconds
    this.pollInterval = setInterval(() => {
      this.loadClaims();
    }, 2000);
    
    // Also load immediately
    this.loadClaims();
  }

  async loadClaims() {
    if (!this.currentStatus?.videoId) return;

    try {
      // Get REVEALED claims from content script (filtered by video time)
      let revealedClaims = [];
      let totalClaims = 0;
      
      try {
        const revealed = await chrome.tabs.sendMessage(this.currentTab.id, {
          type: 'GET_REVEALED_CLAIMS'
        });
        
        if (revealed?.claims) {
          revealedClaims = revealed.claims;
        }
      } catch (e) {
        console.log('Could not get revealed claims from content script');
      }

      // Also get total claims from API to know progress
      try {
        const response = await fetch(
          `${this.apiUrl}/api/video/claims/yt-${this.currentStatus.videoId}`
        );

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            totalClaims = data.data.claims?.length || 0;
            this.updateProcessingStatus(data.data.status, revealedClaims.length, totalClaims);
          }
        }
      } catch (e) {
        console.log('Could not fetch claims from API');
      }

      // Display the revealed claims
      this.displayClaims({ claims: revealedClaims });

    } catch (error) {
      console.error('loadClaims error:', error);
    }
  }

  isYouTubePage() {
    return this.currentTab?.url?.includes('youtube.com/watch');
  }

  showNotYouTube() {
    const statusCard = document.getElementById('status');
    const statusLabel = document.getElementById('status-label');
    const statusDetail = document.getElementById('status-detail');
    const analyzeBtn = document.getElementById('analyze-btn');
    
    statusCard.className = 'status-card idle';
    statusLabel.textContent = 'Not on YouTube';
    statusDetail.textContent = 'Open a YouTube video to start';
    analyzeBtn.disabled = true;
  }

  showNotReady() {
    const statusLabel = document.getElementById('status-label');
    const statusDetail = document.getElementById('status-detail');
    
    statusLabel.textContent = 'Loading...';
    statusDetail.textContent = 'Waiting for content script';
    
    // Retry after a moment
    setTimeout(() => this.loadStatus(), 1000);
  }

  updateStatusDisplay(status) {
    this.currentStatus = status;
    
    const statusCard = document.getElementById('status');
    const statusLabel = document.getElementById('status-label');
    const statusDetail = document.getElementById('status-detail');
    const videoInfo = document.getElementById('video-info');
    const analyzeBtn = document.getElementById('analyze-btn');
    
    if (status?.isProcessing) {
      statusCard.className = 'status-card processing';
      statusLabel.textContent = 'Analyzing video...';
      const shown = status.claimsShown || 0;
      const total = status.totalClaims || 0;
      statusDetail.textContent = total > 0 
        ? `${shown} shown / ${total} found (alerts appear as you watch)`
        : 'Processing...';
      analyzeBtn.disabled = true;
    } else if (status?.videoId) {
      statusCard.className = 'status-card idle';
      statusLabel.textContent = 'Ready to analyze';
      statusDetail.textContent = 'Click button or wait for auto-analyze';
      analyzeBtn.disabled = false;
    } else {
      statusCard.className = 'status-card idle';
      statusLabel.textContent = 'Not on YouTube';
      statusDetail.textContent = 'Navigate to a YouTube video';
      analyzeBtn.disabled = true;
    }
    
    if (status?.videoId) {
      videoInfo.style.display = 'block';
      document.getElementById('video-id').textContent = `Video ID: ${status.videoId}`;
    } else {
      videoInfo.style.display = 'none';
    }
  }

  updateProcessingStatus(status, revealedCount = 0, totalCount = 0) {
    const statusCard = document.getElementById('status');
    const statusLabel = document.getElementById('status-label');
    const statusDetail = document.getElementById('status-detail');
    
    const claimsInfo = totalCount > 0 
      ? `${revealedCount} shown / ${totalCount} total`
      : 'No claims yet';
    
    if (status === 'complete') {
      statusCard.className = 'status-card idle';
      statusLabel.textContent = '✓ Analysis complete';
      statusDetail.textContent = totalCount > 0 
        ? `${claimsInfo} • Alerts appear as you watch`
        : 'No scientific claims found in this video';
    } else if (status === 'fast_track_complete') {
      statusCard.className = 'status-card processing';
      statusLabel.textContent = 'Still analyzing...';
      statusDetail.textContent = `${claimsInfo} • More coming`;
    } else if (status === 'processing') {
      statusCard.className = 'status-card processing';
      statusLabel.textContent = 'Analyzing video...';
      statusDetail.textContent = claimsInfo;
    } else {
      // Not started or unknown
      statusCard.className = 'status-card idle';
      statusLabel.textContent = 'Ready';
      statusDetail.textContent = 'Will analyze when video plays';
    }
  }

  async triggerAnalysis() {
    if (!this.currentStatus?.videoId) return;

    try {
      await chrome.tabs.sendMessage(this.currentTab.id, {
        type: 'START_ANALYSIS'
      });
      
      // Update UI immediately
      const statusCard = document.getElementById('status');
      const statusLabel = document.getElementById('status-label');
      
      statusCard.className = 'status-card processing';
      statusLabel.textContent = 'Starting analysis...';
      
    } catch (error) {
      console.error('Failed to start analysis:', error);
    }
  }

  displayClaims(data) {
    const claimsList = document.getElementById('claims-list');
    const claimsCount = document.getElementById('claims-count');
    const claims = data.claims || [];
    
    claimsCount.textContent = claims.length;
    
    if (claims.length === 0) {
      claimsList.innerHTML = `
        <div class="no-claims">
          <div class="no-claims-icon">🔍</div>
          No claims detected yet
        </div>
      `;
      return;
    }
    
    // Sort by timestamp
    claims.sort((a, b) => {
      const timeA = this.parseTimestamp(a.timestamp);
      const timeB = this.parseTimestamp(b.timestamp);
      return timeA - timeB;
    });
    
    // Display claims (max 6)
    const recentClaims = claims.slice(0, 6);
    
    claimsList.innerHTML = recentClaims.map(claim => `
      <div class="claim-item" data-claim='${JSON.stringify(claim).replace(/'/g, "\\'")}'>
        <div class="claim-header">
          <span class="claim-timestamp">@ ${claim.timestamp}</span>
          <span class="claim-confidence ${claim.confidence || 'medium'}">${(claim.confidence || 'MEDIUM').toUpperCase()}</span>
        </div>
        ${claim.author ? `<div class="claim-author">👤 ${claim.author}</div>` : ''}
        <div class="claim-text">${this.truncate(claim.finding || claim.segment || '', 100)}</div>
      </div>
    `).join('');
    
    // Add click handlers
    claimsList.querySelectorAll('.claim-item').forEach(item => {
      item.addEventListener('click', () => {
        const claim = JSON.parse(item.dataset.claim);
        this.openClaimDetails(claim);
      });
    });
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

  truncate(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  async toggleAutoAnalyze(toggleEl) {
    const isActive = toggleEl.classList.toggle('active');
    await chrome.storage.sync.set({ autoAnalyze: isActive });
    console.log('Auto-analyze setting:', isActive);
  }

  async openClaimDetails(claim) {
    // Open verification page for this claim
    const url = `${this.astroUrl}/alerts?claim=${encodeURIComponent(JSON.stringify(claim))}`;
    await chrome.tabs.create({ url });
    window.close();
  }

  async openAlertsPage() {
    const url = this.currentStatus?.videoId 
      ? `${this.astroUrl}/alerts?video_id=${this.currentStatus.videoId}`
      : `${this.astroUrl}/alerts`;
    await chrome.tabs.create({ url });
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
