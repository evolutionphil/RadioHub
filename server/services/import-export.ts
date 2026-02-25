import { IStation } from '@shared/mongo-schemas';
import * as Papa from 'papaparse';
import { z } from 'zod';

// Validation schema for imported station data
const importStationSchema = z.object({
  name: z.string().min(1, 'Station name is required'),
  url: z.string().url('Valid URL is required'),
  homepage: z.string().url().optional().or(z.literal('')),
  favicon: z.string().url().optional().or(z.literal('')),
  country: z.string().optional().or(z.literal('')),
  language: z.string().optional().or(z.literal('')),
  tags: z.string().optional().or(z.literal('')),
  bitrate: z.number().min(0).optional(),
  codec: z.string().optional().or(z.literal('')),
  votes: z.number().min(0).optional(),
}).transform(data => ({
  ...data,
  bitrate: data.bitrate || 0,
  votes: data.votes || 0,
  tags: data.tags || '',
  country: data.country || '',
  language: data.language || '',
  codec: data.codec || '',
  homepage: data.homepage || '',
  favicon: data.favicon || '',
}));

export interface ImportResult {
  totalRows: number;
  successfulImports: number;
  failedImports: number;
  errors: Array<{
    row: number;
    data: any;
    error: string;
  }>;
  importedStations: IStation[];
}

export interface ExportOptions {
  format: 'csv' | 'json';
  includeImages: boolean;
  filters?: {
    country?: string;
    language?: string;
    genre?: string;
    search?: string;
  };
}

export class ImportExportService {
  
  // Import stations from CSV data
  async importFromCSV(csvData: string): Promise<ImportResult> {
    const result: ImportResult = {
      totalRows: 0,
      successfulImports: 0,
      failedImports: 0,
      errors: [],
      importedStations: []
    };

    try {
      // Parse CSV data
      const parseResult = Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim().toLowerCase(),
        transform: (value, field) => {
          // Convert string numbers to actual numbers for bitrate and votes
          if (field === 'bitrate' || field === 'votes') {
            const num = parseInt(value);
            return isNaN(num) ? 0 : num;
          }
          return value?.trim() || '';
        }
      });

      if (parseResult.errors.length > 0) {
        throw new Error(`CSV parsing errors: ${parseResult.errors.map(e => e.message).join(', ')}`);
      }

      const rows = parseResult.data as any[];
      result.totalRows = rows.length;

      // Process each row
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        try {
          // Validate row data
          const validatedData = importStationSchema.parse(row);
          
          // Check if station already exists by URL
          const existingStation = await storage.getStationByUrl(validatedData.url);
          
          if (existingStation) {
            result.errors.push({
              row: i + 1,
              data: row,
              error: 'Station with this URL already exists'
            });
            result.failedImports++;
            continue;
          }

          // Create station
          const newStation = await storage.createStation({
            ...validatedData,
            stationUuid: `import-${Date.now()}-${i}`,
            changeUuid: `import-change-${Date.now()}-${i}`,
            serverUuid: 'import-server',
            lastCheckOk: true,
            lastCheckTime: new Date(),
            lastCheckOkTime: new Date(),
            clickCount: 0,
            clickTrend: 0,
            sslError: false,
            geoLat: null,
            geoLong: null,
            hasExtendedInfo: false,
            isManuallyEdited: true,
            manualEditFields: Object.keys(validatedData).reduce((acc, key) => {
              (acc as any)[key] = true;
              return acc;
            }, {})
          });

          result.importedStations.push(newStation);
          result.successfulImports++;

        } catch (error) {
          result.errors.push({
            row: i + 1,
            data: row,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          result.failedImports++;
        }
      }

      return result;

    } catch (error) {
      throw new Error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Import stations from JSON data
  async importFromJSON(jsonData: string): Promise<ImportResult> {
    const result: ImportResult = {
      totalRows: 0,
      successfulImports: 0,
      failedImports: 0,
      errors: [],
      importedStations: []
    };

    try {
      const data = JSON.parse(jsonData);
      const stations = Array.isArray(data) ? data : [data];
      result.totalRows = stations.length;

      for (let i = 0; i < stations.length; i++) {
        const stationData = stations[i];
        
        try {
          const validatedData = importStationSchema.parse(stationData);
          
          const existingStation = await storage.getStationByUrl(validatedData.url);
          
          if (existingStation) {
            result.errors.push({
              row: i + 1,
              data: stationData,
              error: 'Station with this URL already exists'
            });
            result.failedImports++;
            continue;
          }

          const newStation = await storage.createStation({
            ...validatedData,
            stationUuid: `import-${Date.now()}-${i}`,
            changeUuid: `import-change-${Date.now()}-${i}`,
            serverUuid: 'import-server',
            lastCheckOk: true,
            lastCheckTime: new Date(),
            lastCheckOkTime: new Date(),
            clickCount: 0,
            clickTrend: 0,
            sslError: false,
            geoLat: null,
            geoLong: null,
            hasExtendedInfo: false,
            isManuallyEdited: true,
            manualEditFields: Object.keys(validatedData).reduce((acc, key) => {
              (acc as any)[key] = true;
              return acc;
            }, {})
          });

          result.importedStations.push(newStation);
          result.successfulImports++;

        } catch (error) {
          result.errors.push({
            row: i + 1,
            data: stationData,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          result.failedImports++;
        }
      }

      return result;

    } catch (error) {
      throw new Error(`JSON import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Export stations to CSV
  async exportToCSV(options: ExportOptions): Promise<string> {
    try {
      const stations = await this.getStationsForExport(options.filters);
      
      const exportData = stations.map(station => ({
        name: station.name,
        url: station.url,
        homepage: station.homepage || '',
        favicon: station.favicon || '',
        country: station.country || '',
        language: station.language || '',
        tags: station.tags || '',
        bitrate: station.bitrate || 0,
        codec: station.codec || '',
        votes: station.votes || 0,
        clickCount: station.clickCount || 0,
        lastCheckOk: station.lastCheckOk ? 'true' : 'false',
        lastCheckTime: station.lastCheckTime ? station.lastCheckTime.toISOString() : '',
        ...(options.includeImages && { localImagePath: station.localImagePath || '' })
      }));

      return Papa.unparse(exportData, {
        header: true,
        delimiter: ',',
        quotes: true
      });

    } catch (error) {
      throw new Error(`CSV export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Export stations to JSON
  async exportToJSON(options: ExportOptions): Promise<string> {
    try {
      const stations = await this.getStationsForExport(options.filters);
      
      const exportData = stations.map(station => ({
        name: station.name,
        url: station.url,
        homepage: station.homepage || '',
        favicon: station.favicon || '',
        country: station.country || '',
        language: station.language || '',
        tags: station.tags || '',
        bitrate: station.bitrate || 0,
        codec: station.codec || '',
        votes: station.votes || 0,
        clickCount: station.clickCount || 0,
        lastCheckOk: station.lastCheckOk,
        lastCheckTime: station.lastCheckTime,
        ...(options.includeImages && { localImagePath: station.localImagePath || '' })
      }));

      return JSON.stringify(exportData, null, 2);

    } catch (error) {
      throw new Error(`JSON export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Get template CSV for import
  getImportTemplate(): string {
    const templateData = [{
      name: 'Example Station',
      url: 'https://example.com/stream',
      homepage: 'https://example.com',
      favicon: 'https://example.com/logo.png',
      country: 'United States',
      language: 'english',
      tags: 'rock,music,live',
      bitrate: 128,
      codec: 'MP3',
      votes: 0
    }];

    return Papa.unparse(templateData, {
      header: true,
      delimiter: ',',
      quotes: true
    });
  }

  // Bulk delete stations by IDs
  async bulkDeleteStations(stationIds: string[]): Promise<{
    successfulDeletes: number;
    failedDeletes: number;
    errors: Array<{ id: string; error: string }>;
  }> {
    const result = {
      successfulDeletes: 0,
      failedDeletes: 0,
      errors: [] as Array<{ id: string; error: string }>
    };

    for (const id of stationIds) {
      try {
        const success = await storage.deleteStation(id);
        if (success) {
          result.successfulDeletes++;
        } else {
          result.failedDeletes++;
          result.errors.push({ id, error: 'Station not found' });
        }
      } catch (error) {
        result.failedDeletes++;
        result.errors.push({ 
          id, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }

    return result;
  }

  // Bulk update stations
  async bulkUpdateStations(updates: Array<{
    id: string;
    data: Partial<IStation>;
  }>): Promise<{
    successfulUpdates: number;
    failedUpdates: number;
    errors: Array<{ id: string; error: string }>;
  }> {
    const result = {
      successfulUpdates: 0,
      failedUpdates: 0,
      errors: [] as Array<{ id: string; error: string }>
    };

    for (const update of updates) {
      try {
        const updatedStation = await storage.updateStation(update.id, {
          ...update.data,
          isManuallyEdited: true,
          manualEditFields: {
            ...((await storage.getStationById(update.id))?.manualEditFields || {}),
            ...Object.keys(update.data).reduce((acc, key) => {
              (acc as any)[key] = true;
              return acc;
            }, {})
          }
        });

        if (updatedStation) {
          result.successfulUpdates++;
        } else {
          result.failedUpdates++;
          result.errors.push({ id: update.id, error: 'Station not found' });
        }
      } catch (error) {
        result.failedUpdates++;
        result.errors.push({ 
          id: update.id, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }

    return result;
  }

  private async getStationsForExport(filters?: {
    country?: string;
    language?: string;
    genre?: string;
    search?: string;
  }): Promise<IStation[]> {
    const result = await storage.getStations({
      page: 1,
      limit: 999999, // Get all stations
      search: filters?.search || '',
      country: filters?.country || '',
      language: filters?.language || '',
      genre: filters?.genre || '',
      sortBy: 'name',
      sortOrder: 'asc'
    });

    return result.stations;
  }
}

export const importExportService = new ImportExportService();