import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // PERF: Manual chunking to reduce HTTP/2 head-of-line blocking
    // Default Vite splitting created 177 chunks (121 ≤8KB) — each lucide icon was its own file.
    // Grouping vendor libs preserves tree-shaking but cuts request count drastically.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor';
          if (id.includes('@tanstack/react-query')) return 'query-vendor';
          if (id.includes('/wouter/') || id.includes('/wouter-')) return 'router-vendor';
          if (id.includes('@radix-ui')) return 'radix-vendor';
          if (id.includes('/lucide-react/')) return 'icons-vendor';
          if (id.includes('/hls.js/') || id.includes('/plyr/') || id.includes('/swiper/')) return 'media-vendor';
          if (id.includes('react-hook-form') || id.includes('@hookform/') || id.includes('/zod/')) return 'forms-vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
