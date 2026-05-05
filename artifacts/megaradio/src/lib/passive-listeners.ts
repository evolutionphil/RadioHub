export function addPassiveEventListener(
  target: EventTarget,
  event: string,
  handler: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions
) {
  const passiveSupported = supportsPassiveEvents();
  const optionsOrCapture = passiveSupported
    ? { ...((typeof options === 'object' ? options : { capture: options }) || {}), passive: true }
    : (typeof options === 'object' ? options?.capture : options) || false;
  
  target.addEventListener(event, handler, optionsOrCapture);
  
  return () => target.removeEventListener(event, handler, optionsOrCapture);
}

let passiveSupported: boolean | undefined;

function supportsPassiveEvents(): boolean {
  if (passiveSupported !== undefined) {
    return passiveSupported;
  }
  
  passiveSupported = false;
  try {
    const opts = Object.defineProperty({}, 'passive', {
      get() {
        passiveSupported = true;
        return true;
      },
    });
    window.addEventListener('test', null as any, opts);
    window.removeEventListener('test', null as any, opts);
  } catch (e) {
    passiveSupported = false;
  }
  
  return passiveSupported;
}

export function optimizeScrollListener(
  element: HTMLElement | Window,
  handler: (event: Event) => void
) {
  return addPassiveEventListener(element, 'scroll', handler, { passive: true });
}

export function optimizeTouchListener(
  element: HTMLElement,
  event: 'touchstart' | 'touchmove' | 'touchend',
  handler: (event: TouchEvent) => void
) {
  return addPassiveEventListener(element, event, handler as EventListener, { passive: true });
}
