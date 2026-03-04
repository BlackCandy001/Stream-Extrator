/**
 * Background Script - Xử lý logic chính của extension
 * Tương thích với Firefox (Manifest V2) và Chrome/Edge
 */

// Polyfill cho chrome/browser API
const browserAPI = typeof browser !== "undefined" ? browser : chrome;

// Lưu trữ URLs đã detect
let detectedStreams = [];
let appConnected = false;
let appUrl = "127.0.0.1:34567"; // Default URL (Electron app local server)

// Initialize
browserAPI.runtime.onInstalled.addListener(() => {
  console.log("[Stream Downloader] Extension installed");

  // Clear storage
  browserAPI.storage.local.set({
    streams: [],
    appConnected: false,
    settings: {
      autoSend: false,
      notifications: true,
      serverUrl: "127.0.0.1:34567",
    },
  });

  // Create context menu
  browserAPI.contextMenus.create({
    id: "sendToApp",
    title: "Gửi URL này đến Stream Downloader",
    contexts: ["link", "video", "audio"],
  });

  // Enable side panel on click for Chrome (Manifest V3)
  if (browserAPI.sidePanel && browserAPI.sidePanel.setPanelBehavior) {
    browserAPI.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => console.error(error));
  }
});

// Load settings (including server URL)
browserAPI.storage.local
  .get(["settings"])
  .then((result) => {
    if (result.settings && result.settings.serverUrl) {
      appUrl = result.settings.serverUrl;
    }
    console.log("[Stream Downloader] App URL:", appUrl);
  })
  .catch((err) => console.error("Error loading settings:", err));

// Load streams từ storage
browserAPI.storage.local
  .get(["streams"])
  .then((result) => {
    if (result.streams) {
      detectedStreams = result.streams;
    }
  })
  .catch((err) => console.error("Error loading streams:", err));

// Listen messages từ content script
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "STREAM_DETECTED") {
    handleStreamDetected(message.data, sender);
    sendResponse({ success: true });
  }

  if (message.action === "GET_STREAMS") {
    sendResponse({ streams: detectedStreams });
  }

  if (message.action === "CLEAR_STREAMS") {
    detectedStreams = [];
    browserAPI.storage.local.set({ streams: [] });
    sendResponse({ success: true });
  }

  if (message.action === "SEND_TO_APP") {
    sendToApp(message.data, message.autoDownload)
      .then(() => sendResponse({ success: true }))
      .catch(() =>
        sendResponse({ success: false, error: "Không thể kết nối app" }),
      );
  }

  if (message.action === "CHECK_APP_CONNECTION") {
    // Update appUrl if provided from sidebar
    if (message.url) {
      appUrl = message.url;
    }
    checkAppConnection().then((connected) => {
      appConnected = connected;
      browserAPI.storage.local.set({ appConnected: connected });
      sendResponse({ connected, url: appUrl });
    });
  }

  // Update server URL
  if (message.action === "UPDATE_SERVER_URL") {
    appUrl = message.url;
    browserAPI.storage.local.get(["settings"]).then((result) => {
      const settings = result.settings || {};
      settings.serverUrl = appUrl;
      browserAPI.storage.local.set({ settings });
    });
    sendResponse({ success: true, url: appUrl });
  }

  return true;
});

// Xử lý stream được detect
async function handleStreamDetected(data, sender) {
  console.log("[Stream Downloader] Stream detected:", {
    url: data.url.substring(0, 80) + (data.url.length > 80 ? "..." : ""),
    type: data.type,
    source: data.source,
  });

  // Check duplicate (including YouTube video ID deduplication)
  const exists = detectedStreams.some((s) => {
    if (s.url === data.url) return true;
    
    // Deduplicate YouTube videos
    if (s.type === "YOUTUBE" && data.type === "YOUTUBE") {
      const getYouTubeId = (url) => {
        const match = url.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=)([^&?]+)/i);
        return match ? match[1] : url;
      };
      if (getYouTubeId(s.url) === getYouTubeId(data.url)) return true;
    }
    return false;
  });
  
  if (exists) {
    console.log(
      "[Stream Downloader] Duplicate URL or Video, skipping:",
      data.url.substring(0, 50),
    );
    return;
  }

  // Add to list
  const streamData = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    ...data,
    tabId: sender.tab?.id,
    tabTitle: sender.tab?.title,
    tabUrl: sender.tab?.url,
  };

  detectedStreams.unshift(streamData);

  // Keep only last 100
  if (detectedStreams.length > 100) {
    detectedStreams = detectedStreams.slice(0, 100);
  }

  // Save to storage
  await browserAPI.storage.local.set({ streams: detectedStreams });
  console.log(
    "[Stream Downloader] Saved to storage. Total streams:",
    detectedStreams.length,
  );

  // Broadcast to sidebar
  try {
    await browserAPI.runtime.sendMessage({
      action: "STREAMS_UPDATED",
      count: detectedStreams.length,
    });
  } catch (e) {
    // Sidebar might not be open, ignore error
  }

  // Send notification
  const settings = await browserAPI.storage.local.get(["settings"]);
  if (settings.settings?.notifications) {
    browserAPI.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-48.png",
      title: "Phát hiện stream",
      message: `Đã tìm thấy ${data.type} stream: ${data.pageTitle?.substring(0, 50) || "Unknown"}`,
      contextMessage: data.url.substring(0, 100),
    });
  }

  // Auto-send nếu được bật VÀ app đang connected
  if (settings.settings?.autoSend && appConnected) {
    console.log("[Stream Downloader] Auto-sending stream to app...");
    await sendToApp(data, settings.settings?.autoDownload);
  } else if (settings.settings?.autoSend && !appConnected) {
    console.log(
      "[Stream Downloader] Auto-send enabled but app not connected. Stream saved for later.",
    );
  }

  // Update badge
  updateBadge();
  console.log(
    "[Stream Downloader] Badge updated. Count:",
    detectedStreams.length,
  );
}

// Gửi URL đến app
async function sendToApp(data, autoDownload = false) {
  const url = `http://${appUrl}/api/stream`;
  console.log("[Stream Downloader] Sending to app:", url);
  console.log("[Stream Downloader] Current appUrl:", appUrl);
  console.log("[Stream Downloader] Stream URL:", data.url.substring(0, 80));

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_stream",
        data: {
          url: data.url,
          type: data.type,
          title: data.pageTitle,
          source: data.pageUrl,
          timestamp: Date.now(),
        },
        autoDownload: autoDownload,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const status = response.status;
      console.error(
        "[Stream Downloader] HTTP Error:",
        status,
        response.statusText,
      );
      throw new Error(`HTTP ${status}: ${response.statusText}`);
    }

    const result = await response.json();

    // Log only in console, no notification for every successful send
    if (result.success) {
      console.log("[Stream Downloader] Sent successfully!");
    } else {
      console.error("[Stream Downloader] App returned error:", result.error);
    }

    return result;
  } catch (error) {
    console.error("[Stream Downloader] Error sending to app:", error.message);
    console.log("[Stream Downloader] Please check:");
    console.log("  1. Desktop app is running");
    console.log("  2. Local server is started on port 34567");
    console.log("  3. Server URL in settings is correct");
    console.log(
      "[Stream Downloader] Stream saved locally, will send when app is available",
    );
    throw error;
  }
}

// Kiểm tra kết nối app
async function checkAppConnection() {
  const url = `http://${appUrl}/api/health`;
  console.log("[Stream Downloader] Checking app connection:", url);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000), // Increased timeout
    });
    const connected = response.ok;
    appConnected = connected;
    console.log(
      "[Stream Downloader] App connection:",
      connected ? "Connected ✅" : "Disconnected ❌",
    );

    // Broadcast connection status to sidebar
    try {
      await browserAPI.runtime.sendMessage({
        action: "CONNECTION_CHANGED",
        connected: connected,
        url: appUrl,
      });
    } catch (e) {
      // Sidebar might not be open
    }

    return connected;
  } catch (error) {
    appConnected = false;
    console.log("[Stream Downloader] App not reachable:", error.message);

    // Broadcast disconnection
    try {
      await browserAPI.runtime.sendMessage({
        action: "CONNECTION_CHANGED",
        connected: false,
      });
    } catch (e) {}

    return false;
  }
}

// Update badge
function updateBadge() {
  const count = detectedStreams.length;
  // Handle both Manifest V2 (browserAction) and V3 (action)
  const actionApi = browserAPI.action || browserAPI.browserAction;
  if (!actionApi) return;

  if (count > 0) {
    actionApi.setBadgeText({ text: count.toString() });
    actionApi.setBadgeBackgroundColor({ color: "#ff0000" });
  } else {
    actionApi.setBadgeText({ text: "" });
  }
}

// Context menu click
browserAPI.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "sendToApp") {
    let url = info.linkUrl || info.srcUrl || info.pageUrl;

    if (url) {
      await sendToApp({
        url,
        type: url.includes(".mpd")
          ? "DASH"
          : url.includes(".m3u8")
            ? "HLS"
            : "UNKNOWN",
        pageTitle: tab?.title,
        pageUrl: tab?.url,
      });
    }
  }
});

// Alarm để check connection (every 10 seconds for more responsive status)
browserAPI.alarms.create("checkApp", { periodInMinutes: 0.166 }); // ~10 seconds
browserAPI.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "checkApp") {
    const connected = await checkAppConnection();
    appConnected = connected;
    await browserAPI.storage.local.set({ appConnected: connected });
    updateBadge();
  }
});

// Network Interception via webRequest (Manifest V3 compatible for observation)
// Bắt các stream dựa trên Content-Type header
const MIME_TYPES_TO_DETECT = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "application/dash+xml",
  "video/mp2t", // HLS segments
];

if (browserAPI.webRequest) {
  // Common stream patterns for network sniffing
  const IS_STREAM_REGEX = /\.(m3u8|mpd|m3u)(\?.*)?$/i;

  try {
    browserAPI.webRequest.onHeadersReceived.addListener(
      (details) => {
        if (details.tabId === -1) return;

        // 1. Check Content-Type
        const contentType = details.responseHeaders
          ?.find((h) => h.name.toLowerCase() === "content-type")
          ?.value?.toLowerCase();

        let type = "";
        if (contentType) {
          if (
            contentType.includes("mpegurl") ||
            contentType.includes("x-mpegurl")
          ) {
            type = "HLS";
          } else if (contentType.includes("dash+xml")) {
            type = "DASH";
          }
        }

        // 2. Check URL Pattern (fallback for generic Content-Type like octet-stream)
        if (!type) {
          if (details.url.includes(".m3u8") || details.url.includes("m3u8"))
            type = "HLS";
          else if (details.url.includes(".mpd") || details.url.includes("mpd"))
            type = "DASH";
          else if (details.url.includes(".m3u")) type = "M3U";
        }

        if (type) {
          const source = contentType ? "network-headers" : "network-url";

          // Manifest V3: Use promises for tabs.get
          browserAPI.tabs.get(details.tabId)
            .then((tab) => {
              handleStreamDetected(
                {
                  url: details.url,
                  type: type,
                  source: source,
                  pageTitle: tab?.title,
                  pageUrl: tab?.url,
                },
                { tab }
              );
            })
            .catch((err) => {
              console.log(
                "[Stream Downloader] Could not get tab info:",
                err.message
              );
              handleStreamDetected(
                {
                  url: details.url,
                  type: type,
                  source: source,
                },
                { tab: { id: details.tabId } }
              );
            });
        }
      },
      { urls: ["<all_urls>"] },
      ["responseHeaders"] // removed "blocking" if it was there (it wasn't in the code, but the manifest had it)
    );
  } catch (e) {
    console.error("Error setting up webRequest listener:", e);
  }
}

console.log("[Stream Downloader] Background script started");
