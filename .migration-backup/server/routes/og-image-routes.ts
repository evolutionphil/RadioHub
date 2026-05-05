import { type Express } from "express";
import { generateStationOgImage, getDefaultOgImage } from '../og-image-generator';
import { logger } from '../utils/logger';

export function registerOgImageRoutes(app: Express, deps: any) {
  app.get('/api/og-image/:stationSlug', async (req, res) => {
    try {
      const { stationSlug } = req.params;
      const imageBuffer = await generateStationOgImage(stationSlug);
      
      if (!imageBuffer) {
        const defaultImage = await getDefaultOgImage();
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(defaultImage);
      }
      
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(imageBuffer);
    } catch (error) {
      logger.error('OG Image generation error:', error);
      res.status(500).send('Error generating image');
    }
  });

  app.get('/api/og-image', async (req, res) => {
    try {
      const defaultImage = await getDefaultOgImage();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.send(defaultImage);
    } catch (error) {
      logger.error('Default OG Image generation error:', error);
      res.status(500).send('Error generating image');
    }
  });
}
