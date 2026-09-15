import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Camera, Check, CircleAlert, Globe2, Heart, History, Loader2, Radio, Shuffle, UserRound } from 'lucide-react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PublicProfileAvatar } from '@/components/ui/public-profile-avatar';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, oauthBearerHeader, resolveApiUrl } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { ACTIVE_SITEMAP_LANGUAGES, SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { ManageSubscriptionButton } from '@/components/ManageSubscriptionButton';
import { ProfileSettingsNotifications } from '@/components/profile-settings-notifications';
import { getProfileSettingsCopy } from '@/lib/profile-settings-copy';
import { profileSettingsDefaults, profileSettingsPayload, profileSettingsSchema, type ProfileSettingsData, type SettingsUser } from '@/lib/profile-settings-form';
import { getLocalizedCountryDisplayName } from '@/utils/localized-country';
import { invalidateCommunityProfiles } from '@/lib/community-profile';

const panelClass = 'min-w-0 rounded-2xl border border-white/[0.08] bg-[#151515] p-5 sm:p-6';
const inputClass = 'h-12 min-w-0 rounded-xl border-white/10 bg-[#0e0e0e] text-base text-white focus-visible:border-[#FF4199]/60 focus-visible:ring-[#FF4199]/30';
const switchClass = 'data-[state=checked]:bg-[#FF4199] data-[state=unchecked]:bg-[#383838] focus-visible:ring-[#FF4199] [&>span]:bg-white';

function SettingsContent() {
  const { user } = useAuth();
  return <ProfileSettingsForm key={String(user?._id || 'anonymous')} user={user} />;
}

function ProfileSettingsForm({ user }: { user: SettingsUser | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { language = 'en', localeTranslations } = useTranslation();
  const copy = getProfileSettingsCopy(language, localeTranslations);
  const avatarRequirements = `${copy.avatarHint} · ≥100×100 px`;
  const active = useRef(true);
  const avatarObjectUrl = useRef('');
  const savePending = useRef(false);
  const submittedDraft = useRef<ProfileSettingsData | undefined>(undefined);
  const avatarPending = useRef(false);
  const lastUploadedAvatar = useRef('');
  const [avatarPreview, setAvatarPreview] = useState('');
  const [saveResult, setSaveResult] = useState<'saved' | 'error' | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; if (avatarObjectUrl.current) URL.revokeObjectURL(avatarObjectUrl.current); };
  }, []);

  const { data: countries = [] } = useQuery<string[]>({ queryKey: ['/api/filters/countries'] });
  const languages = SEO_LANGUAGES.filter(item => ACTIVE_SITEMAP_LANGUAGES.some(code => code === item.code));
  const form = useForm<ProfileSettingsData>({ resolver: zodResolver(profileSettingsSchema(copy)), defaultValues: profileSettingsDefaults(user) });
  const { isDirty, errors } = form.formState;
  const autoplay = form.watch('is_autoplay_at_login');
  const playback = form.watch('play_at_login');

  useEffect(() => {
    if (user && !form.formState.isDirty && !savePending.current) form.reset(profileSettingsDefaults(user));
  }, [user, form]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: ProfileSettingsData) => (await apiRequest('PUT', '/api/auth/profile', { body: profileSettingsPayload(data) })).json(),
    onSuccess: (_result, submitted) => {
      if (!active.current) return;
      setSaveResult('saved');
      toast({ title: copy.success, description: copy.saved });
      void queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      invalidateCommunityProfiles(queryClient);
      // Schema trimming normalizes the payload; compare against the raw draft.
      // Newer edits made during the request must remain in the form.
      if (JSON.stringify(form.getValues()) === JSON.stringify(submittedDraft.current)) form.reset({ ...submitted, password: '' });
      else {
        // Discard must return to the last successful save, even if its refetch
        // is delayed. Keep any edits typed while that request was running.
        form.reset({ ...submitted, password: '' }, { keepValues: true, keepDirty: true });
        if (form.getValues('password') === submitted.password) form.setValue('password', '', { shouldDirty: true });
      }
    },
    onError: () => {
      if (!active.current) return;
      setSaveResult('error');
      toast({ title: copy.error, description: copy.saveFailed, variant: 'destructive' });
    },
    onSettled: () => { savePending.current = false; }, retry: false,
  });

  const updateAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData(); formData.append('avatar', file);
      const response = await fetch(resolveApiUrl('/api/user/avatar'), { method: 'POST', body: formData, credentials: 'include', headers: oauthBearerHeader() });
      if (!response.ok) throw new Error(response.status === 400 || response.status === 413 ? avatarRequirements : copy.avatarFailed);
      const data = await response.json();
      if (typeof data.avatar !== 'string' || !data.avatar) throw new Error(copy.avatarFailed);
      return data as { avatar: string };
    },
    onSuccess: data => {
      if (!active.current) return;
      lastUploadedAvatar.current = data.avatar;
      setAvatarPreview(data.avatar);
      toast({ title: copy.success, description: copy.avatarSaved });
      void queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      invalidateCommunityProfiles(queryClient);
    },
    onError: error => {
      if (!active.current) return;
      setAvatarPreview(lastUploadedAvatar.current);
      toast({ title: copy.error, description: error.message === avatarRequirements ? avatarRequirements : copy.avatarFailed, variant: 'destructive' });
    },
    onSettled: () => {
      avatarPending.current = false;
      if (avatarObjectUrl.current) { URL.revokeObjectURL(avatarObjectUrl.current); avatarObjectUrl.current = ''; }
    }, retry: false,
  });

  const selectProfileImage = () => {
    if (avatarPending.current) return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
    // Attach before opening the picker so immediate selection cannot be missed.
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file || !active.current || avatarPending.current) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
        toast({ title: copy.error, description: avatarRequirements, variant: 'destructive' }); return;
      }
      avatarPending.current = true;
      if (avatarObjectUrl.current) URL.revokeObjectURL(avatarObjectUrl.current);
      avatarObjectUrl.current = URL.createObjectURL(file);
      setAvatarPreview(avatarObjectUrl.current);
      updateAvatarMutation.mutate(file);
    };
    input.click();
  };

  const onSubmit = (data: ProfileSettingsData) => {
    if (savePending.current) return;
    savePending.current = true; submittedDraft.current = form.getValues(); setSaveResult(null);
    updateProfileMutation.mutate(data);
  };
  const resetDraft = () => { form.reset(); setSaveResult(null); };
  const countryOptions = [...new Set([...(user?.location ? [user.location] : []), ...countries])];
  const avatar = avatarPreview || user?.avatar;
  const avatarName = user?.fullName || user?.username || copy.profile;
  const stats = [{ label: copy.followers, value: user?.followersCount }, { label: copy.following, value: user?.followingCount }];

  return <div className="mx-auto w-full min-w-0 max-w-6xl px-2 pb-10 font-['Ubuntu',sans-serif] text-white sm:px-0" dir={language === 'ar' || language === 'he' ? 'rtl' : undefined}>
    <header className="mb-7 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#ff73b3]">{copy.title}</p>
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{copy.intro}</h1>
      </div>
    </header>
    <section aria-label={copy.profile} className="relative mb-6 overflow-hidden rounded-2xl border border-white/10 bg-[#151515] p-5 sm:p-7">
      <div className="absolute inset-y-0 start-0 w-1 bg-[#FF4199]" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center">
          <div className="relative h-24 w-24 shrink-0">
            {avatar?.startsWith('blob:') ? <img width={96} height={96} src={avatar} alt={avatarName} className="h-24 w-24 rounded-2xl object-cover" /> : <PublicProfileAvatar profile={{ avatar }} name={avatarName} size={96} className="h-24 w-24 rounded-2xl border border-white/10" />}
            <button type="button" onClick={selectProfileImage} disabled={updateAvatarMutation.isPending} aria-label={copy.changeAvatar} className="absolute -bottom-2 -end-2 flex h-10 w-10 items-center justify-center rounded-xl border-4 border-[#151515] bg-[#FF4199] text-[#170910] transition-colors hover:bg-[#ff73b3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60">
              {updateAvatarMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Camera className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          <div className="min-w-0">
            <h2 className="break-words text-2xl font-bold leading-tight [overflow-wrap:anywhere]">{user?.fullName || user?.username || copy.profile}</h2>
            <p className="mt-1 break-all text-sm text-[#a3a3a3]" dir="auto">{user?.email}</p>
            <p className="mt-3 text-xs leading-relaxed text-[#858585]">{avatarRequirements}</p>
          </div>
        </div>
        <dl className="grid shrink-0 grid-cols-2 gap-5 border-t border-white/[0.08] pt-5 xl:border-s xl:border-t-0 xl:ps-7 xl:pt-0">
          {stats.map(({ label, value }) => <div key={label} className="min-w-0">
            <dd className="text-2xl font-bold tabular-nums">{new Intl.NumberFormat(language).format(typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0)}</dd>
            <dt className="mt-1 break-words text-xs text-[#a3a3a3]">{label}</dt>
          </div>)}
        </dl>
      </div>
    </section>
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section className={panelClass} aria-labelledby="profile-details-title">
          <h2 id="profile-details-title" className="mb-6 flex items-center gap-3 text-lg font-bold"><UserRound className="h-5 w-5 text-[#FF4199]" aria-hidden="true" />{copy.details}</h2>
          <div className="grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="min-w-0 sm:col-span-2">
              <Label htmlFor="profile-name" className="mb-2 block text-sm text-[#c4c4c4]">{copy.name}</Label>
              <Input id="profile-name" autoComplete="name" className={inputClass} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'profile-name-error' : undefined} {...form.register('name')} />
              {errors.name && <p id="profile-name-error" role="alert" className="mt-2 text-sm text-[#ff91aa]">{errors.name.message}</p>}
            </div>
            <div className="min-w-0 sm:col-span-2">
              <Label htmlFor="profile-email" className="mb-2 block text-sm text-[#c4c4c4]">{copy.email}</Label>
              <Input id="profile-email" type="email" autoComplete="email" dir="ltr" className={inputClass} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'profile-email-error' : undefined} {...form.register('email')} />
              {errors.email && <p id="profile-email-error" role="alert" className="mt-2 text-sm text-[#ff91aa]">{errors.email.message}</p>}
            </div>
            <div className="min-w-0 sm:col-span-2">
              <Label htmlFor="profile-password" className="mb-2 block text-sm text-[#c4c4c4]">{copy.password}</Label>
              <Input id="profile-password" type="password" autoComplete="new-password" className={inputClass} aria-invalid={!!errors.password} aria-describedby={`profile-password-hint${errors.password ? ' profile-password-error' : ''}`} {...form.register('password')} />
              <p id="profile-password-hint" className="mt-2 text-xs leading-relaxed text-[#969696]">{copy.passwordHint}</p>
              {errors.password && <p id="profile-password-error" role="alert" className="mt-2 text-sm text-[#ff91aa]">{errors.password.message}</p>}
            </div>
            <div className="min-w-0">
              <Label htmlFor="profile-country" className="mb-2 block text-sm text-[#c4c4c4]">{copy.country}</Label>
              <Select value={form.watch('country')} onValueChange={value => form.setValue('country', value, { shouldDirty: true })}>
                <SelectTrigger id="profile-country" className={inputClass}><SelectValue placeholder={copy.selectCountry} /></SelectTrigger>
                <SelectContent className="max-h-72 border-white/10 bg-[#202020] text-white">{countryOptions.map(country => <SelectItem key={country} value={country}>{getLocalizedCountryDisplayName(country, language)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="profile-language" className="mb-2 block text-sm text-[#c4c4c4]">{copy.language}</Label>
              <Select value={form.watch('language')} onValueChange={value => form.setValue('language', value, { shouldDirty: true })}>
                <SelectTrigger id="profile-language" className={inputClass}><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72 border-white/10 bg-[#202020] text-white">{languages.map(item => <SelectItem key={item.code} value={item.code}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-6 flex items-start justify-between gap-4 border-t border-white/[0.08] pt-6">
            <div className="min-w-0">
              <Label htmlFor="profile-public" className="flex items-center gap-2 text-sm font-bold"><Globe2 className="h-4 w-4 shrink-0 text-[#FF4199]" aria-hidden="true" />{copy.publicProfile}</Label>
              <p id="profile-public-description" className="mt-2 text-sm leading-relaxed text-[#a3a3a3]">{copy.privacyHint}</p>
            </div>
            <Switch id="profile-public" aria-describedby="profile-public-description" checked={form.watch('is_public_profile')} onCheckedChange={checked => form.setValue('is_public_profile', checked, { shouldDirty: true })} className={switchClass} />
          </div>
        </section>
        <section className={panelClass} aria-labelledby="profile-playback-title">
          <h2 id="profile-playback-title" className="mb-6 flex items-center gap-3 text-lg font-bold"><Radio className="h-5 w-5 text-[#FF4199]" aria-hidden="true" />{copy.playback}</h2>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0"><Label htmlFor="is_autoplay_at_login" className="text-sm font-bold">{copy.autoplay}</Label><p id="profile-autoplay-description" className="mt-2 text-sm leading-relaxed text-[#a3a3a3]">{copy.autoplayHint}</p></div>
            <Switch id="is_autoplay_at_login" checked={autoplay} onCheckedChange={checked => form.setValue('is_autoplay_at_login', checked, { shouldDirty: true })} aria-describedby="profile-autoplay-description" className={switchClass} />
          </div>
          <fieldset disabled={!autoplay} className="mt-6 space-y-3 border-t border-white/[0.08] pt-6 disabled:opacity-50">
            <legend className="sr-only">{copy.playback}</legend>
            {([{ value: 'LAST_PLAYED', label: copy.lastPlayed, Icon: History }, { value: 'RANDOM', label: copy.random, Icon: Shuffle }, { value: 'FAVORITE', label: copy.favorite, Icon: Heart }] as const).map(({ value, label, Icon }) => <label key={value} className={`flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${autoplay ? 'cursor-pointer hover:border-[#FF4199]/50' : 'cursor-not-allowed'} ${playback === value ? 'border-[#FF4199]/50 bg-[#FF4199]/[0.06]' : 'border-white/10 bg-[#0e0e0e]'}`}>
              <Icon className={`h-4 w-4 shrink-0 ${playback === value ? 'text-[#ff73b3]' : 'text-[#858585]'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 text-sm">{label}</span>
              <input className="h-4 w-4 shrink-0 text-[#FF4199] accent-[#FF4199] focus:ring-[#FF4199] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FF4199]" value={value} type="radio" {...form.register('play_at_login')} />
            </label>)}
          </fieldset>
        </section>
      </div>
      <div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-white/[0.08] bg-[#151515] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p role={saveResult === 'error' ? 'alert' : 'status'} className={`flex min-w-0 items-center gap-2 text-sm ${saveResult === 'error' ? 'text-[#ff91aa]' : 'text-[#a3a3a3]'}`}>
          {saveResult === 'error' ? <><CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />{copy.saveFailed}</> : isDirty ? <><span className="h-2 w-2 shrink-0 rounded-full bg-[#FF4199]" aria-hidden="true" />{copy.unsaved}</> : saveResult === 'saved' ? <><Check className="h-4 w-4 shrink-0 text-[#FF4199]" aria-hidden="true" />{copy.saved}</> : null}
        </p>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
          {isDirty && <Button type="button" variant="ghost" disabled={updateProfileMutation.isPending} onClick={resetDraft} className="h-auto min-h-11 whitespace-normal text-[#c4c4c4] hover:bg-white/5 hover:text-white">{copy.cancel}</Button>}
          <Button type="submit" disabled={updateProfileMutation.isPending || !isDirty} className="h-auto min-h-12 whitespace-normal rounded-xl bg-[#FF4199] px-6 py-3 font-bold text-[#170910] hover:bg-[#ff73b3] focus-visible:ring-[#FF4199] disabled:opacity-40">
            {updateProfileMutation.isPending && <Loader2 className="me-2 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}{updateProfileMutation.isPending ? copy.saving : copy.save}
          </Button>
        </div>
      </div>
    </form>
    <div className="mt-6"><ProfileSettingsNotifications copy={copy} /></div>
    {user?.subscription?.plan && user.subscription.plan !== 'none' && <div className="mt-6"><ManageSubscriptionButton /></div>}
  </div>;
}

export default function ProfileSettings() {
  return <ProtectedRoute><SettingsContent /></ProtectedRoute>;
}
