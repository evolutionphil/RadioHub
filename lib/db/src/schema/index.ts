// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

export * from "./schema";
export * from "./relational";
export * from "./api-access";
export * from "./catalog-writes";
export * from "./tv-cast";
export * from "./seo-indexing";
export * from "./recommendation-state";
export * from "./taxonomy-runtime";
export * from "./runtime-operations";
export * from "./application-content";
export * from "./coverage-operations";
export * from "./station-debug";
export * from "./admin-maintenance";
export * from "./admin-auxiliary";
export * from "./genre-merge-audit";
export * from "./cleanup-state";
