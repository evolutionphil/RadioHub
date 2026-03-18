import axios from 'axios';

interface LastFmArtistBio {
  summary: string;
  content: string;
  published: string;
  links?: {
    link: {
      href: string;
      rel: string;
    }
  };
}

interface LastFmArtistInfo {
  name: string;
  mbid: string;
  url: string;
  image: Array<{
    "#text": string;
    size: string;
  }>;
  streamable: string;
  ontour: string;
  stats: {
    listeners: string;
    playcount: string;
  };
  similar?: {
    artist: Array<{
      name: string;
      url: string;
      image: Array<{
        "#text": string;
        size: string;
      }>;
    }>;
  };
  tags?: {
    tag: Array<{
      name: string;
      url: string;
    }>;
  };
  bio: LastFmArtistBio;
}

interface LastFmResponse {
  artist: LastFmArtistInfo;
}

class LastFmApiService {
  private baseUrl = 'https://ws.audioscrobbler.com/2.0/';
  private apiKey = process.env.LASTFM_API_KEY;
  private userAgent = 'MegaRadio/1.0';
  private missingKeyLogged = false;

  async getArtistInfo(artistName: string, language: string = 'en'): Promise<LastFmArtistInfo | null> {
    if (!this.apiKey) {
      if (!this.missingKeyLogged) {
        console.warn('Last.fm API key not configured - artist bios unavailable');
        this.missingKeyLogged = true;
      }
      return null;
    }

    try {
      const params = new URLSearchParams({
        method: 'artist.getinfo',
        artist: artistName,
        api_key: this.apiKey,
        format: 'json',
        lang: language,
        autocorrect: '1' // Fix misspelled artist names
      });

      const response = await axios.get(`${this.baseUrl}?${params.toString()}`, {
        headers: {
          'User-Agent': this.userAgent,
        },
        timeout: 10000,
      });

      if (response.data.error) {
        console.error('Last.fm API error:', response.data.message);
        return null;
      }

      return response.data.artist;
    } catch (error: any) {
      console.error('Error fetching artist info from Last.fm:', error.message);
      return null;
    }
  }

  async getSimilarArtists(artistName: string, limit: number = 10): Promise<any[] | null> {
    if (!this.apiKey) {
      return null;
    }

    try {
      const params = new URLSearchParams({
        method: 'artist.getsimilar',
        artist: artistName,
        api_key: this.apiKey,
        format: 'json',
        limit: limit.toString(),
        autocorrect: '1'
      });

      const response = await axios.get(`${this.baseUrl}?${params.toString()}`, {
        headers: {
          'User-Agent': this.userAgent,
        },
        timeout: 10000,
      });

      if (response.data.error) {
        return null;
      }

      return response.data.similarartists?.artist || [];
    } catch (error: any) {
      console.error('Error fetching similar artists from Last.fm:', error.message);
      return null;
    }
  }

  // Clean HTML tags from biography text
  cleanBioText(bioHtml: string): string {
    if (!bioHtml) return '';
    
    return bioHtml
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&quot;/g, '"') // Replace HTML entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  // Get high quality artist image from Last.fm
  getHighQualityImage(images: Array<{ "#text": string; size: string }>): string {
    if (!images || images.length === 0) return '';
    
    // Prefer larger sizes: mega > extralarge > large > medium > small
    const sizeOrder = ['mega', 'extralarge', 'large', 'medium', 'small'];
    
    for (const size of sizeOrder) {
      const image = images.find(img => img.size === size);
      if (image && image["#text"]) {
        return image["#text"];
      }
    }
    
    return images[0]["#text"] || '';
  }
}

export const lastFmApiService = new LastFmApiService();