import { apiRequest } from "./queryClient";

export interface StationFilters {
  page?: number;
  limit?: number;
  search?: string;
  country?: string;
  language?: string;
  genre?: string;
  codec?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  hasDescriptions?: 'all' | 'yes' | 'no' | 'partial';
  tagsStatus?: 'all' | 'empty-cooldown' | 'never-checked';
}

export interface DashboardStats {
  totalStations: number;
  totalCountries: number;
  totalLanguages: number;
  updatedToday: number;
  syncStatus: {
    isRunning: boolean;
    lastFullSync: Date | null;
  };
  recentSyncLogs: any[];
}

export const api = {
  // Dashboard
  getDashboardStats: async (): Promise<DashboardStats> => {
    const response = await apiRequest('GET', '/api/dashboard/stats');
    return response.json();
  },

  // Stations
  getStations: async (filters: StationFilters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        params.append(key, value.toString());
      }
    });
    
    const response = await apiRequest('GET', `/api/stations?${params.toString()}`);
    return response.json();
  },

  // Admin Stations (for admin interface) - uses dedicated admin endpoint
  getAdminStations: async (filters: StationFilters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        params.append(key, value.toString());
      }
    });
    
    const response = await apiRequest('GET', `/api/admin/stations?${params.toString()}`);
    return response.json();
  },

  getStation: async (id: number) => {
    const response = await apiRequest('GET', `/api/stations/${id}`);
    return response.json();
  },

  createStation: async (station: any) => {
    const response = await apiRequest('POST', '/api/stations', { body: station });
    return response.json();
  },

  updateStation: async (id: string | number, station: any) => {
    const response = await apiRequest('PUT', `/api/stations/${id}`, { body: station });
    return response.json();
  },

  deleteStation: async (id: string | number) => {
    await apiRequest('DELETE', `/api/stations/${id}`);
  },

  // Metadata
  getCountries: async () => {
    const response = await apiRequest('GET', '/api/countries');
    return response.json();
  },

  getLanguages: async () => {
    const response = await apiRequest('GET', '/api/languages');
    return response.json();
  },

  getGenres: async () => {
    const response = await apiRequest('GET', '/api/genres');
    return response.json();
  },

  // Admin: Get all countries with codes (for dropdown)
  getAvailableCountries: async () => {
    const response = await apiRequest('GET', '/api/admin/available-countries');
    return response.json();
  },

  // Analyze stream URL for codec/bitrate
  analyzeStreamUrl: async (url: string) => {
    const response = await apiRequest('POST', '/api/admin/analyze-stream', { body: { url } });
    return response.json();
  },

  // Get unique filter options from existing stations
  getStationCountries: async (): Promise<any[]> => {
    const response = await apiRequest('GET', '/api/filters/countries');
    return response.json();
  },
  
  getStationLanguages: async (): Promise<string[]> => {
    const response = await apiRequest('GET', '/api/filters/languages');
    return response.json();
  },
  
  getStationGenres: async (): Promise<string[]> => {
    const response = await apiRequest('GET', '/api/filters/genres');
    return response.json();
  },

  // Sync
  forceSync: async () => {
    const response = await apiRequest('POST', '/api/sync/force');
    return response.json();
  },

  getSyncStatus: async () => {
    const response = await apiRequest('GET', '/api/sync/status');
    return response.json();
  },

  getSyncLogs: async (limit = 20) => {
    const response = await apiRequest('GET', `/api/sync/logs?limit=${limit}`);
    return response.json();
  },
};
