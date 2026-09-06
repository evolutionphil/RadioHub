import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
const ts = (name: string) => timestamp(name, { withTimezone: true });
export const adminMaintenanceJobs = pgTable(
  "admin_maintenance_jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("running"),
    ownerToken: text("owner_token").notNull(),
    payload: jsonb("payload").notNull().default({}),
    startedAt: ts("started_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
    leaseUntil: ts("lease_until")
      .notNull()
      .default(sql`now()+interval '2 minutes'`),
  },
  (t) => [
    uniqueIndex("admin_maintenance_one_active_kind")
      .on(t.kind)
      .where(sql`${t.status}='running'`),
    index("admin_maintenance_recent").on(t.kind, t.startedAt.desc()),
    check(
      "admin_maintenance_jobs_kind_check",
      sql`${t.kind} IN ('slug','optimization','health_check')`,
    ),
    check(
      "admin_maintenance_jobs_status_check",
      sql`${t.status} IN ('running','completed','failed','stopped')`,
    ),
  ],
);
