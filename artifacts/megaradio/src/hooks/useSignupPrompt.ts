import { useCallback, useEffect, useRef, useState } from 'react';

export const SIGNUP_PROMPT_STORAGE_KEY = 'megaradio:signup-prompt:next-eligible-at:v1';
export const SIGNUP_PROMPT_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const SIGNUP_PROMPT_SNOOZE_MS = 7 * SIGNUP_PROMPT_INTERVAL_MS;
export const SIGNUP_BANNER_DELAY_MS = 60 * 1000;
export const SIGNUP_MODAL_DELAY_MS = 2 * 60 * 1000;
const PREFERENCE_EVENT = 'megaradio:signup-prompt-preference';

// Remounts must respect Later even when private-mode storage is unavailable.
let memoryNextEligibleAt = 0;

function nextEligibleAt(): number {
  try {
    const stored = Number(window.localStorage.getItem(SIGNUP_PROMPT_STORAGE_KEY));
    return Math.max(memoryNextEligibleAt, Number.isFinite(stored) && stored > 0 ? stored : 0);
  } catch {
    return memoryNextEligibleAt;
  }
}

function suppressUntil(until: number, owner: symbol) {
  const next = Math.max(nextEligibleAt(), until);
  memoryNextEligibleAt = next;
  try {
    window.localStorage.setItem(SIGNUP_PROMPT_STORAGE_KEY, String(next));
  } catch {
    // The in-memory cooldown above also covers read-only/blocked storage.
  }
  // The native storage event covers other tabs; this covers other mounted players.
  window.dispatchEvent(new CustomEvent(PREFERENCE_EVENT, { detail: owner }));
}

interface SignupPromptOptions {
  eligible: boolean;
  delayMs: number;
}

export function useSignupPrompt({ eligible, delayMs }: SignupPromptOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [preferenceVersion, setPreferenceVersion] = useState(0);
  const owner = useRef(Symbol('signup-prompt'));

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === 'visible');
    const onPreference = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === owner.current) return;
      if (event instanceof StorageEvent && event.key !== null && event.key !== SIGNUP_PROMPT_STORAGE_KEY) return;
      setIsOpen(false);
      setPreferenceVersion(version => version + 1);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('storage', onPreference);
    window.addEventListener(PREFERENCE_EVENT, onPreference);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('storage', onPreference);
      window.removeEventListener(PREFERENCE_EVENT, onPreference);
    };
  }, []);

  useEffect(() => {
    setIsOpen(false);
    if (!eligible || !visible || Date.now() < nextEligibleAt()) return;

    const timer = window.setTimeout(() => {
      // Recheck at delivery: another tab may have shown/dismissed an invitation.
      if (document.visibilityState !== 'visible' || Date.now() < nextEligibleAt()) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      if (document.activeElement?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      suppressUntil(Date.now() + SIGNUP_PROMPT_INTERVAL_MS, owner.current);
      setIsOpen(true);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [eligible, visible, delayMs, preferenceVersion]);

  const dismiss = useCallback(() => {
    suppressUntil(Date.now() + SIGNUP_PROMPT_SNOOZE_MS, owner.current);
    setIsOpen(false);
  }, []);

  return { isOpen: isOpen && eligible && visible, dismiss };
}
