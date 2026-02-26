import express from 'express';
import { WORLD_REGIONS, COUNTRY_CITIES } from '../data/regions.js';
import { Station } from '../shared/mongo-schemas';

const router = express.Router();

// Get all world regions
router.get('/regions', async (req, res) => {
  try {
    const regions = await Promise.all(Object.keys(WORLD_REGIONS).map(async key => {
      const region = WORLD_REGIONS[key];
      const countryCount = region.countries.length;
      
      // Get real station count for the region
      const stationCount = await Station.countDocuments({ 
        country: { $in: region.countries } 
      });

      return {
        slug: key,
        name: region.name,
        countryCount,
        stationCount
      };
    }));
    
    res.json({
      success: true,
      data: regions
    });
  } catch (error) {
    console.error('Error fetching regions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch regions'
    });
  }
});

// Get countries in a specific region
router.get('/regions/:regionSlug', async (req, res) => {
  try {
    const { regionSlug } = req.params;
    const region = WORLD_REGIONS[regionSlug];
    
    if (!region) {
      return res.status(404).json({
        success: false,
        error: 'Region not found'
      });
    }
    
    // Get real station counts per country using aggregation
    const stationCounts = await Station.aggregate([
      { $match: { country: { $in: region.countries } } },
      { $group: { _id: "$country", count: { $sum: 1 } } }
    ]);

    const countMap = stationCounts.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {});

    const countries = region.countries.map(country => ({
      name: country,
      slug: country.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, ''),
      stationCount: countMap[country] || 0
    })).sort((a, b) => b.stationCount - a.stationCount);
    
    res.json({
      success: true,
      data: {
        region: {
          name: region.name,
          slug: regionSlug
        },
        countries
      }
    });
  } catch (error) {
    console.error('Error fetching region countries:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch region countries'
    });
  }
});

// Get cities in a specific country
router.get('/regions/:regionSlug/:countrySlug', async (req, res) => {
  try {
    const { regionSlug, countrySlug } = req.params;
    const region = WORLD_REGIONS[regionSlug];
    
    if (!region) {
      return res.status(404).json({
        success: false,
        error: 'Region not found'
      });
    }
    
    // Find the country name from the slug
    const countryName = region.countries.find(country => 
      country.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '') === countrySlug
    );
    
    if (!countryName) {
      return res.status(404).json({
        success: false,
        error: 'Country not found'
      });
    }
    
    const cities = COUNTRY_CITIES[countryName] || [];
    
    // Get real station counts per city using aggregation
    const stationCounts = await Station.aggregate([
      { $match: { country: countryName, state: { $in: cities } } },
      { $group: { _id: "$state", count: { $sum: 1 } } }
    ]);

    const countMap = stationCounts.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {});

    const citiesWithCounts = cities.map(city => ({
      name: city,
      slug: city.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, ''),
      stationCount: countMap[city] || 0
    })).sort((a, b) => b.stationCount - a.stationCount);
    
    res.json({
      success: true,
      data: {
        region: {
          name: region.name,
          slug: regionSlug
        },
        country: {
          name: countryName,
          slug: countrySlug
        },
        cities: citiesWithCounts
      }
    });
  } catch (error) {
    console.error('Error fetching country cities:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch country cities'
    });
  }
});

// Get stations by region/country/city (integration with existing stations API)
router.get('/regions/:regionSlug/:countrySlug/:citySlug?/stations', async (req, res) => {
  try {
    const { regionSlug, countrySlug, citySlug } = req.params;
    const { limit = 20, offset = 0 } = req.query;
    
    // This would integrate with your existing stations collection
    // For now, returning a placeholder response
    
    const region = WORLD_REGIONS[regionSlug];
    if (!region) {
      return res.status(404).json({
        success: false,
        error: 'Region not found'
      });
    }
    
    const countryName = region.countries.find(country => 
      country.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '') === countrySlug
    );
    
    if (!countryName) {
      return res.status(404).json({
        success: false,
        error: 'Country not found'
      });
    }
    
    let cityName = null;
    if (citySlug) {
      const cities = COUNTRY_CITIES[countryName] || [];
      cityName = cities.find(city => 
        city.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '') === citySlug
      );
      
      if (!cityName) {
        return res.status(404).json({
          success: false,
          error: 'City not found'
        });
      }
    }
    
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offsetNum = parseInt(offset) || 0;

    const filter = { country: countryName, isWorking: true };
    if (cityName) {
      filter.$or = [
        { city: { $regex: cityName, $options: 'i' } },
        { state: { $regex: cityName, $options: 'i' } }
      ];
    }

    const [stations, total] = await Promise.all([
      Station.find(filter)
        .select('name slug country language genre favicon bitrate codec votes clickcount')
        .sort({ votes: -1, clickcount: -1 })
        .skip(offsetNum)
        .limit(limitNum)
        .lean(),
      Station.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        region: { name: region.name, slug: regionSlug },
        country: { name: countryName, slug: countrySlug },
        city: cityName ? { name: cityName, slug: citySlug } : null,
        stations,
        pagination: {
          total,
          limit: limitNum,
          offset: offsetNum
        }
      }
    });
  } catch (error) {
    console.error('Error fetching region stations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch region stations'
    });
  }
});

export default router;