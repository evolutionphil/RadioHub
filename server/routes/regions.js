import express from 'express';
import { WORLD_REGIONS, COUNTRY_CITIES } from '../data/regions.js';

const router = express.Router();

// Get all world regions
router.get('/regions', (req, res) => {
  try {
    const regions = Object.keys(WORLD_REGIONS).map(key => ({
      slug: key,
      name: WORLD_REGIONS[key].name,
      countryCount: WORLD_REGIONS[key].countries.length
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
router.get('/regions/:regionSlug', (req, res) => {
  try {
    const { regionSlug } = req.params;
    const region = WORLD_REGIONS[regionSlug];
    
    if (!region) {
      return res.status(404).json({
        success: false,
        error: 'Region not found'
      });
    }
    
    // Get country counts from stations (you can implement this later)
    const countries = region.countries.map(country => ({
      name: country,
      slug: country.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, ''),
      stationCount: Math.floor(Math.random() * 100) + 5 // Placeholder - replace with actual count
    }));
    
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
router.get('/regions/:regionSlug/:countrySlug', (req, res) => {
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
    
    console.log('🏙️ Looking up cities for country:', countryName);
    console.log('🗺️ Available countries in COUNTRY_CITIES:', Object.keys(COUNTRY_CITIES));
    const cities = COUNTRY_CITIES[countryName] || [];
    console.log('🏙️ Found cities:', cities);
    const citiesWithCounts = cities.map(city => ({
      name: city,
      slug: city.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, ''),
      stationCount: Math.floor(Math.random() * 50) + 1 // Placeholder - replace with actual count
    }));
    
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
    
    // TODO: Implement actual station filtering by country/city
    // For now, return placeholder data structure
    res.json({
      success: true,
      data: {
        region: { name: region.name, slug: regionSlug },
        country: { name: countryName, slug: countrySlug },
        city: cityName ? { name: cityName, slug: citySlug } : null,
        stations: [],
        pagination: {
          total: 0,
          limit: parseInt(limit),
          offset: parseInt(offset)
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