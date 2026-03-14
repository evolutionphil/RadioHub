import axios from 'axios';

// iTunes Search API Types
export interface iTunesTrack {
  trackId: number;
  artistId: number;
  collectionId: number;
  trackName: string;
  artistName: string;
  collectionName: string;
  trackViewUrl: string;
  previewUrl: string;
  artworkUrl30: string;
  artworkUrl60: string;
  artworkUrl100: string;
  collectionPrice: number;
  trackPrice: number;
  releaseDate: string;
  collectionExplicitness: string;
  trackExplicitness: string;
  discCount: number;
  discNumber: number;
  trackCount: number;
  trackNumber: number;
  trackTimeMillis: number;
  country: string;
  currency: string;
  primaryGenreName: string;
  wrapperType: string;
  kind: string;
}

export interface iTunesSearchResponse {
  resultCount: number;
  results: iTunesTrack[];
}

export interface iTunesSearchParams {
  term: string;
  media?: 'music';
  entity?: 'song' | 'album' | 'musicArtist' | 'musicTrack';
  limit?: number;
  country?: string;
  lang?: string;
}

export class iTunesApiService {
  private baseUrl = 'https://itunes.apple.com/search';
  private userAgent = 'MegaRadio-Discover/1.0';
  
  private circuitOpen = false;
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly FAILURE_THRESHOLD = 5;
  private readonly CIRCUIT_RESET_MS = 60000;

  private checkCircuit(): void {
    if (this.circuitOpen && Date.now() - this.lastFailureTime > this.CIRCUIT_RESET_MS) {
      this.circuitOpen = false;
      this.failureCount = 0;
    }
    if (this.circuitOpen) {
      throw new Error('iTunes API circuit breaker open — too many failures');
    }
  }

  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.FAILURE_THRESHOLD) {
      this.circuitOpen = true;
      console.warn(`⚡ iTunes API circuit breaker OPEN after ${this.failureCount} failures — pausing for ${this.CIRCUIT_RESET_MS / 1000}s`);
    }
  }

  private recordSuccess(): void {
    this.failureCount = 0;
    this.circuitOpen = false;
  }

  async search(params: iTunesSearchParams): Promise<iTunesSearchResponse> {
    this.checkCircuit();
    try {
      const searchParams = new URLSearchParams();
      searchParams.append('term', params.term);
      searchParams.append('media', params.media || 'music');
      searchParams.append('entity', params.entity || 'song');
      searchParams.append('limit', String(params.limit || 50));
      searchParams.append('country', params.country || 'US');
      
      if (params.lang) {
        searchParams.append('lang', params.lang);
      }

      const response = await axios.get(`${this.baseUrl}?${searchParams.toString()}`, {
        headers: {
          'User-Agent': this.userAgent,
        },
        timeout: 8000,
      });

      this.recordSuccess();
      return response.data;
    } catch (error: any) {
      this.recordFailure();
      throw new Error(`Failed to search iTunes API: ${error.message}`);
    }
  }

  async searchTracks(term: string, limit: number = 50, country: string = 'US'): Promise<iTunesTrack[]> {
    const response = await this.search({
      term,
      entity: 'song',
      limit,
      country
    });
    return response.results;
  }

  async searchAlbums(term: string, limit: number = 50, country: string = 'US'): Promise<iTunesTrack[]> {
    const response = await this.search({
      term,
      entity: 'album',
      limit,
      country
    });
    return response.results;
  }

  async searchArtists(term: string, limit: number = 50, country: string = 'US'): Promise<iTunesTrack[]> {
    const response = await this.search({
      term,
      entity: 'musicArtist',
      limit,
      country
    });
    return response.results;
  }

  // Helper method to get high quality artwork URLs
  getHighQualityArtwork(artworkUrl100: string, size: number = 300): string {
    if (!artworkUrl100) return '';
    return artworkUrl100.replace('100x100bb', `${size}x${size}bb`);
  }

  // Helper method to format track duration
  formatDuration(milliseconds: number): string {
    if (!milliseconds) return '';
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  async getTrackById(trackId: string, country: string = 'US'): Promise<any> {
    this.checkCircuit();
    try {
      const lookupUrl = 'https://itunes.apple.com/lookup';
      const searchParams = new URLSearchParams({ id: trackId, country, entity: 'song' });

      const response = await axios.get(`${lookupUrl}?${searchParams.toString()}`, {
        headers: { 'User-Agent': this.userAgent },
        timeout: 8000,
      });

      this.recordSuccess();
      if (!response.data.results || response.data.results.length === 0) return null;
      return response.data.results[0];
    } catch (error: any) {
      this.recordFailure();
      throw new Error(`Failed to fetch track details: ${error.message}`);
    }
  }

  async getAlbumById(collectionId: string, country: string = 'US'): Promise<any> {
    this.checkCircuit();
    try {
      const lookupUrl = 'https://itunes.apple.com/lookup';
      const searchParams = new URLSearchParams({ id: collectionId, country, entity: 'song' });

      const response = await axios.get(`${lookupUrl}?${searchParams.toString()}`, {
        headers: { 'User-Agent': this.userAgent },
        timeout: 8000,
      });

      this.recordSuccess();
      if (!response.data.results || response.data.results.length === 0) return null;

      const album = response.data.results.find((item: any) => item.wrapperType === 'collection');
      const tracks = response.data.results.filter((item: any) => item.wrapperType === 'track');
      return { album: album || response.data.results[0], tracks };
    } catch (error: any) {
      this.recordFailure();
      throw new Error(`Failed to fetch album details: ${error.message}`);
    }
  }

  async getArtistById(artistId: string, country: string = 'US', limit: number = 25): Promise<any> {
    this.checkCircuit();
    try {
      const lookupUrl = 'https://itunes.apple.com/lookup';
      const searchParams = new URLSearchParams({ id: artistId, country, entity: 'album,song', limit: limit.toString() });

      const response = await axios.get(`${lookupUrl}?${searchParams.toString()}`, {
        headers: { 'User-Agent': this.userAgent },
        timeout: 8000,
      });

      this.recordSuccess();
      if (!response.data.results || response.data.results.length === 0) return null;

      const artist = response.data.results.find((item: any) => item.wrapperType === 'artist');
      const albums = response.data.results.filter((item: any) => item.wrapperType === 'collection');
      const tracks = response.data.results.filter((item: any) => item.wrapperType === 'track');
      return { artist: artist || response.data.results[0], albums, tracks };
    } catch (error: any) {
      this.recordFailure();
      throw new Error(`Failed to fetch artist details: ${error.message}`);
    }
  }
}

export const itunesApiService = new iTunesApiService();