import { useLayoutEffect, useRef } from 'react';

/** The visible browser viewport, not 100vh, owns the chat composer on iOS. */
export function availableChatHeight(top: number, viewportBottom: number, playerTop?: number) {
  const bottom = playerTop !== undefined && playerTop > top
    ? Math.min(viewportBottom, playerTop) : viewportBottom;
  return Math.max(0, Math.floor(bottom - top));
}

export function useChatViewport() {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    let player: Element | null = null;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nextPlayer = document.querySelector('[data-testid="global-player-wrapper"]');
        if (nextPlayer !== player) {
          if (player) observer?.unobserve(player);
          player = nextPlayer;
          if (player) observer?.observe(player);
        }
        const viewport = window.visualViewport;
        const bottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
        const playerBounds = player?.getBoundingClientRect();
        const playerTop = playerBounds && playerBounds.height > 0 ? playerBounds.top : undefined;
        node.style.maxHeight = `${availableChatHeight(node.getBoundingClientRect().top, bottom, playerTop)}px`;
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(node.parentElement || node);
    // The player is interaction-gated and can mount after the chat has opened.
    const mutations = new MutationObserver(update);
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);

  return ref;
}
