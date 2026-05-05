import { Router, Request, Response } from 'express';
import { IndexNowLog } from '../../shared/mongo-schemas';

const router = Router();

// GET /api/admin/indexnow/logs - Get recent IndexNow logs with pagination
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const host = req.query.host as string;
    const status = req.query.status as string;
    
    // Build query filter
    const filter: any = {};
    if (host && host !== 'all') {
      filter.host = host;
    }
    if (status && status !== 'all') {
      filter.status = status;
    }
    
    const logs = await IndexNowLog.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    
    res.json(logs);
  } catch (error) {
    console.error('Error fetching IndexNow logs:', error);
    res.status(500).json({ error: 'Failed to fetch IndexNow logs' });
  }
});

// GET /api/admin/indexnow/stats - Get IndexNow statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get all-time stats
    const totalSubmissions = await IndexNowLog.countDocuments();
    const successfulSubmissions = await IndexNowLog.countDocuments({ status: 'success' });
    const failedSubmissions = await IndexNowLog.countDocuments({ status: 'failed' });
    
    // Get today's submissions
    const submissionsToday = await IndexNowLog.countDocuments({
      timestamp: { $gte: today }
    });
    
    // Calculate success rate
    const successRate = totalSubmissions > 0 
      ? Math.round((successfulSubmissions / totalSubmissions) * 100) 
      : 0;
    
    // Get submissions by host
    const submissionsByHost = await IndexNowLog.aggregate([
      {
        $group: {
          _id: '$host',
          count: { $sum: 1 },
          successful: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    // Get submissions by trigger
    const submissionsByTrigger = await IndexNowLog.aggregate([
      {
        $group: {
          _id: '$trigger',
          count: { $sum: 1 },
          successful: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    // Get 7-day trend (submissions per day)
    const sevenDayTrend = await IndexNowLog.aggregate([
      {
        $match: {
          timestamp: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
          },
          count: { $sum: 1 },
          successful: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Calculate average response time
    const avgResponseTime = await IndexNowLog.aggregate([
      {
        $match: {
          responseTime: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: null,
          avgResponseTime: { $avg: '$responseTime' }
        }
      }
    ]);
    
    const stats = {
      totalSubmissions,
      successfulSubmissions,
      failedSubmissions,
      successRate,
      submissionsToday,
      submissionsByHost: submissionsByHost.map(item => ({
        host: item._id,
        count: item.count,
        successful: item.successful,
        failed: item.failed,
        successRate: item.count > 0 ? Math.round((item.successful / item.count) * 100) : 0
      })),
      submissionsByTrigger: submissionsByTrigger.map(item => ({
        trigger: item._id,
        count: item.count,
        successful: item.successful,
        failed: item.failed,
        successRate: item.count > 0 ? Math.round((item.successful / item.count) * 100) : 0
      })),
      sevenDayTrend: sevenDayTrend.map(item => ({
        date: item._id,
        count: item.count,
        successful: item.successful,
        failed: item.failed
      })),
      averageResponseTime: avgResponseTime.length > 0 ? Math.round(avgResponseTime[0].avgResponseTime) : 0
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Error fetching IndexNow stats:', error);
    res.status(500).json({ error: 'Failed to fetch IndexNow stats' });
  }
});

export default router;
