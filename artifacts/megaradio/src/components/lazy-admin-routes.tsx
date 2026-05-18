import { lazy } from "react";

// Lazy load admin components for better code splitting
export const AdminDashboard = lazy(() => import("@/pages/admin/dashboard"));
export const Stations = lazy(() => import("@/pages/stations"));
export const AdminStationSlugs = lazy(() => import("@/pages/admin-station-slugs"));
export const AdminDuplicates = lazy(() => import("@/pages/admin/duplicates"));
export const AdminCities = lazy(() => import("@/pages/admin/cities"));
export const AdminPerformance = lazy(() => import("@/pages/admin/performance"));
export const AdminGenresPage = lazy(() => import("@/pages/admin/admin-genres"));
export const AdminGenreWhitelist = lazy(() => import("@/pages/admin/admin-genre-whitelist"));
export const AdminGenreSlugCleanup = lazy(() => import("@/pages/admin/genre-slug-cleanup"));
export const Codecs = lazy(() => import("@/pages/codecs"));
export const SyncStatus = lazy(() => import("@/pages/sync"));
export const RadioBrowser = lazy(() => import("@/pages/radio-browser"));
export const Analytics = lazy(() => import("@/pages/analytics"));
export const AdminFeedback = lazy(() => import("@/pages/admin/feedback"));
export const StatusMonitoring = lazy(() => import("@/pages/status-monitoring"));
export const Settings = lazy(() => import("@/pages/settings"));
export const AdminTranslations = lazy(() => import("@/pages/admin/translations"));
export const AdminTranslationLanguages = lazy(() => import("@/pages/admin/translation-languages"));
export const AdminErrorLogs = lazy(() =>
  import("@/pages/admin-error-logs").then((m) => ({ default: m.AdminErrorLogs })),
);
export const AdminCountryLanguageMappings = lazy(() => import("@/pages/admin/AdminCountryLanguageMappings"));
export const AdminUrlTranslations = lazy(() => import("@/pages/admin/AdminUrlTranslations"));
export const AdminSeoPreview = lazy(() => import("@/pages/admin/seo-preview"));
export const IndexNowMonitoring = lazy(() => import("@/pages/admin/IndexNowMonitoring"));
export const GscInspection = lazy(() => import("@/pages/admin/gsc-inspection"));
export const Advertisements = lazy(() => import("@/pages/admin/advertisements"));
export const FooterSocialMedia = lazy(() => import("@/pages/admin/footer-social-media"));
export const AdminUsers = lazy(() => import("@/pages/admin/admin-users"));
export const LogoManagement = lazy(() => import("@/pages/admin/logo-management"));
export const HomeSettings = lazy(() => import("@/pages/admin/home-settings"));
export const DbManagement = lazy(() => import("@/pages/admin/db-management"));
export const AdminIapEvents = lazy(() => import("@/pages/admin/iap-events"));
export const AdminSeoMaintenance = lazy(() => import("@/pages/admin/seo-maintenance"));
export const AdminSeoMaintenanceRun = lazy(() => import("@/pages/admin/seo-maintenance-run"));
export const SeoTranslationsHub = lazy(() => import("@/pages/admin/seo-translations"));
export const SemrushIssues = lazy(() => import("@/pages/admin/semrush-issues"));
export const AdminCoverage = lazy(() => import("@/pages/admin/coverage"));
export const AdminCoverageCountry = lazy(() => import("@/pages/admin/coverage-country"));
export const AdminCoverageCompare = lazy(() => import("@/pages/admin/coverage-compare"));
