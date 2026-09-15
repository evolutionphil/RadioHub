import { z } from 'zod';
import type { User } from '@/hooks/useAuth';
import type { ProfileSettingsCopy } from './profile-settings-copy';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';

export function profileSettingsSchema(copy: ProfileSettingsCopy) {
  return z.object({
    name: z.string().trim().min(1, copy.nameInvalid).max(200, copy.nameInvalid),
    email: z.string().trim().email(copy.emailInvalid).max(254, copy.emailInvalid),
    password: z.string().refine(value => !value.trim() || (value.length >= 8 && new TextEncoder().encode(value).length <= 72), copy.passwordInvalid).optional(),
    country: z.string().optional(), language: z.string().optional(),
    is_public_profile: z.boolean(), is_autoplay_at_login: z.boolean(),
    play_at_login: z.enum(['LAST_PLAYED', 'RANDOM', 'FAVORITE']),
  });
}
export type ProfileSettingsData = z.infer<ReturnType<typeof profileSettingsSchema>>;
export type SettingsUser = User & {
  isPublicProfile?: boolean;
  preferences?: { language?: string; autoplay?: boolean; playAtLogin?: string };
  subscription?: { plan?: string };
};

export function profileSettingsDefaults(user: SettingsUser | null | undefined): ProfileSettingsData {
  const playAtLogin = user?.preferences?.playAtLogin;
  const preferredLanguage = user?.preferences?.language?.toLowerCase().split('-')[0];
  return {
    name: user?.fullName || '', email: user?.email || '', password: '', country: user?.location || '',
    language: ACTIVE_SITEMAP_LANGUAGES.some(code => code === preferredLanguage) ? preferredLanguage : 'en', is_public_profile: user?.isPublicProfile || false,
    is_autoplay_at_login: user?.preferences?.autoplay || false,
    play_at_login: playAtLogin === 'RANDOM' || playAtLogin === 'FAVORITE' ? playAtLogin : 'LAST_PLAYED',
  };
}

export function profileSettingsPayload(data: ProfileSettingsData) {
  return {
    fullName: data.name, email: data.email, location: data.country, isPublicProfile: data.is_public_profile,
    preferences: { language: data.language, autoplay: data.is_autoplay_at_login, playAtLogin: data.play_at_login },
    // Blank includes whitespace, matching validation and the field's promise.
    ...(data.password?.trim() ? { password: data.password } : {}),
  };
}
