// Background service worker
class LumosBackground {
  constructor() {
    this.alertsStorage = new Map();
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
      apiUrl: 'http://localhost:4322'
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

      case 'CLEAR_ALERTS':
        this.clearAlerts(message.videoId);
        sendResponse({ success: true });
        break;

      case 'AD_BLOCKER_DETECTED':
        this.handleAdBlockerDetection(message, sender.tab);
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

    // Open our fact-check details page
    const detailsUrl = `http://localhost:4322/alerts?video_id=${data.videoId}`;
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
    } else {
      this.alertsStorage.clear();
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
