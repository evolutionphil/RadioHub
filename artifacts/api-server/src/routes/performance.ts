import { Router, Request, Response } from 'express';
import { performanceService } from '../services/performance-service';
import { getCloudflareWebVitals, parseVitalsPeriod } from '../services/cloudflare-web-vitals';

const router = Router();

// GET /api/admin/performance/web-vitals - Optional, bounded Cloudflare RUM read.
router.get('/web-vitals', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const period = parseVitalsPeriod(req.query.start, req.query.end);
  if (!period) {
    return void res.status(400).json({ success: false, message: 'Use valid UTC start/end timestamps, with start before end and a range of at most 7 days.' });
  }
  // Missing configuration/data describes this optional integration, not an
  // application outage. The response status tells the UI what action is needed.
  res.json(await getCloudflareWebVitals(period));
});

// POST /api/admin/performance/optimize - Run optimization
router.post('/optimize', async (req: Request, res: Response) => {
  try {
    const { type, action } = req.body;

    if (!type || !action) {
      return void res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: type and action' 
      });
    }

    const result = await performanceService.runOptimization(type, action);
    res.json(result);
  } catch (error: any) {
    console.error('❌ Performance optimization error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to run optimization' 
    });
  }
});

// GET /api/admin/performance/jobs/:jobId - Get optimization job status
router.get('/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = await performanceService.getOptimizationJob(jobId as string);

    if (!job) {
      return void res.status(404).json({ 
        success: false, 
        message: 'Job not found' 
      });
    }

    res.json({ success: true, job });
  } catch (error: any) {
    console.error('❌ Failed to get job status:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to get job status' 
    });
  }
});

// GET /api/admin/performance/metrics - Get performance metrics
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = await performanceService.getPerformanceMetrics();
    res.json(metrics);
  } catch (error: any) {
    console.error('❌ Failed to get performance metrics:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to get performance metrics' 
    });
  }
});

export default router;
