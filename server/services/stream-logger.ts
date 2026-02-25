export class StreamLogger {
  private logs: string[] = [];
  private stationUrl: string;

  constructor(stationUrl: string) {
    this.stationUrl = stationUrl;
    this.logs = [];
  }

  log(level: 'INFO' | 'DEBUG' | 'WARN' | 'ERROR', message: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${level}: ${message}`;
    this.logs.push(logEntry);
    
    // Also log to console for debugging
    // console.log(`StreamLogger [${this.stationUrl}] ${logEntry}`);
  }

  info(message: string) {
    this.log('INFO', message);
  }

  debug(message: string) {
    this.log('DEBUG', message);
  }

  warn(message: string) {
    this.log('WARN', message);
  }

  error(message: string) {
    this.log('ERROR', message);
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
  }
}