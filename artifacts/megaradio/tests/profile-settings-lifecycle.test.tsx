import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProfileSettings from '../src/pages/profile-settings';

const fixture = vi.hoisted(() => ({ user: {} as any, request: vi.fn(), toast: vi.fn(), success: vi.fn(), failure: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock('@/components/auth/ProtectedRoute', () => ({ ProtectedRoute: ({ children }: any) => children }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: fixture.toast }) }));
vi.mock('@/services/NotificationService', () => ({ useNotificationService: () => ({ profileUpdated: fixture.success, profileUpdateFailed: fixture.failure }) }));
vi.mock('@/components/PushNotificationSettings', () => ({ PushNotificationSettings: () => null }));
vi.mock('@/components/ManageSubscriptionButton', () => ({ ManageSubscriptionButton: () => <button>Manage subscription</button> }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string, fallback: string) => ({ auth_full_name: 'Vollständiger Name', auth_email_label: 'E-Mail', auth_password: 'Passwort' }[key] || fallback || key) }) }));
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
  vi.clearAllMocks(); fixture.user = user();
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
  const privacy = screen.getAllByRole('switch').at(-1)!;
  fireEvent.click(privacy);
  fixture.user = { ...user(), followersCount: 3 }; view.rerender(<ProfileSettings />);
  expect(screen.getByLabelText('Vollständiger Name')).toHaveValue('Unsaved edit');
  expect(screen.getAllByRole('switch').at(-1)).toHaveAttribute('aria-checked', 'false');
  fixture.user = user('bob'); view.rerender(<ProfileSettings />);
  expect(screen.getByLabelText('Vollständiger Name')).toHaveValue('Bob');
  expect(screen.getByLabelText('E-Mail')).toHaveValue('bob@example.test');
});
it('preserves draft and shows failure rather than false success; deduplicates pending submits', async () => {
  const save = deferred<any>(); fixture.request.mockReturnValue(save.promise); mount();
  fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: 'Draft' } });
  const form = screen.getByRole('button', { name: 'Save Changes' }).closest('form')!;
  fireEvent.submit(form); fireEvent.submit(form);
  await waitFor(() => expect(fixture.request).toHaveBeenCalledTimes(1));
  await act(async () => save.reject(new Error('500: update unavailable')));
  await waitFor(() => expect(fixture.failure).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Vollständiger Name')).toHaveValue('Draft'); expect(fixture.success).not.toHaveBeenCalled();
});
it('late previous-account save cannot reset new account or issue success notification', async () => {
  const save = deferred<any>(); fixture.request.mockReturnValue(save.promise); const view = mount();
  fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: 'Old account draft' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save Changes' }).closest('form')!);
  await waitFor(() => expect(fixture.request).toHaveBeenCalledTimes(1));
  fixture.user = user('bob'); view.rerender(<ProfileSettings />);
  await act(async () => save.resolve({ json: async () => ({ user: user() }) }));
  expect(screen.getByLabelText('Vollständiger Name')).toHaveValue('Bob'); expect(fixture.success).not.toHaveBeenCalled();
});
it('keeps edits typed during a pending successful save', async () => {
  const save = deferred<any>(); fixture.request.mockReturnValue(save.promise); mount();
  fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: 'Submitted name' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save Changes' }).closest('form')!);
  await waitFor(() => expect(fixture.request).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: 'Newer draft' } });
  await act(async () => save.resolve({ json: async () => ({ user: user() }) }));
  expect(screen.getByLabelText('Vollständiger Name')).toHaveValue('Newer draft');
});
it('rejects too-short password locally and exposes error', async () => {
  mount(); fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'short' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save Changes' }).closest('form')!);
  await screen.findByRole('alert'); expect(fixture.request).not.toHaveBeenCalled();
});
it('uploads to actual authenticated avatar endpoint and rolls back failed preview', async () => {
  const upload = deferred<Response>(); const fetchMock = vi.fn(() => upload.promise); vi.stubGlobal('fetch', fetchMock);
  mount(); const original = document.createElement.bind(document); let picker: HTMLInputElement;
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options: any) => { const element = original(tag, options); if (tag === 'input') picker = element as HTMLInputElement; return element; }) as any);
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Change profile picture' }));
  Object.defineProperty(picker!, 'files', { configurable: true, value: [new File(['image'], 'avatar.png', { type: 'image/png' })] });
  fireEvent.change(picker!);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(fetchMock.mock.calls[0][0]).toBe('/api/user/avatar');
  expect((fetchMock.mock.calls[0] as any)[1].headers).toEqual({ Authorization: 'Bearer fixture-only' });
  expect(screen.getByAltText('Profile')).toHaveAttribute('src', 'blob:pending-avatar');
  await act(async () => upload.resolve(new Response(JSON.stringify({ error: 'Upload failed' }), { status: 500 })));
  await waitFor(() => expect(screen.getByAltText('Profile')).toHaveAttribute('src', '/alice.png'));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pending-avatar');
});
it('offers all14 supported profile language values instead of only five', () => {
  const view = mount();
  expect([...view.container.querySelectorAll('[data-language-option]')].map(x => x.getAttribute('data-language-option')).sort())
    .toEqual(['en','es','fr','de','pt','it','ru','ar','zh','tr','ja','ko','hi','he'].sort());
  expect(screen.getByLabelText('Random')).toBeChecked();
});
it('shows subscription management only for an existing plan and outside the profile save form', () => {
  const view = mount(); expect(screen.queryByText('Manage subscription')).not.toBeInTheDocument();
  fixture.user = { ...user(), subscription: { plan: 'premium_monthly' } }; view.rerender(<ProfileSettings />);
  expect(screen.getByText('Manage subscription').closest('form')).toBeNull();
});
