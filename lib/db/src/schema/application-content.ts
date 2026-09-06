import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
const ts = (name: string) => timestamp(name, { withTimezone: true });
export const advertisements = pgTable(
  "advertisements",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    imageUrl: text("image_url").notNull(),
    altText: text("alt_text").notNull().default(""),
    seoDescription: text("seo_description").notNull().default(""),
    url: text("url").notNull(),
    position: text("position").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("advertisements_active_position").on(
      t.isActive,
      t.position,
      t.createdAt.desc(),
    ),
    check(
      "advertisements_position_check",
      sql`${t.position} IN ('desktop_sidebar','mobile_bottom','middle_section')`,
    ),
  ],
);
export const footerSocialMedia = pgTable(
  "footer_social_media",
  {
    id: text("id").primaryKey(),
    platform: text("platform").notNull(),
    url: text("url").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("footer_social_media_active_position").on(t.isActive, t.position),
    check(
      "footer_social_media_platform_check",
      sql`${t.platform} IN ('facebook','instagram','twitter','linkedin','whatsapp','telegram','reddit','pinterest','youtube','tiktok')`,
    ),
  ],
);
export const seoMetadata = pgTable(
  "seo_metadata",
  {
    id: text("id").primaryKey(),
    pageType: text("page_type").notNull(),
    routeKey: text("route_key").notNull(),
    language: text("language").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    ogTitle: text("og_title"),
    ogDescription: text("og_description"),
    ogImageUrl: text("og_image_url"),
    twitterTitle: text("twitter_title"),
    twitterDescription: text("twitter_description"),
    twitterImageUrl: text("twitter_image_url"),
    canonicalUrl: text("canonical_url"),
    metaKeywords: text("meta_keywords"),
    noIndex: boolean("no_index").notNull().default(false),
    noFollow: boolean("no_follow").notNull().default(false),
    source: text("source").notNull().default("manual"),
    status: text("status").notNull().default("draft"),
    updatedBy: text("updated_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.pageType, t.routeKey, t.language),
    index("seo_metadata_status").on(t.pageType, t.status, t.language),
    check(
      "seo_metadata_page_type_check",
      sql`${t.pageType} IN ('homepage','genre_list','genre_detail','station_detail','country_list','country_detail','region','search','static')`,
    ),
    check(
      "seo_metadata_source_check",
      sql`${t.source} IN ('manual','ai_generated','template')`,
    ),
    check(
      "seo_metadata_status_check",
      sql`${t.status} IN ('draft','published')`,
    ),
  ],
);
export const appLogs = pgTable(
  "app_logs",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id").notNull(),
    appVersion: text("app_version").notNull(),
    buildNumber: text("build_number").notNull().default(""),
    platform: text("platform").notNull(),
    logs: jsonb("logs").notNull().default([]),
    apiKeyHash: text("api_key_hash").notNull().default(""),
    isCarPlayLog: boolean("is_car_play_log").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("app_logs_created").on(t.createdAt.desc()),
    index("app_logs_owner_created").on(t.apiKeyHash, t.createdAt.desc()),
    index("app_logs_platform_created").on(t.platform, t.createdAt.desc()),
    index("app_logs_device_created").on(t.deviceId, t.createdAt.desc()),
    index("app_logs_entries").using("gin", t.logs.op("jsonb_path_ops")),
    check("app_logs_platform_check", sql`${t.platform} IN ('ios','android')`),
    check("app_logs_logs_check", sql`jsonb_typeof(${t.logs})='array'`),
  ],
);
export const feedback = pgTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    email: text("email"),
    userId: text("user_id"),
    status: text("status").notNull().default("open"),
    response: text("response"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    index("feedback_status_created").on(t.status, t.createdAt.desc()),
    index("feedback_user_created").on(t.userId, t.createdAt.desc()),
    index("feedback_type_status").on(t.type, t.status),
    check("feedback_type_check", sql`${t.type} IN ('bug','feature','general')`),
    check(
      "feedback_status_check",
      sql`${t.status} IN ('open','in-progress','resolved','closed')`,
    ),
  ],
);
