// This file contains shared schema types - using MongoDB with additional social auth support
// All validation is handled at the MongoDB schema level in shared/mongo-schemas.ts
import { z } from "zod/v4";

// Validation schemas for authentication
export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const signupSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  username: z.string().min(3, "Username must be at least 3 characters").regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Station rating validation schema
export const insertStationRatingSchema = z.object({
  stationId: z.string().min(1, "Station ID is required"),
  rating: z.number().min(1).max(5, "Rating must be between 1 and 5"),
  comment: z.string().optional(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  ipAddress: z.string().optional(),
});

// Station with country information (for MongoDB compatibility)
export interface StationWithCountry {
  _id: string;
  name: string;
  url: string;
  urlResolved?: string;
  favicon?: string;
  country?: string;
  countrycode?: string;
  countryCode?: string; // Alternative format for country code
  state?: string;
  language?: string;
  genre?: string;
  codec?: string;
  bitrate?: number;
  homepage?: string;
  tags?: string;
  slug?: string;
  hls?: boolean;
  votes?: number;
  clickCount?: number;
  lastCheckOk?: boolean;
  lastCheckTime?: string;
  // Multi-language descriptions field - matches original repository pattern
  descriptions?: { [locale: string]: string };
  // New rating fields
  averageRating?: number;
  totalRatings?: number;
  ratingBreakdown?: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
  // Logo assets for local optimization
  localImagePath?: string;
  logoAssets?: {
    folder: string;
    webp48?: string;
    webp96?: string;
    webp256?: string;
    original?: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    processedAt?: Date;
    error?: string;
  };
}

// Basic station validation schema for forms
export const insertStationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  url: z.string().url("Valid URL is required"),
  homepage: z.string().url().optional(),
  favicon: z.string().url().optional(),
  country: z.string().optional(),
  language: z.string().optional(),
  tags: z.string().optional(),
  codec: z.string().optional(),
  bitrate: z.number().optional(),
  votes: z.number().default(0),
  clickcount: z.number().default(0),
  lastcheckok: z.number().default(1),
  lastchecktime: z.date().default(() => new Date()),
  clicktimestamp: z.date().default(() => new Date()),
  changeuuid: z.string().default(""),
  iso_3166_2: z.string().optional(),
  geo_lat: z.number().default(0),
  geo_long: z.number().default(0),
  hasExtendedInfo: z.boolean().default(false),
});