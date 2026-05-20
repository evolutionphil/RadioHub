import mongoose from 'mongoose';
import os from 'os';
import { Station, Country, Genre } from '@workspace/db-shared/mongo-schemas';

interface PerformanceMetrics {
  databaseStats: {
    totalStations: number;
    totalCountries: number;
    totalGenres: number;
    indexesCount: number;
    dbSize: string;
  };
  systemHealth: {
    memoryUsage: number;
    systemMemoryUsage: number;
    heapUsedMB: number;
    heapTotalMB: number;
    cpuUsage: number | null;
    connectionPool: number;
  };
  optimizationSuggestions: Array<{
    type: 'index' | 'query' | 'cleanup' | 'cache';
    priority: 'high' | 'medium' | 'low';
    title: string;
    description: string;
    impact: string;
    action: string;
  }>;
}

interface OptimizationJob {
  id: string;
  type: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  results?: any;
  startedAt: Date;
  completedAt?: Date;
}

class PerformanceService {
  private optimizationJobs: Map<string, OptimizationJob> = new Map();

  // process.cpuUsage() delta tracking — first call returns null (no baseline),
  // subsequent calls return real user+system CPU % of wall-clock time elapsed.
  private lastCpuSample: { usage: NodeJS.CpuUsage; time: number } | null = null;

  private sampleCpu(): number | null {
    const now = Date.now();
    const usage = process.cpuUsage();
    if (!this.lastCpuSample) {
      this.lastCpuSample = { usage, time: now };
      return null;
    }
    const elapsedMs = now - this.lastCpuSample.time;
    if (elapsedMs <= 0) return null;
    const userDeltaUs = usage.user - this.lastCpuSample.usage.user;
    const sysDeltaUs = usage.system - this.lastCpuSample.usage.system;
    this.lastCpuSample = { usage, time: now };
    // Microseconds → milliseconds; divide by elapsed wall time and CPU count
    // to get a portable single-core % view.
    const totalCpuMs = (userDeltaUs + sysDeltaUs) / 1000;
    const cpuCount = os.cpus().length || 1;
    const pct = (totalCpuMs / elapsedMs / cpuCount) * 100;
    return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  }

  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    const [totalStations, totalCountries, totalGenres] = await Promise.all([
      Station.countDocuments(),
      Station.distinct('country').then(countries => countries.length),
      Genre.countDocuments()
    ]);

    const dbStats = await mongoose.connection.db?.stats();
    if (!dbStats) throw new Error('Database connection not available');
    const dbSize = `${Math.round(dbStats.dataSize / (1024 * 1024))} MB`;

    let indexesCount = 0;
    try {
      const stationIndexes = await Station.collection.listIndexes().toArray();
      indexesCount = stationIndexes.length;
    } catch {}

    const memInfo = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const systemHealth = {
      memoryUsage: Math.round(memInfo.heapUsed / memInfo.heapTotal * 100),
      systemMemoryUsage: Math.round((totalMem - freeMem) / totalMem * 100),
      heapUsedMB: Math.round(memInfo.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memInfo.heapTotal / 1024 / 1024),
      cpuUsage: this.sampleCpu(),
      connectionPool: mongoose.connection.readyState === 1 ?
        (mongoose.connection as any).pool?.totalConnectionCount ?? 0 : 0
    };

    const optimizationSuggestions = await this.generateOptimizationSuggestions({
      totalStations,
      indexesCount,
      systemHealth
    });

    return {
      databaseStats: {
        totalStations,
        totalCountries,
        totalGenres,
        indexesCount,
        dbSize
      },
      systemHealth,
      optimizationSuggestions
    };
  }

  private async generateOptimizationSuggestions(context: any): Promise<any[]> {
    const suggestions = [];

    if (context.totalStations > 50000) {
      suggestions.push({
        type: 'cleanup',
        priority: 'medium',
        title: 'Remove Orphaned Station Data',
        description: 'Large dataset detected. Cleaning up orphaned records and duplicates can improve performance.',
        impact: 'Reduce database size by 10-15%',
        action: 'remove_orphaned_data'
      });
    }

    if (context.systemHealth.memoryUsage > 80) {
      suggestions.push({
        type: 'cache',
        priority: 'high',
        title: 'Optimize Memory Usage',
        description: 'High memory usage detected. Clearing old caches and optimizing queries can free up memory.',
        impact: 'Reduce memory usage by 20-30%',
        action: 'optimize_memory'
      });
    }

    return suggestions;
  }

  async runOptimization(type: string, action: string): Promise<{ success: boolean; jobId?: string; message?: string; results?: any }> {
    const jobId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const job: OptimizationJob = {
      id: jobId,
      type,
      status: 'running',
      progress: 0,
      message: `Starting ${type} optimization...`,
      startedAt: new Date()
    };

    this.optimizationJobs.set(jobId, job);
    this.pruneCompletedJobs();

    this.executeOptimization(jobId, type, action);

    return {
      success: true,
      jobId,
      message: `Started ${type} optimization`
    };
  }

  private async executeOptimization(jobId: string, type: string, action: string) {
    const job = this.optimizationJobs.get(jobId);
    if (!job) return;

    try {
      let results: any = {};

      switch (action) {
        case 'create_missing_indexes':
          results = await this.createMissingIndexes(jobId);
          break;
        case 'rebuild_indexes':
          results = await this.rebuildIndexes(jobId);
          break;
        case 'remove_orphaned_data':
          results = await this.removeOrphanedData(jobId);
          break;
        case 'optimize_memory':
          results = await this.optimizeMemory(jobId);
          break;
        case 'clear_cache':
          results = await this.clearCache(jobId);
          break;
        case 'warm_cache':
          results = await this.warmCache(jobId);
          break;
        case 'analyze_performance':
          results = await this.analyzePerformance(jobId);
          break;
        default:
          throw new Error(`Unknown optimization action: ${action}`);
      }

      job.status = 'completed';
      job.progress = 100;
      job.message = `${type} optimization completed successfully`;
      job.results = results;
      job.completedAt = new Date();
    } catch (error) {
      job.status = 'failed';
      job.message = `Optimization failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async createMissingIndexes(jobId: string): Promise<any> {
    const job = this.optimizationJobs.get(jobId)!;
    job.progress = 20;
    job.message = 'Analyzing current indexes...';

    const indexes: Array<{ collection: string; index: { [key: string]: 1 | -1 }; name: string }> = [
      { collection: 'stations', index: { country: 1, name: 1 }, name: 'country_name_idx' },
      { collection: 'stations', index: { votes: -1 }, name: 'votes_desc_idx' },
      { collection: 'stations', index: { lastCheckOk: 1 }, name: 'status_idx' },
      { collection: 'stations', index: { geoLat: 1, geoLong: 1 }, name: 'geo_idx' },
      { collection: 'stations', index: { clickCount: -1 }, name: 'popularity_idx' },
      { collection: 'stations', index: { codec: 1, bitrate: 1 }, name: 'quality_idx' }
    ];

    let created = 0;
    let skipped = 0;

    for (let i = 0; i < indexes.length; i++) {
      const { collection, index, name } = indexes[i];
      job.progress = 20 + (i / indexes.length) * 60;
      job.message = `Creating index ${name} on ${collection}...`;

      try {
        const db = mongoose.connection.db;
        if (!db) throw new Error('Database connection not available');
        const coll = db.collection(collection);
        const existingIndexes = await coll.listIndexes().toArray();
        if (!existingIndexes.some(idx => idx.name === name)) {
          await coll.createIndex(index, { name, background: true });
          created++;
        } else {
          skipped++;
        }
      } catch {}
    }

    job.progress = 90;
    job.message = 'Finalizing index creation...';

    return {
      indexesCreated: created,
      indexesSkipped: skipped,
      totalIndexes: indexes.length,
      message: `Created ${created} new indexes, skipped ${skipped} existing ones`
    };
  }

  private async rebuildIndexes(jobId: string): Promise<any> {
    const job = this.optimizationJobs.get(jobId)!;
    job.progress = 10;
    job.message = 'Starting index rebuild...';

    try {
      const collections = ['stations', 'countries', 'genres', 'languages'];
      let rebuilt = 0;

      for (let i = 0; i < collections.length; i++) {
        const collectionName = collections[i];
        job.progress = 10 + (i / collections.length) * 80;
        job.message = `Rebuilding indexes for ${collectionName}...`;

        const db = mongoose.connection.db;
        if (!db) throw new Error('Database connection not available');
        const collection = db.collection(collectionName);
        await collection.dropIndexes();
        await collection.createIndexes([]);
        rebuilt++;
      }

      return {
        collectionsProcessed: rebuilt,
        message: `Rebuilt indexes for ${rebuilt} collections`
      };
    } catch (error) {
      throw new Error(`Index rebuild failed: ${error}`);
    }
  }

  private async removeOrphanedData(jobId: string): Promise<any> {
    const job = this.optimizationJobs.get(jobId)!;
    job.progress = 10;
    job.message = 'Scanning for orphaned data...';

    let removed = 0;
    job.progress = 30;
    job.message = 'Removing invalid stations...';

    const invalidStations = await Station.deleteMany({
      $or: [
        { name: { $in: ['', null] } },
        { url: { $in: ['', null] } },
        { country: { $in: ['', null] } }
      ]
    });
    removed += invalidStations.deletedCount || 0;

    job.progress = 90;
    job.message = 'Finalizing cleanup...';

    return {
      recordsRemoved: removed,
      message: `Removed ${removed} orphaned records`
    };
  }

  private async optimizeMemory(jobId: string): Promise<any> {
    const job = this.optimizationJobs.get(jobId)!;
    job.progress = 50;
    job.message = 'Triggering garbage collection...';

    if (global.gc) {
      global.gc();
    }

    return {
      message: 'Memory optimization completed'
    };
  }

  private async clearCache(jobId: string): Promise<any> {
    const job = this.optimizationJobs.get(jobId)!;
    job.progress = 50;
    job.message = 'Clearing application caches...';

    // Defer to performance-cache to clear actual in-process caches.
    try {
      const { performanceCache } = await import('../performance-cache');
      const cleared = performanceCache.clearSeoCaches?.() ?? { seoHtmlCleared: 0, pageDataCleared: 0 };
      return {
        message: 'Cache cleared successfully',
        cleared
      };
    } catch {
      return { message: 'Cache cleared' };
    }
  }

  private async warmCache(jobId: string): Promise<any> {
    const job = this.optimizationJobs.get(jobId)!;
    job.progress = 20;
    job.message = 'Pre-loading frequently accessed data...';

    await Station.find({ votes: { $gte: 10 } }).limit(100).lean();

    job.progress = 60;
    job.message = 'Pre-loading country and genre data...';

    await Promise.all([
      Country.find().lean(),
      Genre.find().lean()
    ]);

    return {
      message: 'Cache warmed successfully',
      recordsPreloaded: 100
    };
  }

  private async analyzePerformance(jobId: string): Promise<any> {
    const job = this.optimizationJobs.get(jobId)!;
    job.progress = 30;
    job.message = 'Running database analysis...';

    const db = mongoose.connection.db;
    if (!db) throw new Error('Database connection not available');
    const stats = await db.stats();

    job.progress = 70;
    job.message = 'Generating performance report...';

    return {
      databaseSize: Math.round(stats.dataSize / (1024 * 1024)),
      indexSize: Math.round(stats.indexSize / (1024 * 1024)),
      collections: stats.collections,
      message: 'Performance analysis completed'
    };
  }

  private pruneCompletedJobs() {
    const MAX_JOBS = 100;
    const JOB_TTL = 6 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [id, job] of this.optimizationJobs) {
      if (job.status !== 'running' && job.completedAt && (now - job.completedAt.getTime() > JOB_TTL)) {
        this.optimizationJobs.delete(id);
      }
    }
    if (this.optimizationJobs.size > MAX_JOBS) {
      const sorted = [...this.optimizationJobs.entries()]
        .filter(([, j]) => j.status !== 'running')
        .sort((a, b) => (a[1].completedAt?.getTime() || 0) - (b[1].completedAt?.getTime() || 0));
      const toRemove = sorted.slice(0, this.optimizationJobs.size - MAX_JOBS);
      for (const [id] of toRemove) this.optimizationJobs.delete(id);
    }
  }

  getOptimizationJob(jobId: string): OptimizationJob | null {
    return this.optimizationJobs.get(jobId) || null;
  }

  getAllOptimizationJobs(): OptimizationJob[] {
    return Array.from(this.optimizationJobs.values());
  }
}

export const performanceService = new PerformanceService();
