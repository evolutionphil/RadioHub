import { Router, Request, Response } from 'express';
import { performanceService } from '../services/performance-service';

const router = Router();

// GET /api/admin/performance/web-vitals - Get Core Web Vitals from Cloudflare RUM
router.get('/web-vitals', async (req: Request, res: Response) => {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiKey = process.env.CLOUDFLARE_API_KEY;
    
    if (!accountId || !apiKey) {
      return res.status(500).json({
        success: false,
        message: 'Cloudflare credentials not configured'
      });
    }

    // Default to last 7 days if no date range provided
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    
    const start = req.query.start as string || startDate.toISOString();
    const end = req.query.end as string || endDate.toISOString();

    // GraphQL query for Core Web Vitals (LCP, INP, CLS)
    const query = `
      query CoreWebVitals($accountTag: string!, $start: Time!, $end: Time!) {
        viewer {
          accounts(filter: {accountTag: $accountTag}) {
            rumWebVitalsEventsAdaptiveGroups(
              filter: {
                datetime_geq: $start
                datetime_leq: $end
              }
              limit: 100
              orderBy: [datetime_DESC]
            ) {
              dimensions {
                datetime
                requestPath
                deviceType
                browserName
                countryName
              }
              quantiles {
                lcpP50
                lcpP75
                lcpP95
                inpP50
                inpP75
                inpP95
                clsP50
                clsP75
                clsP95
              }
              count
            }
          }
        }
      }
    `;

    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: accountId,
          start,
          end
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Cloudflare API error:', errorText);
      return res.status(response.status).json({
        success: false,
        message: 'Failed to fetch web vitals from Cloudflare',
        error: errorText
      });
    }

    const data = await response.json();
    
    // Check for GraphQL errors
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      return res.status(400).json({
        success: false,
        message: 'GraphQL query errors',
        errors: data.errors
      });
    }

    // Extract the web vitals data
    const webVitalsData = data?.data?.viewer?.accounts?.[0]?.rumWebVitalsEventsAdaptiveGroups || [];
    
    // Calculate aggregate metrics across all data points
    const aggregateMetrics = calculateAggregateMetrics(webVitalsData);
    
    res.json({
      success: true,
      period: { start, end },
      totalDataPoints: webVitalsData.length,
      aggregate: aggregateMetrics,
      details: webVitalsData,
      thresholds: {
        lcp: { good: 2500, needsImprovement: 4000 },
        inp: { good: 200, needsImprovement: 500 },
        cls: { good: 0.1, needsImprovement: 0.25 }
      }
    });
  } catch (error: any) {
    console.error('❌ Failed to get web vitals:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get web vitals'
    });
  }
});

// Helper function to calculate aggregate metrics
function calculateAggregateMetrics(dataPoints: any[]) {
  if (!dataPoints.length) {
    return {
      lcp: { p75: null, status: 'no_data' },
      inp: { p75: null, status: 'no_data' },
      cls: { p75: null, status: 'no_data' },
      totalSamples: 0
    };
  }

  // Weight by sample count
  let totalSamples = 0;
  let weightedLcp = 0;
  let weightedInp = 0;
  let weightedCls = 0;
  
  for (const point of dataPoints) {
    const count = point.count || 1;
    totalSamples += count;
    weightedLcp += (point.quantiles?.lcpP75 || 0) * count;
    weightedInp += (point.quantiles?.inpP75 || 0) * count;
    weightedCls += (point.quantiles?.clsP75 || 0) * count;
  }
  
  const avgLcp = totalSamples > 0 ? weightedLcp / totalSamples : 0;
  const avgInp = totalSamples > 0 ? weightedInp / totalSamples : 0;
  const avgCls = totalSamples > 0 ? weightedCls / totalSamples : 0;
  
  return {
    lcp: {
      p75: Math.round(avgLcp),
      status: avgLcp <= 2500 ? 'good' : avgLcp <= 4000 ? 'needs_improvement' : 'poor'
    },
    inp: {
      p75: Math.round(avgInp),
      status: avgInp <= 200 ? 'good' : avgInp <= 500 ? 'needs_improvement' : 'poor'
    },
    cls: {
      p75: Math.round(avgCls * 1000) / 1000, // 3 decimal places
      status: avgCls <= 0.1 ? 'good' : avgCls <= 0.25 ? 'needs_improvement' : 'poor'
    },
    totalSamples
  };
}

// POST /api/admin/performance/optimize - Run optimization
router.post('/optimize', async (req: Request, res: Response) => {
  try {
    const { type, action } = req.body;

    if (!type || !action) {
      return res.status(400).json({ 
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
    const job = performanceService.getOptimizationJob(jobId);

    if (!job) {
      return res.status(404).json({ 
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
