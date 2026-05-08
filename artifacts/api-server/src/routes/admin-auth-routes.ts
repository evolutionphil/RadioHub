import { type Express } from "express";
import { logger } from '../utils/logger';

export function registerAdminAuthRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // ADMIN LOGIN API
  app.post("/api/admin/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

      if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
        logger.error('🚨 ADMIN_USERNAME / ADMIN_PASSWORD env vars are not set — admin login disabled');
        return void res.status(503).json({ error: 'Admin authentication is not configured' });
      }

      if (!username || !password) {
        return void res.status(400).json({ error: "Username and password required" });
      }

      // Constant-time comparison (avoid string !== timing side-channel)
      const crypto = await import('crypto');
      const expectU = Buffer.from(ADMIN_USERNAME);
      const gotU = Buffer.from(String(username));
      const expectP = Buffer.from(ADMIN_PASSWORD);
      const gotP = Buffer.from(String(password));
      const uOk = expectU.length === gotU.length && crypto.default.timingSafeEqual(expectU, gotU);
      const pOk = expectP.length === gotP.length && crypto.default.timingSafeEqual(expectP, gotP);
      if (!uOk || !pOk) {
        return void res.status(401).json({ error: "Invalid admin credentials" });
      }

      const adminAuthData = {
        username: ADMIN_USERNAME,
        role: 'admin',
        loginTime: new Date()
      };
      
      (req.session as any).adminAuth = adminAuthData;
      
      req.session.save((err) => {
        if (err) {
          logger.error('❌ Session save error:', err);
          return void res.status(500).json({ error: 'Session save failed' });
        }
        logger.log('✅ Admin login successful - Session ID:', req.sessionID);
        logger.log('✅ Admin auth data stored:', adminAuthData);

        res.json({ 
          success: true, 
          message: "Admin login successful",
          user: {
            username: ADMIN_USERNAME,
            role: 'admin'
          }
        });
      });
    } catch (error) {
      console.error('❌ Admin login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // ADMIN LOGOUT API
  app.post("/api/admin/logout", requireAdmin, (req, res) => {
    try {
      (req.session as any).adminAuth = null;
      res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  // ADMIN AUTH CHECK API
  app.get("/api/admin/auth/me", requireAdmin, (req, res) => {
    try {
      const adminAuth = (req.session as any).adminAuth;
      logger.log('🔍 Admin auth check - Session ID:', req.sessionID);
      
      if (adminAuth) {
        res.json({
          user: {
            username: adminAuth.username,
            role: adminAuth.role
          },
          authenticated: true
        });
      } else {
        // This part should technically not be reached with requireAdmin middleware
        // as requireAdmin already returns 401 for missing adminAuth
        res.json({
          user: null,
          authenticated: false
        });
      }
    } catch (error: any) {
      logger.error(`❌ Admin auth check error: ${error.message}`);
      res.status(500).json({ error: 'Admin auth check failed' });
    }
  });
}
