/**
 * CLIENT-SIDE ERROR REPORTING UTILITY
 * 
 * Captures detailed playback errors and reports them to the database
 * for comprehensive error tracking and debugging.
 */

const isDevelopment = import.meta.env.DEV;

interface AudioErrorDetails {
  errorCode?: number;
  errorMessage?: string;
  errorName?: string;
  networkState?: number;
  readyState?: number;
  statusCode?: number;
  headers?: Record<string, string>;
  stackTrace?: string;
  attemptCount?: number;
  lastAttemptUrl?: string;
  audioProperties?: {
    currentTime?: number;
    duration?: number;
    buffered?: number;
    volume?: number;
    muted?: boolean;
    paused?: boolean;
    ended?: boolean;
    seeking?: boolean;
    crossOrigin?: string;
    preload?: string;
  };
  browserInfo?: {
    userAgent?: string;
    platform?: string;
    language?: string;
    cookieEnabled?: boolean;
    onLine?: boolean;
  };
  connectionInfo?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
  };
}

interface StationInfo {
  _id: string;
  name: string;
  url: string;
  country?: string;
  language?: string;
  codec?: string;
  bitrate?: number;
  favicon?: string;
  votes?: number;
  clickCount?: number;
}

interface StreamInfo {
  detectedFormat?: string;
  contentType?: string;
  isHLS?: boolean;
  isPlaylist?: boolean;
  contentLength?: number;
}

export class AudioErrorReporter {
  private static instance: AudioErrorReporter;
  private reportQueue: Array<any> = [];
  private isReporting = false;

  static getInstance(): AudioErrorReporter {
    if (!AudioErrorReporter.instance) {
      AudioErrorReporter.instance = new AudioErrorReporter();
    }
    return AudioErrorReporter.instance;
  }

  /**
   * Report an audio playback error to the database
   */
  async reportError(
    station: StationInfo,
    errorType: 'AUDIO_ERROR' | 'CONNECTION_TIMEOUT' | 'STREAM_UNAVAILABLE' | 'CODEC_UNSUPPORTED' | 'CORS_ERROR' | 'NETWORK_ERROR',
    errorMessage: string,
    audioElement?: HTMLAudioElement,
    streamInfo?: StreamInfo,
    additionalDetails?: Partial<AudioErrorDetails>
  ): Promise<void> {
    try {
      // Gather comprehensive error details
      const errorDetails: AudioErrorDetails = {
        errorCode: audioElement?.error?.code,
        errorMessage: audioElement?.error?.message || errorMessage,
        errorName: audioElement?.error?.constructor?.name,
        networkState: audioElement?.networkState,
        readyState: audioElement?.readyState,
        stackTrace: new Error().stack,
        ...additionalDetails,
        audioProperties: audioElement ? {
          currentTime: audioElement.currentTime,
          duration: audioElement.duration,
          buffered: audioElement.buffered.length > 0 ? audioElement.buffered.end(audioElement.buffered.length - 1) : 0,
          volume: audioElement.volume,
          muted: audioElement.muted,
          paused: audioElement.paused,
          ended: audioElement.ended,
          seeking: audioElement.seeking,
          crossOrigin: audioElement.crossOrigin || undefined,
          preload: audioElement.preload
        } : {},
        browserInfo: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
          cookieEnabled: navigator.cookieEnabled,
          onLine: navigator.onLine
        },
        connectionInfo: this.getConnectionInfo()
      };

      // Prepare station metadata
      const stationMeta = {
        country: station.country,
        language: station.language,
        codec: station.codec,
        bitrate: station.bitrate,
        favicon: station.favicon,
        votes: station.votes,
        clickCount: station.clickCount,
        isHLS: streamInfo?.isHLS || false,
        isPlaylist: streamInfo?.isPlaylist || false
      };

      // Create error report payload
      const errorReport = {
        stationId: station._id,
        stationName: station.name,
        stationUrl: station.url,
        errorType,
        errorMessage,
        errorDetails,
        stationMeta,
        browserInfo: errorDetails.browserInfo,
        streamInfo: streamInfo || {}
      };

      // Add to queue and process
      this.reportQueue.push(errorReport);
      await this.processQueue();

      if (isDevelopment) {
        console.log(`📊 Error reported for station ${station.name}: ${errorType} - ${errorMessage}`);
      }

    } catch (error) {
      if (isDevelopment) {
        console.error('Failed to report error:', error);
      }
    }
  }

  /**
   * Report stream interruption (unexpected pause/ended events)
   */
  async reportStreamInterruption(
    station: StationInfo,
    interruptionType: 'UNEXPECTED_PAUSE' | 'UNEXPECTED_END' | 'STREAM_STALLED' | 'STREAM_SUSPENDED',
    audioElement: HTMLAudioElement,
    streamInfo?: StreamInfo
  ): Promise<void> {
    const errorMessage = this.getInterruptionMessage(interruptionType);
    await this.reportError(
      station, 
      'STREAM_UNAVAILABLE', 
      errorMessage, 
      audioElement, 
      streamInfo,
      { attemptCount: 1 }
    );
  }

  /**
   * Report connection timeout
   */
  async reportConnectionTimeout(
    station: StationInfo,
    timeoutDuration: number,
    audioElement?: HTMLAudioElement,
    streamInfo?: StreamInfo
  ): Promise<void> {
    await this.reportError(
      station,
      'CONNECTION_TIMEOUT',
      `Connection timeout after ${timeoutDuration}ms`,
      audioElement,
      streamInfo,
      { attemptCount: 1 }
    );
  }

  /**
   * Report CORS error
   */
  async reportCorsError(
    station: StationInfo,
    originalUrl: string,
    audioElement?: HTMLAudioElement
  ): Promise<void> {
    await this.reportError(
      station,
      'CORS_ERROR',
      `CORS error accessing stream from ${originalUrl}`,
      audioElement,
      undefined,
      { lastAttemptUrl: originalUrl }
    );
  }

  /**
   * Get network connection information
   */
  private getConnectionInfo(): AudioErrorDetails['connectionInfo'] {
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    
    if (connection) {
      return {
        effectiveType: connection.effectiveType,
        downlink: connection.downlink,
        rtt: connection.rtt
      };
    }
    
    return {};
  }

  /**
   * Get human-readable interruption message
   */
  private getInterruptionMessage(type: string): string {
    switch (type) {
      case 'UNEXPECTED_PAUSE':
        return 'Stream paused unexpectedly during playback';
      case 'UNEXPECTED_END':
        return 'Stream ended unexpectedly (radio streams should not end)';
      case 'STREAM_STALLED':
        return 'Stream stalled - no data received for extended period';
      case 'STREAM_SUSPENDED':
        return 'Stream suspended by browser (likely due to resource constraints)';
      default:
        return `Stream interruption: ${type}`;
    }
  }

  /**
   * Process the error reporting queue
   */
  private async processQueue(): Promise<void> {
    if (this.isReporting || this.reportQueue.length === 0) {
      return;
    }

    this.isReporting = true;

    try {
      const reportsToSend = [...this.reportQueue];
      this.reportQueue = [];

      // Send reports in batches
      for (const report of reportsToSend) {
        try {
          const response = await fetch('/api/stations/report-error', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(report)
          });

          if (response.ok) {
            const result = await response.json();
            if (isDevelopment) {
              console.log(`✅ Error report sent successfully:`, result.message);
            }
          } else {
            if (isDevelopment) {
              console.error('Failed to send error report:', response.statusText);
            }
            // Re-queue failed reports for retry
            this.reportQueue.push(report);
          }
        } catch (error) {
          if (isDevelopment) {
            console.error('Network error sending report:', error);
          }
          // Re-queue for retry
          this.reportQueue.push(report);
        }

        // Small delay between reports to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally {
      this.isReporting = false;
    }
  }
}

// Export singleton instance
export const errorReporter = AudioErrorReporter.getInstance();