/**
 * Content Script - Detect m3u8/mpd URLs trên trang web
 * Tương thích với Firefox và Chrome/Edge
 */

// Polyfill cho chrome/browser API
const browserAPI = typeof browser !== "undefined" ? browser : chrome;

// URLs đã phát hiện
const detectedUrls = new Set();

// Patterns để detect stream URLs
const STREAM_PATTERNS = [
  /\.m3u8(\?.*)?$/i,
  /\.mpd(\?.*)?$/i,
  /\.m3u(\?.*)?$/i,
  /\/manifest\.(m3u8|mpd)/i,
  /\/playlist\.(m3u8|mpd)/i,
  /\/index\.(m3u8|mpd)/i,
  /\/master\.(m3u8|mpd)/i,
  /\/stream\.(m3u8|mpd)/i,
  /\/video\.(m3u8|mpd)/i,
  /\/live\.(m3u8|mpd)/i,
  /\/chunklist/i,
  /\/mystream/i,
  /m3u8/i,
  /playlist/i,
  /manifest/i,
];

// MIME types for HLS/DASH
const HLS_MIME_TYPES = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegURL",
];
const DASH_MIME_TYPES = ["application/dash+xml"];

// Global regex to search within text content
// Handles escaped slashes \/ and common stream extensions/keywords
const GLOBAL_STREAM_REGEX =
  /https?(?::|\\:)(?:\/\/|\\\/\\\/)[^\s"'<>]+?\.(?:m3u8|mpd|m3u)(?:[^\s"'<>]*)/gi;

// Unescape helper for JS/JSON strings
function unescapeUrl(url) {
  if (!url) return url;
  return url.replace(/\\/g, "");
}

// Debounce helper
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Gửi URL về background script
function sendUrlToBackground(url, type, source) {
  if (detectedUrls.has(url)) return;

  // Lọc nâng cao cho YouTube: Chỉ cho phép type YOUTUBE trên trang youtube.com
  const isYouTubePage = window.location.hostname.includes("youtube.com");
  if (isYouTubePage && type !== "YOUTUBE") {
    // Bỏ qua các luồng HLS/DASH/JSON kỹ thuật của YouTube player
    return;
  }

  detectedUrls.add(url);

  browserAPI.runtime
    .sendMessage({
      action: "STREAM_DETECTED",
      data: {
        url,
        type,
        source,
        timestamp: Date.now(),
        pageTitle: document.title,
        pageUrl: window.location.href,
      },
    })
    .catch((err) => console.log("Error sending message:", err));
}

/**
 * Recursive helper to find stream URLs nested within other strings (e.g. encoded in query params)
 */
function extractAndSendNestedUrls(text, source) {
  if (!text || typeof text !== "string") return;

  // 1. Try to unescape/decode first
  const decoded = decodeURIComponent(text.replace(/\\/g, ""));

  // 2. Scan for URLs using the global regex
  const matches = decoded.match(GLOBAL_STREAM_REGEX);
  if (matches) {
    matches.forEach((url) => {
      if (isStreamUrl(url)) {
        sendUrlToBackground(url, getTypeFromUrl(url), source + "-nested");
      }
    });
  }

  // 3. Deep check query parameters if it looks like a URL
  if (text.includes("://") || text.includes("?url=")) {
    try {
      const urlObj = new URL(
        text.startsWith("http") ? text : "http://dummy.com/" + text,
      );
      urlObj.searchParams.forEach((value) => {
        if (value && value.length > 10) {
          if (isStreamUrl(value)) {
            sendUrlToBackground(
              value,
              getTypeFromUrl(value),
              source + "-param",
            );
          } else {
            // Recurse for nested encoded params
            extractAndSendNestedUrls(value, source + "-inner");
          }
        }
      });
    } catch (e) {}
  }
}

// Detect từ network requests (qua injected script)
function injectNetworkObserver() {
  const script = document.createElement("script");

  script.src = browserAPI.runtime.getURL("src/content/injected.js");

  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  // Lắng nghe sự kiện từ injected script
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    
    // Xử lý stream detected
    if (event.data.type === "STREAM_URL_DETECTED") {
      const { url, type } = event.data;
      sendUrlToBackground(url, type, "network");
    }

    // Xử lý SPA route changes
    if (event.data.type === "LOCATION_CHANGE") {
      console.log("[Stream Downloader] SPA Navigation Detected via postMessage, Re-running checks");
      // Clear detected for the new page to avoid staying on the old one
      detectedUrls.clear();
      setTimeout(() => {
        detectVideoElements();
        detectFromDOM();
      }, 1000);
    }
  });
}

// Detect từ video elements
function detectVideoElements() {
  const videos = document.querySelectorAll("video");
  videos.forEach((video) => {
    const src = video.src || video.currentSrc;
    const typeAttr = video.getAttribute("type");

    if (src) {
      if (isStreamUrl(src)) {
        const type = getTypeFromUrl(src);
        sendUrlToBackground(src, type, "video-element");
      } else if (typeAttr) {
        // Check MIME type if extension doesn't match
        if (HLS_MIME_TYPES.includes(typeAttr)) {
          sendUrlToBackground(src, "HLS", "video-element-mime");
        } else if (DASH_MIME_TYPES.includes(typeAttr)) {
          sendUrlToBackground(src, "DASH", "video-element-mime");
        } else {
          // Fallback for other video types
          sendUrlToBackground(src, "VIDEO", "video-element-type");
        }
      } else if (src.startsWith("http")) {
        // Fallback for video src without extension or type
        // If it's a long URL or contains slash patterns often used for streams
        sendUrlToBackground(src, "UNKNOWN", "video-element-fallback");
      }
    }

    // Detect source elements
    video.querySelectorAll("source").forEach((source) => {
      const src =
        source.src ||
        source.getAttribute("data-src") ||
        source.getAttribute("data-main");
      const typeAttr = source.getAttribute("type");
      if (src) {
        if (isStreamUrl(src)) {
          const type = getTypeFromUrl(src);
          sendUrlToBackground(src, type, "video-source");
        } else if (typeAttr) {
          if (HLS_MIME_TYPES.includes(typeAttr)) {
            sendUrlToBackground(src, "HLS", "video-source-mime");
          } else if (DASH_MIME_TYPES.includes(typeAttr)) {
            sendUrlToBackground(src, "DASH", "video-source-mime");
          }
        }
      }
    });

    // Check data attributes on video element itself
    const dataSrc =
      video.getAttribute("data-src") || video.getAttribute("data-main");
    if (dataSrc && isStreamUrl(dataSrc)) {
      sendUrlToBackground(dataSrc, getTypeFromUrl(dataSrc), "video-data-src");
    }
  });
}

// Detect từ JavaScript
function detectFromJavaScript() {
  // Override XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    this._url = url;
    return originalXHROpen.apply(this, [method, url, ...args]);
  };

  XMLHttpRequest.prototype.send = function () {
    const url = this._url;
    if (url && typeof url === "string" && isStreamUrl(url)) {
      const type = getTypeFromUrl(url);
      sendUrlToBackground(url, type, "xhr");
    }
    return originalXHRSend.apply(this, arguments);
  };

  // Override fetch
  const originalFetch = window.fetch;
  window.fetch = function (input, ...args) {
    const url = typeof input === "string" ? input : input?.url;

    if (url && typeof url === "string" && isStreamUrl(url)) {
      const type = getTypeFromUrl(url);
      sendUrlToBackground(url, type, "fetch");
    }

    return originalFetch.apply(this, [input, ...args]);
  };
}

// Kiểm tra URL có phải stream URL không
function isStreamUrl(url) {
  if (!url || typeof url !== "string") return false;

  // Case-insensitive check
  const lowerUrl = url.toLowerCase();

  // Check for common extensions and keywords (including encoded forms)
  return (
    lowerUrl.includes(".m3u8") ||
    lowerUrl.includes(".mpd") ||
    lowerUrl.includes(".m3u") ||
    lowerUrl.includes("%2em3u8") || // Encoded .m3u8
    lowerUrl.includes("m3u8") ||
    lowerUrl.includes("playlist") ||
    lowerUrl.includes("manifest") ||
    lowerUrl.includes("youtu.be") ||
    lowerUrl.includes("youtube.com/watch") ||
    new RegExp(GLOBAL_STREAM_REGEX.source, "i").test(url)
  );
}

// Lấy loại stream từ URL
function getTypeFromUrl(url) {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes("youtu.be") || lowerUrl.includes("youtube.com/watch")) return "YOUTUBE";
  if (lowerUrl.includes(".mpd") || lowerUrl.includes("%2empd")) return "DASH";
  if (lowerUrl.includes(".m3u8") || lowerUrl.includes("%2em3u8")) return "HLS";
  if (lowerUrl.includes(".m3u") || lowerUrl.includes("%2em3u")) return "M3U";

  // High confidence fallback
  if (lowerUrl.includes("m3u8")) return "HLS";
  if (lowerUrl.includes("mpd")) return "DASH";

  return "UNKNOWN";
}

// Detect từ DOM
function detectFromDOM() {
  // Tìm trong các thẻ script
  document.querySelectorAll("script").forEach((script) => {
    const content = script.textContent || script.innerText;
    if (content) {
      // 1. Tìm qua Regex URL (standard & escaped)
      const matches = content.match(GLOBAL_STREAM_REGEX);
      if (matches) {
        matches.forEach((matchedUrl) => {
          try {
            const url = unescapeUrl(matchedUrl);
            const resolved = new URL(url, window.location.href).href;

            // Send the main resolved URL
            sendUrlToBackground(
              resolved,
              getTypeFromUrl(resolved),
              "script-content",
            );

            // Also check for nested URLs in query params (for proxy URLs)
            extractAndSendNestedUrls(resolved, "script-nested");
          } catch (e) {}
        });
      }

      // 2. Tìm qua cấu hình player (Aliplayer, v.v.)
      // Case: source: "https://.../..." hoặc url: "https://..."
      const playerRegex =
        /["'](?:source|url|file|playlist)["']\s*:\s*["']([^"']+)["']/gi;
      let playerMatch;
      while ((playerMatch = playerRegex.exec(content)) !== null) {
        const url = unescapeUrl(playerMatch[1]);
        if (
          url.includes("://") &&
          (isStreamUrl(url) || content.includes("Player"))
        ) {
          sendUrlToBackground(url, getTypeFromUrl(url), "player-config");
        }
      }
    }
  });

  // Tìm trong iframe src và các tham số của nó
  document.querySelectorAll("iframe").forEach((iframe) => {
    const src = iframe.src || iframe.getAttribute("data-src");
    if (!src) return;

    // Send main URL if it's a stream
    if (isStreamUrl(src)) {
      sendUrlToBackground(src, getTypeFromUrl(src), "iframe-src");
    }

    // Always check for nested URLs
    extractAndSendNestedUrls(src, "iframe");
  });

  // Tìm trong các thẻ link
  document.querySelectorAll('link[rel="alternate"]').forEach((link) => {
    const href = link.href;
    const type = link.getAttribute("type");
    if (href) {
      if (isStreamUrl(href)) {
        sendUrlToBackground(href, getTypeFromUrl(href), "link-tag");
      } else if (type && HLS_MIME_TYPES.includes(type)) {
        sendUrlToBackground(href, "HLS", "link-tag-mime");
      }
    }
  });

  // Tìm trong YouTube share inputs (hỗ trợ cả link gốc và link redirect qua pie.yt)
  document.querySelectorAll('input').forEach((input) => {
    const val = input.value;
    if (val && typeof val === 'string' && (val.includes('youtu.be') || val.includes('youtube.com/watch'))) {
      // Dùng regex để trích xuất đúng URL youtube trong trường hợp nó bị lồng ghép
      const match = val.match(/(https?:\/\/(?:www\.)?(?:youtu\.be\/|youtube\.com\/watch\?v=)[^\s&?]+)/i);
      if (match) {
        sendUrlToBackground(match[1], "YOUTUBE", "youtube-share");
      } else if (isStreamUrl(val)) {
        sendUrlToBackground(val, "YOUTUBE", "youtube-share-fallback");
      }
    }
  });
}

// Khởi chạy detection
function runDetection() {
  injectNetworkObserver();

  // Run initial detection
  detectVideoElements();
  detectFromDOM();

  // Debounced continuous detection
  const continuousDetection = debounce(() => {
    detectVideoElements();
    detectFromDOM();
  }, 1500);

  // Setup MutationObserver for real-time DOM changes
  const observer = new MutationObserver((mutations) => {
    let shouldCheck = false;
    for (const mutation of mutations) {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        // Only trigger if added node is or contains relevant tags
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (node.nodeType === 1) { // ELEMENT_NODE
            const tag = node.tagName;
            if (tag === 'VIDEO' || tag === 'IFRAME' || tag === 'SCRIPT' || tag === 'LINK' || tag === 'SOURCE' || tag === 'INPUT') {
              shouldCheck = true; break;
            }
            if (node.querySelector && node.querySelector('video, iframe, script, link, source, input')) {
              shouldCheck = true; break;
            }
          }
        }
      }
      if (shouldCheck) break;
      
      if (mutation.type === "attributes") {
        const target = mutation.target;
        if (
          target.tagName === "VIDEO" ||
          target.tagName === "SOURCE" ||
          target.tagName === "SCRIPT" ||
          target.tagName === "IFRAME"
        ) {
          shouldCheck = true;
          break;
        }
      }
    }

    if (shouldCheck) {
      continuousDetection();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "data-src", "href"],
  });

  // Keep a fallback periodic check (less frequent, handle SPA)
  let lastUrl = window.location.href;
  setInterval(() => {
    // Detect URL changes (fallback for SPAs)
    if (window.location.href !== lastUrl) {
      console.log("[Stream Downloader] URL Change detected via interval, Re-running checks");
      lastUrl = window.location.href;
      detectedUrls.clear();
      continuousDetection();
    }
  }, 5000);
}

// Start khi DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runDetection);
} else {
  runDetection();
}

// Listen for messages from popup
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "GET_DETECTED_URLS") {
    sendResponse({ urls: Array.from(detectedUrls) });
  }
  if (message.action === "CLEAR_DETECTED_URLS") {
    detectedUrls.clear();
    sendResponse({ success: true });
  }
  return true;
});

console.log("[Stream Downloader] Content script loaded");
