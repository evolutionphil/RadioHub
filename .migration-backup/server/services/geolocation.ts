import fetch from 'node-fetch';

export interface LocationData {
  country: string;
  countryCode: string;
  region: string;
  city: string;
  lat: number;
  lon: number;
  timezone: string;
  isp: string;
}

export class GeolocationService {
  // Get location data from IP address
  async getLocationFromIP(ip: string): Promise<LocationData | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    try {
      // Use ip-api.com (free tier, no API key required) - HTTP endpoint works without auth
      const response = await fetch(
        `http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,city,lat,lon,timezone,isp`,
        { signal: controller.signal as any }
      );
      const data = await response.json() as any;
      
      if (data.status === 'success') {
        return {
          country: data.country,
          countryCode: data.countryCode,
          region: data.region,
          city: data.city,
          lat: data.lat,
          lon: data.lon,
          timezone: data.timezone,
          isp: data.isp
        };
      }
      
      return null;
    } catch (error) {
      // Error getting location from IP
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Calculate distance between two coordinates (Haversine formula)
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return distance;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  // Get client IP from request
  getClientIP(req: any): string {
    return req.headers['x-forwarded-for']?.split(',')[0] ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           '127.0.0.1';
  }
}

export const geolocationService = new GeolocationService();