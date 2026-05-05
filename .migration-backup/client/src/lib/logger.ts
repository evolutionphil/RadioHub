const isProduction = typeof window !== 'undefined' && window.location.hostname !== 'localhost' && !window.location.hostname.includes('.replit.');

const noop = (..._args: any[]) => {};

export const logger = {
  log: isProduction ? noop : (...args: any[]) => console.log(...args),
  error: (...args: any[]) => console.error(...args),
  warn: isProduction ? noop : (...args: any[]) => console.warn(...args),
  info: isProduction ? noop : (...args: any[]) => console.info(...args),
  debug: isProduction ? noop : (...args: any[]) => console.debug(...args),
};
