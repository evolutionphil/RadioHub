import { lazy } from "react";

// Lazy load all route components for optimal code splitting and performance
// This reduces initial bundle size from ~1.8MB to <100KB

// Core radio/frontend pages - most visited
export const RadioFrontend = lazy(() => import("@/pages/radio-frontend"));
export const StationDetails = lazy(() => import("@/pages/stations/[id]"));
export const GenreDetail = lazy(() => import("@/pages/genres/[slug]"));
export const GenreLanding = lazy(() => import("@/pages/genres/genre-landing"));

// Recommendations and discovery
export const RecommendationsPage = lazy(() => import("@/pages/recommendations"));
export const TrendingStations = lazy(() => import("@/pages/TrendingStations"));

// Regions and locations
export const RegionsPage = lazy(() => import("@/pages/RegionsPage"));
export const RegionCountriesPage = lazy(() => import("@/pages/RegionCountriesPage"));
export const CountryCitiesPage = lazy(() => import("@/pages/CountryCitiesPage"));
export const RegionStationsPage = lazy(() => import("@/pages/RegionStationsPage"));
export const AustriaRadiosPage = lazy(() => import("@/pages/AustriaRadiosPage"));

// User profile and settings
export const UserProfile = lazy(() => import("@/pages/users/profile"));
export const UserProfilePage = lazy(() => import("@/pages/UserProfile"));
export const UsersIndex = lazy(() => import("@/pages/users/index"));
export const Profile = lazy(() => import("@/pages/profile"));
export const Favorites = lazy(() => import("@/pages/favorites"));
export const ProfileDiscover = lazy(() => import("@/pages/profile-discover"));
export const ProfileSettings = lazy(() => import("@/pages/profile-settings"));
export const NotificationSettings = lazy(() => import("@/pages/notifications"));
export const NotificationsView = lazy(() => import("@/pages/notifications-view"));
export const MessagesPage = lazy(() => import("@/pages/messages"));

// Authentication pages
export const Login = lazy(() => import("@/pages/login"));
export const Signup = lazy(() => import("@/pages/signup"));
export const SignupPage = lazy(() => import("@/pages/auth/signup"));
export const LoginPage = lazy(() => import("@/pages/auth/login"));
export const ForgotPasswordPage = lazy(() => import("@/pages/auth/forgot-password"));
export const ForgotPassword = lazy(() => import("@/pages/forgot-password"));
export const ResetPassword = lazy(() => import("@/pages/reset-password"));
export const ChangePassword = lazy(() => import("@/pages/change-password"));

// Static/info pages - rarely visited, high priority for code splitting
// Note: These pages use named exports, so we wrap them with default export adapters
export const About = lazy(() => import("@/pages/about").then(mod => ({ default: mod.About })));
export const Contact = lazy(() => import("@/pages/contact").then(mod => ({ default: mod.Contact })));
export const PublicFeedback = lazy(() => import("@/pages/feedback").then(mod => ({ default: mod.Feedback })));
export const Applications = lazy(() => import("@/pages/applications").then(mod => ({ default: mod.Applications })));
export const TermsAndConditions = lazy(() => import("@/pages/terms-and-conditions").then(mod => ({ default: mod.TermsAndConditions })));
export const PrivacyPolicy = lazy(() => import("@/pages/privacy-policy").then(mod => ({ default: mod.PrivacyPolicy })));
export const LLMsPage = lazy(() => import("@/pages/llms-page"));

// Genres - can be lazy loaded
export const GenresPage = lazy(() => import("@/pages/genres"));
export const Radios = lazy(() => import("@/pages/radios"));

// Station requests
export const RequestStation = lazy(() => import("@/pages/request-station"));

// Admin routes (already lazy loaded via lazy-admin-routes.tsx)
export const AdminLogin = lazy(() => import("@/pages/admin/login"));

// TV Login page
export const TvLogin = lazy(() => import("@/pages/tv-login"));

// 404 and error pages
export const NotFound = lazy(() => import("@/pages/not-found"));

export const ApiDocs = lazy(() => import("@/pages/api-docs"));
export const ApiUser = lazy(() => import("@/pages/api-user"));

// Keep these components that are used across many routes - don't lazy load
// - ProfileLayout (used in multiple profile routes)
// - ProtectedRoute (authentication wrapper)
// - AdminRoute (admin authentication wrapper)
// - GlobalPlayer (always visible)
// - Modals (AddYourStationModal, RequestStationModal) - small and frequently used
