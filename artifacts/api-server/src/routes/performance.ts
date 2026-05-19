import { Router, Request, Response } from 'express';
import { performanceService } from '../services/performance-service';

const router = Router();

// GET /api/admin/performance/web-vitals - Get Core Web Vitals from Cloudflare RUM
router.get('/web-vitals', async (req: Request, res: Response) => {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiKey = process.env.CLOUDFLARE_API_KEY;
    
    if (!accountId || !apiKey) {
      return void res.status(500).json({
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
      return void res.status(response.status).json({
        success: false,
        message: 'Failed to fetch web vitals from Cloudflare',
        error: errorText
      });
    }

    const data: any = await response.json();
    
    // Check for GraphQL errors
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      return void res.status(400).json({
        success: false,
        message: 'GraphQL query errors',
        errors: data.errors
      });
    }

    // Extract the web vitals data
    const webVitalsData = data?.data?.viewer?.accounts?.[0]?.rumWebVitalsEventsAdaptiveGroups || [];

    // Calculate aggregate metrics (P50/P75/P95) per vital across all data points
    const vitals = calculateWebVitals(webVitalsData);

    res.json({
      success: true,
      period: { start, end },
      totalSamples: vitals.totalSamples,
      lcp: vitals.lcp,
      inp: vitals.inp,
      cls: vitals.cls,
      lastUpdated: new Date().toISOString(),
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

type VitalStatus = 'good' | 'needs_improvement' | 'poor' | 'no_data';
interface VitalAggregate { p50: number | null; p75: number | null; p95: number | null; status: VitalStatus }

function emptyVital(): VitalAggregate {
  return { p50: null, p75: null, p95: null, status: 'no_data' };
}

function weightedAverage(dataPoints: any[], field: string): number {
  let totalSamples = 0;
  let weighted = 0;
  for (const point of dataPoints) {
    const count = point.count || 1;
    const value = point.quantiles?.[field];
    if (typeof value !== 'number') continue;
    totalSamples += count;
    weighted += value * count;
  }
  return totalSamples > 0 ? weighted / totalSamples : 0;
}

function classify(p75: number, goodMax: number, niMax: number): VitalStatus {
  if (p75 <= goodMax) return 'good';
  if (p75 <= niMax) return 'needs_improvement';
  return 'poor';
}

function calculateWebVitals(dataPoints: any[]) {
  if (!dataPoints.length) {
    return { totalSamples: 0, lcp: emptyVital(), inp: emptyVital(), cls: emptyVital() };
  }

  const totalSamples = dataPoints.reduce((sum, p) => sum + (p.count || 1), 0);

  // LCP / INP in milliseconds (rounded)
  const lcpP50 = Math.round(weightedAverage(dataPoints, 'lcpP50'));
  const lcpP75 = Math.round(weightedAverage(dataPoints, 'lcpP75'));
  const lcpP95 = Math.round(weightedAverage(dataPoints, 'lcpP95'));

  const inpP50 = Math.round(weightedAverage(dataPoints, 'inpP50'));
  const inpP75 = Math.round(weightedAverage(dataPoints, 'inpP75'));
  const inpP95 = Math.round(weightedAverage(dataPoints, 'inpP95'));

  // CLS is a unitless score (3 decimal places)
  const clsP50 = Math.round(weightedAverage(dataPoints, 'clsP50') * 1000) / 1000;
  const clsP75 = Math.round(weightedAverage(dataPoints, 'clsP75') * 1000) / 1000;
  const clsP95 = Math.round(weightedAverage(dataPoints, 'clsP95') * 1000) / 1000;

  return {
    totalSamples,
    lcp: { p50: lcpP50, p75: lcpP75, p95: lcpP95, status: classify(lcpP75, 2500, 4000) },
    inp: { p50: inpP50, p75: inpP75, p95: inpP95, status: classify(inpP75, 200, 500) },
    cls: { p50: clsP50, p75: clsP75, p95: clsP95, status: classify(clsP75, 0.1, 0.25) },
  };
}

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
    const job = performanceService.getOptimizationJob(jobId as string);

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
