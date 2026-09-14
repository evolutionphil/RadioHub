import { useEffect, useLayoutEffect, useRef } from 'react';

interface PlaybackSpaceShortcut {
  enabled: boolean;
  isPlaying: boolean;
  pause: () => void;
  resume: () => void;
}

// Keep native keyboard activation, text entry and modal interactions intact.
const INTERACTIVE_TARGET = [
  'input', 'textarea', 'select', 'button', 'a[href]', 'label', 'summary',
  'audio[controls]', 'video[controls]', 'dialog',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]', '[role="searchbox"]', '[role="button"]', '[role="link"]',
  '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="slider"]',
  '[role="spinbutton"]', '[role="combobox"]', '[role="listbox"]', '[role="option"]',
  '[role="menu"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]', '[role="tab"]', '[role="tree"]', '[role="treeitem"]',
  '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
].join(',');

function ownsSpace(target: EventTarget | null): boolean {
  return target instanceof Element && (
    (target instanceof HTMLElement && target.isContentEditable) ||
    target.closest(INTERACTIVE_TARGET) !== null
  );
}

/** One listener in the headless player, shared by every route and player view. */
export function usePlaybackSpaceShortcut(options: PlaybackSpaceShortcut) {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });

  useEffect(() => {
    if (!options.enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ' && event.key !== 'Spacebar') return;
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
          event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.composedPath().some(ownsSpace) || ownsSpace(document.activeElement)) return;
      if (!latest.current.enabled) return;

      // Holding Space must neither repeatedly reconnect the stream nor scroll.
      event.preventDefault();
      if (event.repeat) return;
      if (latest.current.isPlaying) latest.current.pause();
      else latest.current.resume();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [options.enabled]);
}
