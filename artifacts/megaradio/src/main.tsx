import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { measureCoreWebVitals } from "./utils/performance";
import { initImageOptimizations } from "./utils/image-optimization";
import { initAsyncStyles, loadWebFonts, addResourceHints } from './utils/async-css-loader';
import { initOAuthTokenExchange } from './lib/oauth-token-exchange';

// CRITICAL: must run BEFORE App renders so the /api/auth/me query cache is
// pre-seeded (with either {_pendingTokenExchange:true} placeholder OR the
// hydrated user) before any component subscribes to it. Otherwise the first
// /me fetch would race with the token-session POST.
initOAuthTokenExchange();

const VITE_API_BASE = import.meta.env.VITE_API_BASE_URL || '';
if (VITE_API_BASE) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let rewritten = false;
    if (typeof input === 'string' && input.startsWith('/api')) {
      input = `${VITE_API_BASE}${input}`;
      rewritten = true;
    } else if (input instanceof Request && input.url.startsWith(window.location.origin + '/api')) {
      const newUrl = input.url.replace(window.location.origin, VITE_API_BASE);
      input = new Request(newUrl, input);
      rewritten = true;
    }
    if (rewritten) {
      init = { ...init, credentials: 'include' };
    }
    return originalFetch(input, init);
  };
}

// Initialize performance monitoring and optimizations
if (typeof window !== 'undefined') {
  const isDev = import.meta.env.DEV;
  const isProduction = import.meta.env.PROD;
  
  // Suppress console errors in production
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  console.error = (...args) => {
    // Suppress all errors in production
    if (isProduction) return;
    
    // In dev, suppress Vite HMR WebSocket errors only
    if (isDev) {
      const message = args[0]?.toString?.() || '';
      const errorDetails = JSON.stringify(args).toLowerCase();
      if (message.includes('WebSocket connection') || 
          message.includes('localhost:undefined') ||
          message.includes('Failed to construct \'WebSocket\'') ||
          errorDetails.includes('websocket') ||
          errorDetails.includes('wss://localhost:undefined')) {
        return;
      }
      originalConsoleError.apply(console, args);
    }
  };
  
  // Suppress React warnings in production
  console.warn = (...args) => {
    if (isProduction) return;
    originalConsoleWarn.apply(console, args);
  };

  // Handle unhandled promise rejections from Vite HMR to prevent app crashes
  window.addEventListener('unhandledrejection', (event) => {
    if (isDev) {
      const reason = event.reason?.message?.toLowerCase?.() || event.reason?.toString?.().toLowerCase?.() || '';
      const reasonStr = JSON.stringify(event.reason).toLowerCase();
      if (reason.includes('websocket') || 
          reason.includes('localhost:undefined') ||
          reasonStr.includes('websocket') ||
          reasonStr.includes('wss://localhost:undefined') ||
          reasonStr.includes('failed to construct')) {
        event.preventDefault(); // Prevent Vite HMR errors from breaking the app
      }
    }
  });

  // 🚀 Font optimization: CRITICAL - Fonts are loaded in index.html with display=swap
  // Preconnects are already in index.html, no need to duplicate here
  // Removed redundant fontLink creation - index.html + index.css handle font loading

  // Critical performance monitoring only
  measureCoreWebVitals();
  
  // 🚀 PWA Service Worker registration for offline support and caching
  if ('serviceWorker' in navigator) {
    // 2026-05-12 fix: was registering '/service-worker.js' which does NOT
    // exist in public/ — only '/sw.js' does (also registered by
    // PushNotificationManager). The mismatch meant users who never opened
    // notification settings never had an active SW controller, so the
    // KEEP_ALIVE pathway in useGlobalPlayer.tsx silently no-op'd and iOS
    // Safari background audio could be killed by the OS. Standardising on
    // '/sw.js' here makes registration deterministic on first load.
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service worker registration failed - app still works without it
    });
  }
  
  // Defer non-critical optimizations to idle time for better TBT and Main Thread performance
  const deferToIdle = (callback: () => void, timeout: number = 3000) => {
    if ('requestIdleCallback' in window) {
      // Use timeout to ensure callback runs even if browser is busy
      requestIdleCallback(callback, { timeout });
    } else {
      // Fallback: defer with short delay to avoid blocking
      setTimeout(callback, 100);
    }
  };
  
  // Defer all non-critical initialization to idle callback
  // This keeps Main Thread free for critical rendering tasks
  deferToIdle(() => {
    initImageOptimizations();
    initAsyncStyles(); // Async CSS loading for better performance
    loadWebFonts();
    addResourceHints();
  }, 3000);
}

createRoot(document.getElementById("root")!).render(<App />);
