/**
 * One-time cleanup script to remove stations with URLs as names
 * Run with: npx tsx server/cleanup-url-names.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Station, UserFavorite, BlacklistedStation } from '../shared/mongo-schemas';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

// Helper function to check if a station name is actually a URL
function isStationNameUrl(name: string | null | undefined): boolean {
  if (!name || typeof name !== 'string') return false;
  
  const lowerName = name.trim().toLowerCase();
  
  // Only match if the name STARTS with a URL protocol or www
  // This avoids false positives like "SmoothJazz.com 64k aac+" which are legitimate station names
  return (
    lowerName.startsWith('http://') ||
    lowerName.startsWith('https://') ||
    lowerName.startsWith('www.') ||
    lowerName.startsWith('ftp://') ||
    lowerName.startsWith('rtmp://') ||
    lowerName.startsWith('rtsp://')
  );
}

async function cleanupUrlNames() {
  try {
    // Connect to database
    const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/radio';
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }
    await mongoose.connect(MONGODB_URI);
    logger.log('✅ Connected to MongoDB');
    
    logger.log('🧹 Starting cleanup of stations with URL names...');
    
    // Find all stations with URL-like names
    const allStations = await Station.find({}).select('_id name url stationuuid').lean();
    const stationsToDelete = allStations.filter(station => isStationNameUrl(station.name));
    
    if (stationsToDelete.length === 0) {
      logger.log('✅ No stations with URL names found');
      process.exit(0);
    }
    
    logger.log(`🗑️ Found ${stationsToDelete.length} stations with URL names to delete:`);
    
    // Show first 10 examples
    const examples = stationsToDelete.slice(0, 10);
    examples.forEach(station => {
      logger.log(`  ❌ "${station.name}"`);
    });
    if (stationsToDelete.length > 10) {
      logger.log(`  ... and ${stationsToDelete.length - 10} more`);
    }
    
    let deletedCount = 0;
    let blacklistedCount = 0;
    const errors: string[] = [];
    
    // Process each station
    for (const station of stationsToDelete) {
      try {
        // Add station to blacklist to prevent re-syncing
        try {
          await BlacklistedStation.create({
            stationUuid: station.stationuuid,
            url: station.url,
            name: station.name,
            reason: 'Station name is a URL - auto-cleanup',
            deletedBy: 'admin',
          });
          blacklistedCount++;
        } catch (blacklistError: any) {
          // Station may already be blacklisted, that's ok
          if (!blacklistError.message.includes('duplicate')) {
            logger.warn(`Failed to blacklist station ${station.name}:`, blacklistError.message);
          }
        }
        
        // Delete the station from the database
        await Station.findByIdAndDelete(station._id);
        deletedCount++;
        
        // Remove from user favorites
        await UserFavorite.deleteMany({ stationId: station._id });
        
      } catch (stationError: any) {
        errors.push(`Error deleting station ${station._id}: ${stationError.message}`);
        console.error(`Error processing station ${station._id}:`, stationError);
      }
    }
    
    logger.log(`✅ URL name cleanup completed!`);
    logger.log(`   • Deleted: ${deletedCount} stations`);
    logger.log(`   • Blacklisted: ${blacklistedCount} stations`);
    if (errors.length > 0) {
      logger.log(`   • Errors: ${errors.length}`);
      errors.forEach(err => logger.log(`     - ${err}`));
    }
    
    await mongoose.disconnect();
    logger.log('✅ Disconnected from MongoDB');
    process.exit(0);
    
  } catch (error: any) {
    console.error('❌ Cleanup failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

cleanupUrlNames();
