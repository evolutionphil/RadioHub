import { describe, expect, it } from 'vitest';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { getProfileSettingsCopy, profileSettingsCopyCoverage } from '../src/lib/profile-settings-copy';
import { profileSettingsDefaults, profileSettingsPayload, profileSettingsSchema } from '../src/lib/profile-settings-form';

describe('profile settings localization', () => {
  it.each(ACTIVE_SITEMAP_LANGUAGES)('provides a complete native settings dictionary for %s', language => {
    const english = getProfileSettingsCopy('en');
    const translated = getProfileSettingsCopy(language);
    expect(profileSettingsCopyCoverage[language]).toBe(Object.keys(english).length);
    expect(Object.values(translated).every(text => typeof text === 'string' && text.trim())).toBe(true);
    if (language !== 'en') {
      expect(translated.intro).not.toBe(english.intro);
      expect(translated.playback).not.toBe(english.playback);
      expect(translated.saveFailed).not.toBe(english.saveFailed);
      expect(translated.notificationBlockedHint).not.toBe(english.notificationBlockedHint);
    }
  });
  it('uses current locale dictionary entries and skips untranslated English placeholders', () => {
    const copy = getProfileSettingsCopy('de-DE', { profile_settings_name: 'Dein Name', profile_settings_save: 'Save Changes', profile_settings_intro: '  ' });
    expect(copy.name).toBe('Dein Name');
    expect(copy.save).toBe('Änderungen speichern');
    expect(copy.intro).toBe('Dein Profil. Dein Radio.');
    expect(getProfileSettingsCopy('xx')).toEqual(getProfileSettingsCopy('en'));
  });
  it('ignores stale legacy auth labels and English profile messages in the German dictionary', () => {
    const copy = getProfileSettingsCopy('de', { auth_full_name: 'Auth Vollständiger Name', profile_updated_successfully: 'Profile updated successfully', public_profile: 'Public Profile' });
    expect(copy.name).toBe('Vollständiger Name');
    expect(copy.saved).toBe('Deine Änderungen wurden gespeichert.');
    expect(copy.publicProfile).toBe('Öffentliches Profil');
  });
});

describe('profile settings payload', () => {
  const copy = getProfileSettingsCopy('de');
  const defaults = { ...profileSettingsDefaults(null), name: '  Alice  ', email: ' alice@example.test ' };
  it('omits a whitespace-only password, normalizes names and retains the backend preference contract', () => {
    const parsed = profileSettingsSchema(copy).parse({ ...defaults, password: '        ', is_public_profile: true, is_autoplay_at_login: true, play_at_login: 'FAVORITE', language: 'he' });
    expect(profileSettingsPayload(parsed)).toEqual({
      fullName: 'Alice', email: 'alice@example.test', location: '', isPublicProfile: true,
      preferences: { language: 'he', autoplay: true, playAtLogin: 'FAVORITE' },
    });
  });
  it('preserves intentional whitespace in a real password and rejects UTF-8 values over72 bytes', () => {
    const schema = profileSettingsSchema(copy);
    expect(profileSettingsPayload(schema.parse({ ...defaults, password: ' new password ' })).password).toBe(' new password ');
    expect(schema.safeParse({ ...defaults, password: 'é'.repeat(36) }).success).toBe(true);
    const result = schema.safeParse({ ...defaults, password: 'é'.repeat(37) });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe(copy.passwordInvalid);
  });
  it('normalizes an unknown stored playback value to the supported default', () => {
    expect(profileSettingsDefaults({ preferences: { playAtLogin: 'legacy', autoplay: false } } as any).play_at_login).toBe('LAST_PLAYED');
    expect(profileSettingsDefaults({ preferences: { language: 'de-AT' } } as any).language).toBe('de');
    expect(profileSettingsDefaults({ preferences: { language: 'unknown-language' } } as any).language).toBe('en');
  });
});
