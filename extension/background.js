// Background service worker
class LumosBackground {
  constructor() {
    this.alertsStorage = new Map();
    this.groupedStorage = new Map(); // videoId -> latest grouped topics
    this.pollers = new Map(); // videoId -> intervalId
    // Use API server as default to avoid CORS (it proxies to Astro and sets CORS: *)
    this.astroUrl = 'http://localhost:3001';
    this.popupWindowId = null; // external popup window id
    this.lastAutoOpenAt = 0;
    this.autoOpenCooldownMs = 8000;
    this.prevTopicCounts = new Map(); // videoId -> last seen grouped count
    // Added: background recorders state for tab audio capture
    this.bgRecorders = new Map(); // videoId -> { recorder, stream, tabId, timer }
    this.init();
  }

  init() {
    console.log('🔧 Lumos background service worker initialized');
    
    // Listen for messages from content scripts
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep response channel open
    });

    // Handle installation
    chrome.runtime.onInstalled.addListener((details) => {
      if (details.reason === 'install') {
        this.onInstall();
      }
    });

    // Load settings
    chrome.storage.sync.get(['apiUrl', 'astroUrl'], (res) => {
      if (res.apiUrl) this.astroUrl = res.apiUrl;
      else if (res.astroUrl) this.astroUrl = res.astroUrl;
    });

    // Handle browser notifications click
    chrome.notifications.onClicked.addListener((notificationId) => {
      this.onNotificationClick(notificationId);
    });
  }

  onInstall() {
    console.log('🎉 Lumos extension installed');
    
    // Set default settings
    chrome.storage.sync.set({
      autoRecord: true,
      alertThreshold: 0.7,
      apiUrl: 'http://localhost:3001',
      autoOpenOnAlert: true
    });

    // Show welcome notification
    chrome.notifications.create('welcome', {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Lumos Installed!',
      message: 'Your YouTube fact-checker is ready. Visit any YouTube video to start monitoring.'
    });
  }

  handleMessage(message, sender, sendResponse) {
    console.log('📩 Background received:', message.type);

    switch (message.type) {
      case 'UPDATE_BADGE':
        this.updateBadge(message.text, sender.tab?.id);
        sendResponse({ success: true });
        break;

      case 'ALERTS_DETECTED':
        this.handleAlertsDetected(message, sender.tab);
        sendResponse({ success: true });
        break;

      case 'GET_ALERTS':
        this.getStoredAlerts(message.videoId, sendResponse);
        break;

      case 'GET_GROUPED_ALERTS':
        this.getGroupedAlerts(message.videoId, sendResponse);
        break;

      case 'FETCH_GROUPED_ALERTS': {
        const vid = message.videoId;
        this.fetchGroupedNow(vid, sender.tab?.id).then((data) => {
          sendResponse({ topics: Array.isArray(data) ? data : [] });
        }).catch(() => sendResponse({ topics: [] }));
        return true;
      }

      case 'OPEN_POPUP':
        this.openPopupRobust(message.videoId).then(() => sendResponse({ success: true })).catch(() => sendResponse({ success: false }));
        return true;

      case 'SHOW_GROUPED_TOPIC':
        this.showGroupedTopicNotification(message.topic, message.videoId, sender.tab);
        sendResponse({ success: true });
        break;

      case 'CLEAR_ALERTS':
        this.clearAlerts(message.videoId);
        sendResponse({ success: true });
        break;

      case 'AD_BLOCKER_DETECTED':
        this.handleAdBlockerDetection(message, sender.tab);
        sendResponse({ success: true });
        break;

      case 'START_POLL':
        this.startPolling(message.videoId, sender.tab?.id);
        sendResponse({ success: true });
        break;

      case 'STOP_POLL':
        this.stopPolling(message.videoId);
        sendResponse({ success: true });
        break;

      // Added: background tab audio capture control (no mic prompt)
      case 'START_RECORDING_BG':
        this.startBackgroundCapture(sender.tab?.id, message.videoId)
          .then(() => sendResponse({ success: true }))
          .catch(() => sendResponse({ success: false }));
        return true;

      case 'STOP_RECORDING_BG':
        this.stopBackgroundCapture(message.videoId);
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }

  updateBadge(text, tabId) {
    if (tabId) {
      chrome.action.setBadgeText({
        text: text,
        tabId: tabId
      });
      
      chrome.action.setBadgeBackgroundColor({
        color: text ? '#ff4444' : '#4CAF50',
        tabId: tabId
      });
    }
  }

  async handleAlertsDetected(message, tab) {
    const { alerts, transcript, videoId, timestamp } = message;
    
    // Store alerts for this video
    if (!this.alertsStorage.has(videoId)) {
      this.alertsStorage.set(videoId, []);
    }
    
    const videoAlerts = this.alertsStorage.get(videoId);
    videoAlerts.push({
      alerts,
      transcript,
      timestamp,
      tabId: tab?.id,
      url: tab?.url
    });

    // Limit storage per video (keep last 50 chunks)
    if (videoAlerts.length > 50) {
      videoAlerts.splice(0, videoAlerts.length - 50);
    }

    // Show system notification for high-priority alerts
    for (const alert of alerts) {
      if (alert.confidence >= 0.8) {
        await this.showSystemNotification(alert, videoId, tab);
      }
    }

    // Update badge with total alert count for this video
    const totalAlerts = videoAlerts.reduce((sum, chunk) => sum + chunk.alerts.length, 0);
    this.updateBadge(totalAlerts > 0 ? totalAlerts.toString() : '', tab?.id);
  }

  async showSystemNotification(alert, videoId, tab) {
    const notificationId = `alert_${videoId}_${Date.now()}`;
    
    const options = {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: `⚠️ ${alert.verdict.toUpperCase()}: Potential Misinformation`,
      message: `"${alert.claim.substring(0, 100)}${alert.claim.length > 100 ? '...' : ''}"\n\nClick to see analysis`,
      priority: 2
    };

    chrome.notifications.create(notificationId, options);

    // Store notification data for click handling
    chrome.storage.local.set({
      [notificationId]: {
        alert,
        videoId,
        tabId: tab?.id,
        url: tab?.url
      }
    });

    // Auto-clear notification after 10 seconds
    setTimeout(() => {
      chrome.notifications.clear(notificationId);
    }, 10000);
  }

  async showGroupedTopicNotification(topic, videoId, tab) {
    try {
      const claim = topic?.details?.canonical_claim || topic?.details?.claim || 'Topic alert';
      const urls = (() => { try { return JSON.parse(topic?.urls || '[]'); } catch { return []; } })();
      const link = urls[0] || `${this.astroUrl}/alerts?video_id=${encodeURIComponent(videoId)}`;
      const notificationId = `topic_${videoId}_${Date.now()}`;
      const options = {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '🔎 Fact-check topic detected',
        message: claim.slice(0, 140),
        priority: 1,
        requireInteraction: true
      };
      chrome.notifications.create(notificationId, options);
      chrome.storage.local.set({
        [notificationId]: {
          topic,
          videoId,
          tabId: tab?.id,
          url: tab?.url,
          type: 'grouped_topic',
          link
        }
      });
      setTimeout(() => { chrome.notifications.clear(notificationId); }, 10000);

      // Auto-open robust popup window (debounced)
      await this.openPopupRobust(videoId);
    } catch {}
  }

  async openPopupRobust(videoId) {
    try {
      const now = Date.now();
      if (now - this.lastAutoOpenAt < this.autoOpenCooldownMs) return;
      this.lastAutoOpenAt = now;

      const { autoOpenOnAlert } = await chrome.storage.sync.get(['autoOpenOnAlert']);
      if (autoOpenOnAlert === false) return;

      // Focus existing popup window if present
      if (this.popupWindowId) {
        try {
          await chrome.windows.update(this.popupWindowId, { focused: true });
          return;
        } catch { this.popupWindowId = null; }
      }

      // Preferred: open the extension action popup (same as clicking the icon)
      try {
        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const targetTab = activeTabs?.[0];
        if (targetTab?.windowId) {
          try { await chrome.windows.update(targetTab.windowId, { focused: true }); } catch {}
          await chrome.action.openPopup({ windowId: targetTab.windowId });
          return;
        }
      } catch (eOpen) {
        console.warn('openPopupRobust: action.openPopup failed', eOpen, chrome.runtime.lastError);
      }

      // Next: open a new tab with the popup page in the current window (close to clicking behavior)
      const url = chrome.runtime.getURL('popup.html');
      try {
        const cur = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.tabs.create({ url, index: (cur[0]?.index || 0) + 1, active: true });
        return;
      } catch (eTab) {
        console.warn('openPopupRobust: tabs.create preferred path failed', eTab, chrome.runtime.lastError);
      }

      // Fallback: popup window
      try {
        const win = await chrome.windows.create({ url, type: 'popup', focused: true, width: 420, height: 640 });
        this.popupWindowId = win.id || null;
        chrome.windows.onRemoved.addListener((id) => {
          if (id === this.popupWindowId) this.popupWindowId = null;
        });
        return;
      } catch (e1) {
        console.warn('openPopupRobust: popup window failed', e1, chrome.runtime.lastError);
      }

      // Fallback: normal window
      try {
        const win2 = await chrome.windows.create({ url, type: 'normal', focused: true, width: 420, height: 640 });
        this.popupWindowId = win2.id || null;
        chrome.windows.onRemoved.addListener((id) => {
          if (id === this.popupWindowId) this.popupWindowId = null;
        });
        return;
      } catch (e2) {
        console.warn('openPopupRobust: normal window failed', e2, chrome.runtime.lastError);
      }

      // Fallback: open web alerts page
      try {
        const base = this.astroUrl || 'http://localhost:3001';
        const urlWeb = `${base.replace(/\/$/, '')}/alerts?video_id=${encodeURIComponent(videoId || '')}`;
        await chrome.tabs.create({ url: urlWeb, active: true });
      } catch (e4) {
        console.error('openPopupRobust: web page fallback failed', e4, chrome.runtime.lastError);
      }
    } catch {}
  }

  async onNotificationClick(notificationId) {
    // Get notification data
    const result = await chrome.storage.local.get(notificationId);
    const data = result[notificationId];
    
    if (!data) return;

    // Focus the YouTube tab if it exists
    if (data.tabId) {
      try {
        await chrome.tabs.update(data.tabId, { active: true });
        await chrome.windows.update((await chrome.tabs.get(data.tabId)).windowId, { focused: true });
      } catch (error) {
        console.log('Tab no longer exists, opening new one');
        chrome.tabs.create({ url: data.url });
      }
    }

    // Open our fact-check details page or topic URL if present
    const base = this.astroUrl || 'http://localhost:4321';
    const detailsUrl = data.link || `${base}/alerts?video_id=${data.videoId}`;
    chrome.tabs.create({ url: detailsUrl });

    // Clean up
    chrome.storage.local.remove(notificationId);
    chrome.notifications.clear(notificationId);
  }

  getStoredAlerts(videoId, sendResponse) {
    const alerts = this.alertsStorage.get(videoId) || [];
    sendResponse({ alerts });
  }

  clearAlerts(videoId) {
    if (videoId) {
      this.alertsStorage.delete(videoId);
      this.groupedStorage.delete(videoId);
      this.stopPolling(videoId);
    } else {
      this.alertsStorage.clear();
      this.groupedStorage.clear();
      for (const [vid] of this.pollers.entries()) this.stopPolling(vid);
    }
  }

  getGroupedAlerts(videoId, sendResponse) {
    const topics = this.groupedStorage.get(videoId) || [];
    sendResponse({ topics });
  }

  startPolling(videoId, tabId) {
    if (!videoId) return;
    // Avoid duplicate pollers
    if (this.pollers.has(videoId)) return;
    const fetchNow = async () => {
      try {
        const tryFetch = async (base) => {
          const url = `${base}/api/alerts/for-video?video_id=${encodeURIComponent(videoId)}&group=topic`;
          const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
          if (!res.ok) throw new Error(`Bad status ${res.status}`);
          return await res.json();
        };
        let data = null;
        const candidates = (() => {
          const list = [];
          list.push(this.astroUrl);
          // Add common dev ports
          if (this.astroUrl !== 'http://localhost:4321') list.push('http://localhost:4321');
          if (this.astroUrl !== 'http://localhost:4322') list.push('http://localhost:4322');
          if (this.astroUrl !== 'http://localhost:3003') list.push('http://localhost:3003');
          return list;
        })();
        for (const base of candidates) {
          try {
            const res = await tryFetch(base);
            data = res;
            if (this.astroUrl !== base) {
              this.astroUrl = base;
              chrome.storage.sync.set({ astroUrl: base });
            }
            break;
          } catch {}
        }
        if (Array.isArray(data)) {
          this.groupedStorage.set(videoId, data);
          try { await chrome.storage.local.set({ [`grouped_${videoId}`]: data }); } catch {}
          this.updateBadge(String(data.length || ''), tabId);
          // Broadcast to all tabs listening for updates
          chrome.runtime.sendMessage({ type: 'GROUPED_TOPICS_UPDATED', videoId, count: data.length });
          // Auto-open on first availability to avoid race with popup init
          const prev = this.prevTopicCounts.get(videoId) || 0;
          this.prevTopicCounts.set(videoId, data.length || 0);
          if (prev === 0 && data.length > 0) {
            await this.openPopupRobust(videoId);
          }
        }
      } catch {}
    };
    // Immediate fetch then interval
    fetchNow();
    const id = setInterval(fetchNow, 10000);
    this.pollers.set(videoId, id);
  }

  stopPolling(videoId) {
    if (!videoId) return;
    const id = this.pollers.get(videoId);
    if (id) {
      clearInterval(id);
      this.pollers.delete(videoId);
    }
  }

  async fetchGroupedNow(videoId, tabId) {
    if (!videoId) return [];
    try {
      const tryFetch = async (base) => {
        const url = `${base}/api/alerts/for-video?video_id=${encodeURIComponent(videoId)}&group=topic`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error(`Bad status ${res.status}`);
        return await res.json();
      };
      const candidates = (() => {
        const list = [];
        list.push(this.astroUrl);
        if (this.astroUrl !== 'http://localhost:4321') list.push('http://localhost:4321');
        if (this.astroUrl !== 'http://localhost:4322') list.push('http://localhost:4322');
        if (this.astroUrl !== 'http://localhost:3003') list.push('http://localhost:3003');
        return list;
      })();
      for (const base of candidates) {
        try {
          const data = await tryFetch(base);
          if (Array.isArray(data)) {
            this.groupedStorage.set(videoId, data);
            this.updateBadge(String(data.length || ''), tabId);
            if (this.astroUrl !== base) {
              this.astroUrl = base;
              chrome.storage.sync.set({ astroUrl: base });
            }
            return data;
          }
        } catch {}
      }
      return [];
    } catch { return []; }
  }

  // Added: background tab audio capture helpers
  async startBackgroundCapture(tabId, videoId) {
    try {
      if (!tabId || !videoId) return;
      if (this.bgRecorders.has(videoId)) return;
      console.log('🎧 Starting background tabCapture', { tabId, videoId });
      const stream = await chrome.tabCapture.capture({ audio: true, video: false, consumerTabId: tabId });
      if (!stream) throw new Error('tabCapture returned null');
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      let chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => { try { await this.uploadChunk(chunks.splice(0), videoId, tabId); } catch {} };
      recorder.start();
      const timer = setInterval(() => {
        try {
          if (recorder.state === 'recording') {
            recorder.stop();
            setTimeout(() => { try { if (recorder.state !== 'recording') recorder.start(); } catch {} }, 120);
          }
        } catch {}
      }, 10000);
      this.bgRecorders.set(videoId, { recorder, stream, tabId, timer });
    } catch (e) {
      console.warn('tabCapture start failed', e?.message || e);
    }
  }

  stopBackgroundCapture(videoId) {
    const st = this.bgRecorders.get(videoId);
    if (!st) return;
    try { clearInterval(st.timer); } catch {}
    try { if (st.recorder && st.recorder.state !== 'inactive') st.recorder.stop(); } catch {}
    try { if (st.stream) st.stream.getTracks().forEach(t => t.stop()); } catch {}
    this.bgRecorders.delete(videoId);
    console.log('🛑 Stopped background tabCapture', videoId);
  }

  async uploadChunk(blobParts, videoId, tabId) {
    try {
      if (!blobParts || !blobParts.length) return;
      const blob = new Blob(blobParts, { type: 'audio/webm' });
      if (blob.size < 1000) return;
      let timeSec = 0;
      try {
        const resp = await chrome.tabs.sendMessage(tabId, { type: 'GET_TIME' });
        if (Number.isFinite(resp?.timeSec)) timeSec = resp.timeSec;
      } catch {}
      const form = new FormData();
      form.append('audio', blob, 'chunk.webm');
      form.append('videoId', videoId);
      form.append('videoTimeSec', String(timeSec));
      form.append('url', `https://www.youtube.com/watch?v=${videoId}`);
      let res = null;
      try {
        res = await fetch('http://localhost:3001/api/live/chunk', { method: 'POST', body: form });
      } catch {}
      if (!res || !res.ok) {
        try {
          res = await fetch('http://localhost:3001/api/transcribe/audio', { method: 'POST', body: form });
        } catch {}
      }
      if (!res || !res.ok) return;
      const result = await res.json();
      if (result?.success && Array.isArray(result.alerts) && result.alerts.length) {
        console.log('📬 Live alerts received in background:', result.alerts.length);
        this.handleAlertsDetected({ alerts: result.alerts, transcript: result.transcript, videoId, timestamp: Date.now() }, { id: tabId, url: `https://www.youtube.com/watch?v=${videoId}` });
      }
    } catch (e) {
      console.warn('uploadChunk failed', e?.message || e);
    }
  }

  async handleAdBlockerDetection(message, tab) {
    console.log('🛡️ Ad blocker detected on tab:', tab?.id);
    
    // Detect browser type
    const userAgent = message.userAgent || '';
    let browserType = 'Chrome';
    
    if (userAgent.includes('Arc')) {
      browserType = 'Arc';
    } else if (userAgent.includes('Edge')) {
      browserType = 'Edge';
    } else if (userAgent.includes('Brave')) {
      browserType = 'Brave';
    }

    // Show browser-specific notification
    const notificationId = `adblock_${Date.now()}`;
    
    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: `🛡️ ${browserType} Ad Blocker Detected`,
      message: `Lumos API calls are being blocked. Click for setup instructions specific to ${browserType}.`,
      priority: 2
    });

    // Store instructions data
    chrome.storage.local.set({
      [notificationId]: {
        browserType,
        tabId: tab?.id,
        url: tab?.url,
        type: 'ad_blocker_setup'
      }
    });
  }
}

// Initialize
new LumosBackground();
