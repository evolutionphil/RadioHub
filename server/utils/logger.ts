/**
 * Logger utility - Now enabled in all environments
 * User requested production logging for debugging
 */

export const logger = {
  log: (...args: any[]) => {
    console.log(...args);
  },
  error: (...args: any[]) => {
    console.error(...args);
  },
  warn: (...args: any[]) => {
    console.warn(...args);
  },
  info: (...args: any[]) => {
    console.info(...args);
  },
  debug: (...args: any[]) => {
    console.debug(...args);
  }
};
