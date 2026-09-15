import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { URL_TRANSLATIONS } from '@workspace/seo-shared/url-translations';
const state = vi.hoisted(() => ({ location: '/de/users/listener', translations: {} as Record<string, string> }));
vi.mock('wouter', () => ({ useLocation: () => [state.location], Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ localeTranslations: state.translations, t: (key: string, fallback: string) => ({ nav_users: 'Users', nav_profile: 'Profile', nav_settings: 'Settings' }[key] || fallback) }) }));
import { RouteBreadcrumbs } from '@/components/RouteBreadcrumbs';
afterEach(() => { cleanup(); state.translations = {}; });

const labels = [
  ['en', 'Listeners', 'Profile', 'Settings'], ['de', 'Hörer', 'Profil', 'Einstellungen'],
  ['tr', 'Dinleyiciler', 'Profil', 'Ayarlar'], ['es', 'Oyentes', 'Perfil', 'Configuración'],
  ['fr', 'Auditeurs', 'Profil', 'Paramètres'], ['pt', 'Ouvintes', 'Perfil', 'Configurações'],
  ['it', 'Ascoltatori', 'Profilo', 'Impostazioni'], ['ru', 'Слушатели', 'Профиль', 'Настройки'],
  ['ar', 'المستمعون', 'الملف الشخصي', 'الإعدادات'], ['zh', '听众', '个人资料', '设置'],
  ['ja', 'リスナー', 'プロフィール', '設定'], ['ko', '청취자', '프로필', '설정'],
  ['hi', 'श्रोता', 'प्रोफ़ाइल', 'सेटिंग'], ['he', 'מאזינים', 'פרופיל', 'הגדרות'],
];

it.each(labels)('%s account breadcrumb uses localized fallbacks and keeps translated hrefs', (language, users, profile, settings) => {
  const route = URL_TRANSLATIONS[language] || {};
  state.location = `/${language}/${route.users || 'users'}/listener`;
  const view = render(<RouteBreadcrumbs />);
  expect(screen.getByRole('link', { name: users })).toHaveAttribute('href', `/${language}/${route.users || 'users'}`);
  expect(screen.getByRole('navigation')).not.toHaveClass('lg:pl-[272px]');
  state.location = `/${language}/${route.profile || 'profile'}/${route.settings || 'settings'}`;
  view.rerender(<RouteBreadcrumbs />);
  expect(screen.getByRole('link', { name: profile })).toHaveAttribute('href', `/${language}/${route.profile || 'profile'}`);
  expect(screen.getByRole('link', { name: settings })).toHaveAttribute('href', state.location);
  expect(screen.getByRole('navigation')).toHaveClass('lg:pl-[272px]');
});

it('respects current-locale account labels ahead of fallbacks', () => {
  state.location = '/de/users/listener'; state.translations = { nav_users: 'Radio-Community' };
  render(<RouteBreadcrumbs />);
  expect(screen.getByRole('link', { name: 'Radio-Community' })).toBeInTheDocument();
  expect(screen.queryByText('Users')).not.toBeInTheDocument();
});
