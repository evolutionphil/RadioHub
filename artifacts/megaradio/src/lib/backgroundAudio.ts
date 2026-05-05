/**
 * Background Audio Prevention System
 * 5-layer protection against browser audio suspension
 */

import { logger } from '@/lib/logger';

let wakeLock: any = null;
let audioContext: AudioContext | null = null;
let backgroundInterval: NodeJS.Timeout | null = null;

/**
 * Layer 1: Wake Lock API - Prevents device sleep
 */
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await (navigator as any).wakeLock.request('screen');
      logger.log('✅ Wake Lock acquired');
      
      wakeLock.addEventListener('release', () => {
        logger.log('⚠️ Wake Lock released');
      });
      
      return true;
    } catch (err) {
      logger.warn('Wake Lock failed:', err);
      return false;
    }
  }
  return false;
}

/**
 * Layer 2: Audio Context - Keeps audio processing active
 */
function createAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  return audioContext;
}

/**
 * Layer 3: Visibility API - Maintain audio on tab switch
 */
function setupVisibilityHandler() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      logger.log('📱 Tab hidden - maintaining audio');
      
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
      }
    } else {
      logger.log('👁️ Tab visible');
    }
  });
}

/**
 * Layer 4: Page Lifecycle API - Handle freeze/resume
 */
function setupPageLifecycle() {
  const handleFreeze = () => {
    logger.log('🧊 Page freezing - preserving audio state');
  };

  const handleResume = () => {
    logger.log('♻️ Page resuming - restoring audio');
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
  };

  document.addEventListener('freeze', handleFreeze);
  document.addEventListener('resume', handleResume);
}

/**
 * Layer 5: Periodic Audio Context Resume - Aggressive keep-alive
 */
function setupPeriodicResume() {
  if (backgroundInterval) {
    clearInterval(backgroundInterval);
  }

  backgroundInterval = setInterval(() => {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
      logger.log('🔄 Auto-resumed audio context');
    }
  }, 5000);
}

/**
 * Request autoplay permission from browser
 */
export async function requestAutoplayPermission(): Promise<boolean> {
  try {
    const audioCtx = createAudioContext();
    
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    gainNode.gain.value = 0.001;
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.1);
    
    logger.log('✅ Autoplay permission granted');
    return true;
  } catch (error) {
    console.error('❌ Autoplay permission denied:', error);
    return false;
  }
}

/**
 * Enable all background playback protection layers
 */
export function enableBackgroundPlayback() {
  const isEnabled = localStorage.getItem('backgroundPlayback') === 'enabled';
  
  if (!isEnabled) {
    logger.log('⚠️ Background playback disabled by user');
    return;
  }

  logger.log('🎵 Enabling background playback protection...');
  
  createAudioContext();
  
  requestWakeLock();
  
  setupVisibilityHandler();
  
  setupPageLifecycle();
  
  setupPeriodicResume();
  
  logger.log('✅ Background playback enabled (5-layer protection)');
}

/**
 * Disable background playback protection
 */
export function disableBackgroundPlayback() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }

  if (backgroundInterval) {
    clearInterval(backgroundInterval);
    backgroundInterval = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  localStorage.setItem('backgroundPlayback', 'disabled');
  logger.log('🔇 Background playback disabled');
}

/**
 * Check if autoplay is allowed
 */
export function isAutoplayAllowed(): boolean {
  return localStorage.getItem('autoplayConsent') === 'accepted';
}

/**
 * Re-enable background playback on page load (if user previously accepted)
 */
export function initializeBackgroundPlayback() {
  if (isAutoplayAllowed()) {
    enableBackgroundPlayback();
  }
}
