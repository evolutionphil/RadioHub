#!/usr/bin/env node

/**
 * Quick station testing script for sampling database health
 */

import mongoose from 'mongoose';
import fetch from 'node-fetch';
import { Station } from '../shared/mongo-schemas.js';

async function quickStationTest() {
  try {
    await mongoose.connect(process.env.DATABASE_URL);
    console.log('🔌 Connected to MongoDB');

    // Get random sample of 20 stations
    const sampleStations = await Station.aggregate([
      { $sample: { size: 20 } },
      { $project: { _id: 1, name: 1, url: 1, country: 1 } }
    ]);

    console.log(`🎯 Testing ${sampleStations.length} random stations...\n`);

    let working = 0;
    let broken = 0;
    let hls = 0;

    for (const station of sampleStations) {
      try {
        console.log(`Testing: ${station.name} (${station.country})`);
        console.log(`URL: ${station.url}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(station.url, {
          method: 'HEAD',
          signal: controller.signal,
          headers: {
            'User-Agent': 'RadioHealthChecker/1.0',
            'Accept': 'audio/*,*/*'
          }
        });

        clearTimeout(timeoutId);

        const isHLSUrl = station.url.toLowerCase().includes('.m3u8') || 
                        station.url.toLowerCase().includes('playlist');

        if (isHLSUrl) {
          console.log(`❌ HLS Stream detected\n`);
          hls++;
        } else if (response.ok) {
          console.log(`✅ Working (${response.status})\n`);
          working++;
        } else {
          console.log(`❌ Broken (${response.status})\n`);
          broken++;
        }

      } catch (error) {
        console.log(`❌ Error: ${error.message}\n`);
        broken++;
      }
    }

    console.log('=== QUICK TEST RESULTS ===');
    console.log(`Working: ${working}/${sampleStations.length} (${((working/sampleStations.length)*100).toFixed(1)}%)`);
    console.log(`Broken: ${broken}/${sampleStations.length} (${((broken/sampleStations.length)*100).toFixed(1)}%)`);
    console.log(`HLS: ${hls}/${sampleStations.length} (${((hls/sampleStations.length)*100).toFixed(1)}%)`);

  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

quickStationTest().catch(console.error);