declare global {
  interface Window {
    FlowAliveConfig?: {
      apiKey: string;
      trackNavigation?: boolean;
      debug?: boolean;
    };
    FlowAlive?: {
      trackEvent: (params: { name: string; properties?: Record<string, any> }) => void;
      identify: (params: { userId: string; traits?: Record<string, any> }) => void;
      trackPageView: (params: { page: string; title?: string; properties?: Record<string, any> }) => void;
      startSession: () => void;
      endSession: () => void;
      setUserProperties: (properties: Record<string, any>) => void;
      trackError: (params: { error: string; stack?: string; properties?: Record<string, any> }) => void;
      reset: () => void;
    };
  }
}

function fa(fn: () => void) {
  try { fn(); } catch {}
}

export function faIdentify(userId: string, traits?: Record<string, any>) {
  fa(() => window.FlowAlive?.identify({ userId, traits }));
}

export function faReset() {
  fa(() => window.FlowAlive?.reset());
}

export function faTrackEvent(name: string, properties?: Record<string, any>) {
  fa(() => window.FlowAlive?.trackEvent({ name, properties }));
}

export function faTrackPageView(page: string, title?: string, properties?: Record<string, any>) {
  fa(() => window.FlowAlive?.trackPageView({ page, title, properties }));
}

export function faTrackError(error: string, stack?: string, properties?: Record<string, any>) {
  fa(() => window.FlowAlive?.trackError({ error, stack, properties }));
}

export function faSetUserProperties(properties: Record<string, any>) {
  fa(() => window.FlowAlive?.setUserProperties(properties));
}
