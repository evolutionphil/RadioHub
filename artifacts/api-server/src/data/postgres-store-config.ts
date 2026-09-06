export function validatePostgresStoreConfiguration(environment: NodeJS.ProcessEnv = process.env): void {
  for (const name of ["USER_STORE","AUTH_STORE","ENGAGEMENT_STORE","NOTIFICATION_STORE","MESSAGE_STORE","BILLING_STORE","LOCALIZATION_STORE","SESSION_STORE","STATION_WRITE_MODE","STATION_READ_MODE"]) {
    if (environment[name] && environment[name]!.toLowerCase() !== "postgres") {
      throw new Error(`${name}=${environment[name]} is no longer supported; the application is PostgreSQL-only. Remove this legacy flag or set postgres.`);
    }
  }
  if (environment.STATION_CDC_ENABLED === "true") {
    throw new Error("STATION_CDC_ENABLED=true is forbidden in PostgreSQL-only runtime; offline import is a separate command");
  }
  if (environment.DATABASE_MIGRATION_MODE && environment.DATABASE_MIGRATION_MODE !== "off") {
    throw new Error("DATABASE_MIGRATION_MODE is no longer a runtime switch; run the offline migration command before startup");
  }
}
