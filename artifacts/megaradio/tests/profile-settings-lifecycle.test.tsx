import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProfileSettings from '../src/pages/profile-settings';

const fixture = vi.hoisted(() => ({ user: {} as any, request: vi.fn(), toast: vi.fn(), language: 'de', subscribe: vi.fn(), unsubscribe: vi.fn(), sendTest: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock('@/components/auth/ProtectedRoute', () => ({ ProtectedRoute: ({ children }: any) => children }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: fixture.toast }) }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => ({ isSupported: true, isSubscribed: false, permission: 'default', isLoading: false, subscribe: fixture.subscribe, unsubscribe: fixture.unsubscribe, sendTestNotification: fixture.sendTest }) }));
vi.mock('@/components/ManageSubscriptionButton', () => ({ ManageSubscriptionButton: () => <button>Manage subscription</button> }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: fixture.language, localeTranslations: {} }) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: (...args: any[]) => fixture.request(...args), oauthBearerHeader: () => ({ Authorization: 'Bearer fixture-only' }), resolveApiUrl: (url: string) => url }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>, SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <span data-language-option={value}>{children}</span>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>, SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}));
const user = (id = 'alice') => ({ _id: id, fullName: id === 'alice' ? 'Alice' : 'Bob', email: `${id}@example.test`, avatar: `/${id}.png`, preferences: { language: 'de', autoplay: false, playAtLogin: 'RANDOM' }, isPublicProfile: true });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); fixture.user = user(); fixture.language = 'de';
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => [] }, mutations: { retry: false } } });
  fixture.request.mockResolvedValue({ json: async () => ({ user: fixture.user }) });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:pending-avatar') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const mount = () => render(<ProfileSettings />, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });

it('keeps dirty name/privacy when same account refreshes and resets on account switch', async () => {
  const view = mount();
  fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: 'Unsaved edit' } });
  const privacy = screen.getByRole('switch', { name: 'Öffentliches Profil' });
  fireEvent.click(privacy);
  fixture.user = { ...user(), followersCount: 3 }; view.rerender(<ProfileSettings />);
  expect(screen.getByLabelText('Vollständiger Name')).toHaveValue('Unsaved edit');
  expect(screen.getByRole('switch', { name: 'Öffentliches Profil' })).toHaveAttribute('aria-checked', 'false');
  fixture.user = user('bob'); view.rerender(<ProfileSettings />);
  expect(screen.getByLabelText('Vollständiger Name')).toHaveValue('Bob');
  expect(screen.getByLabelText('E-Mail')).toHaveValue('bob@example.test');
});
it('preserves draft and shows failure rather than false success; deduplicates pending submits', async () => {
  const save = deferred<any>(); fixture.request.mockReturnValue(save.promise); mount();
  fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: 'Draft' } });
  const form = screen.getByRole('button', { name: 'Änderungen speichern' }).closest('form')!;
  fireEvent.submit(form); fireEvent.submit(form);
  await waitFor(() => expect(fixture.request).toHaveBeenCalledTimes(1));
  await act(async () => save.reject(new Error('500: update unavailable')));
  await waitFor(() => expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
  expect(screen.getByLabelText('Vollständiger Name')).toHaveValue('Draft'); expect(fixture.toast).toHaveBeenCalledTimes(1);
});
it('late previous-account save cannot reset new account or issue success notification', async () => {
  const save = deferred<any>(); fixture.request.mockReturnValue(save.promise); const view = mount();
  fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: 'Old account draft' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Änderungen speichern' }).closest('form')!);
  await waitFor(() => expect(fixture.request).toHaveBeenCalledTimes(1));
  fixture.user = user('bob'); view.rerender(<ProfileSettings />);
  await act(async () => save.resolve({ json: async () => ({ user: user() }) }));
  expect(screen.getByLabelText('Vollständiger Name')).toHaveValue('Bob'); expect(fixture.toast).not.toHaveBeenCalled();
});
it('keeps edits typed during a pending successful save', async () => {
  const save = deferred<any>(); fixture.request.mockReturnValue(save.promise); mount();
  fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: 'Submitted name' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Änderungen speichern' }).closest('form')!);
  await waitFor(() => expect(fixture.request).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: 'Newer draft' } });
  await act(async () => save.resolve({ json: async () => ({ user: user() }) }));
  expect(screen.getByLabelText('Vollständiger Name')).toHaveValue('Newer draft');
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen verwerfen' }));
  expect(screen.getByLabelText('Vollständiger Name')).toHaveValue('Submitted name');
});
it('rejects too-short password locally and exposes error', async () => {
  mount(); fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'short' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Änderungen speichern' }).closest('form')!);
  await screen.findByRole('alert'); expect(fixture.request).not.toHaveBeenCalled();
});
it('uploads to actual authenticated avatar endpoint and rolls back failed preview', async () => {
  const upload = deferred<Response>(); const fetchMock = vi.fn(() => upload.promise); vi.stubGlobal('fetch', fetchMock);
  mount(); const original = document.createElement.bind(document); let picker: HTMLInputElement;
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options: any) => { const element = original(tag, options); if (tag === 'input') picker = element as HTMLInputElement; return element; }) as any);
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Profilbild ändern' }));
  Object.defineProperty(picker!, 'files', { configurable: true, value: [new File(['image'], 'avatar.png', { type: 'image/png' })] });
  fireEvent.change(picker!);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(fetchMock.mock.calls[0][0]).toBe('/api/user/avatar');
  expect((fetchMock.mock.calls[0] as any)[1].headers).toEqual({ Authorization: 'Bearer fixture-only' });
  expect(screen.getByAltText('Alice')).toHaveAttribute('src', 'blob:pending-avatar');
  await act(async () => upload.resolve(new Response(JSON.stringify({ error: 'Upload failed' }), { status: 500 })));
  await waitFor(() => expect(screen.getByAltText('Alice')).toHaveAttribute('src', '/alice.png'));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pending-avatar');
});
it('offers all14 supported profile language values instead of only five', () => {
  const view = mount();
  expect([...view.container.querySelectorAll('[data-language-option]')].map(x => x.getAttribute('data-language-option')).sort())
    .toEqual(['en','es','fr','de','pt','it','ru','ar','zh','tr','ja','ko','hi','he'].sort());
  expect(screen.getByLabelText('Zufälliger Sender')).toBeChecked();
});
it('shows subscription management only for an existing plan and outside the profile save form', () => {
  const view = mount(); expect(screen.queryByText('Manage subscription')).not.toBeInTheDocument();
  fixture.user = { ...user(), subscription: { plan: 'premium_monthly' } }; view.rerender(<ProfileSettings />);
  expect(screen.getByText('Manage subscription').closest('form')).toBeNull();
});

it('keeps immediate notification actions outside the profile form and preserves the draft', async () => {
  mount();
  fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: 'Unsaved' } });
  const enable = screen.getByRole('button', { name: 'Benachrichtigungen aktivieren' });
  expect(enable.closest('form')).toBeNull();
  expect(enable).toHaveAttribute('type', 'button');
  fireEvent.click(enable);
  await waitFor(() => expect(fixture.subscribe).toHaveBeenCalledTimes(1));
  expect(fixture.request).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Vollständiger Name')).toHaveValue('Unsaved');
});

it('saves toggles with the supported playback contract and clears normalized drafts', async () => {
  mount();
  expect(screen.getByRole('button', { name: 'Änderungen speichern' })).toBeDisabled();
  expect(screen.getByLabelText('Favorit')).toBeDisabled();
  fireEvent.click(screen.getByRole('switch', { name: 'Automatische Wiedergabe' }));
  expect(screen.getByLabelText('Favorit')).toBeEnabled();
  fireEvent.click(screen.getByLabelText('Favorit'));
  fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: '  New name  ' } });
  fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: '        ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await waitFor(() => expect(fixture.request).toHaveBeenCalledWith('PUT', '/api/auth/profile', { body: {
    fullName: 'New name', email: 'alice@example.test', location: '', isPublicProfile: true,
    preferences: { language: 'de', autoplay: true, playAtLogin: 'FAVORITE' },
  } }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Änderungen speichern' })).toBeDisabled());
  expect(screen.getByLabelText('Vollständiger Name')).toHaveValue('New name');
  expect(screen.getByLabelText('Passwort')).toHaveValue('');
  expect(fixture.toast).toHaveBeenCalledTimes(1);
});

it('can discard changes without sending a request', () => {
  mount();
  fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: 'Discard this' } });
  fireEvent.click(screen.getByRole('switch', { name: 'Öffentliches Profil' }));
  fireEvent.click(screen.getByRole('button', { name: 'Änderungen verwerfen' }));
  expect(screen.getByLabelText('Vollständiger Name')).toHaveValue('Alice');
  expect(screen.getByRole('switch', { name: 'Öffentliches Profil' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Änderungen speichern' })).toBeDisabled();
  expect(fixture.request).not.toHaveBeenCalled();
});

it('restores the last successful avatar when a second upload fails before user data refresh', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ avatar: '/new-avatar.webp' }))).mockResolvedValueOnce(new Response('not json', { status: 500 }));
  vi.stubGlobal('fetch', fetchMock); mount();
  const original = document.createElement.bind(document); let picker: HTMLInputElement;
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options: any) => { const element = original(tag, options); if (tag === 'input') picker = element as HTMLInputElement; return element; }) as any);
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  const selectFile = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Profilbild ändern' }));
    Object.defineProperty(picker!, 'files', { configurable: true, value: [new File(['image'], 'avatar.png', { type: 'image/png' })] });
    fireEvent.change(picker!);
  };
  selectFile();
  await waitFor(() => expect(screen.getByAltText('Alice')).toHaveAttribute('src', '/new-avatar.webp'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Profilbild ändern' })).toBeEnabled());
  selectFile();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(fixture.toast).toHaveBeenLastCalledWith(expect.objectContaining({ variant: 'destructive' })));
  expect(screen.getByAltText('Alice')).toHaveAttribute('src', '/new-avatar.webp');
});

it('uses native Arabic labels and RTL form flow', () => {
  fixture.language = 'ar'; const view = mount();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ملفك الشخصي. راديوك.');
  expect(view.container.querySelector('[dir="rtl"]')).toBeInTheDocument();
  expect(screen.getByLabelText('الاسم الكامل')).toHaveValue('Alice');
  expect(screen.getByLabelText('البريد الإلكتروني')).toHaveAttribute('dir', 'ltr');
  expect(screen.queryByText('Play at log in')).not.toBeInTheDocument();
});
