import type { KeyboardEvent, RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusFirstInside(root: HTMLElement | null): void {
  if (!root) return;
  const focusable = root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  if (focusable) {
    focusable.focus();
  } else {
    root.focus();
  }
}

export function buildDropdownKeyHandler<T extends HTMLElement>(
  rootRef: RefObject<HTMLElement | null>,
  close: () => void
) {
  return (e: KeyboardEvent<T>) => {
    if (e.key === 'Escape') {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = rootRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((el) => !el.hasAttribute('disabled'));
    if (focusables.length === 0) {
      e.preventDefault();
      root.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !root.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  };
}

