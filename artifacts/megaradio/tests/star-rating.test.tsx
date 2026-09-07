import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { getLocalizedRatingLabels } from '../src/utils/localized-rating-labels';

const locale = vi.hoisted(() => ({ language: 'en', dictionary: {} as Record<string, string> }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({
  language: locale.language, localeTranslations: locale.dictionary,
  t: (_key: string, fallback: string) => fallback,
}) }));
import { StarRating } from '../src/components/star-rating';

beforeEach(() => { locale.language = 'en'; locale.dictionary = {}; });
afterEach(cleanup);
const star = (rating: number) => screen.getByRole('button', { name: `Rate ${rating} out of 5` });
const dialog = () => within(screen.getByRole('dialog'));

it('resets selected rating, comment, hover and open dialog on station change', () => {
  const view = render(<StarRating stationId="A" initialRating={2} initialComment="A saved" />);
  fireEvent.click(screen.getByTestId('button-add-review'));
  fireEvent.change(screen.getByTestId('textarea-comment'), { target: { value: 'A unfinished draft' } });
  fireEvent.click(dialog().getByRole('button', { name: 'Rate 4 out of 5' }));
  fireEvent.mouseEnter(dialog().getByRole('button', { name: 'Rate 5 out of 5' }));
  view.rerender(<StarRating stationId="B" initialRating={1} initialComment="B saved" />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(star(1)).toHaveAttribute('aria-pressed', 'true');
  expect(star(4).querySelector('svg')).toHaveClass('text-gray-400');
  fireEvent.click(screen.getByTestId('button-add-review'));
  expect(screen.getByTestId('textarea-comment')).toHaveValue('B saved');
});

it('resets the same station editor when its authenticated scope changes', () => {
  const view = render(<StarRating stationId="A" ratingScopeKey="user-a" initialRating={4} />);
  fireEvent.click(screen.getByTestId('button-add-review'));
  fireEvent.change(screen.getByTestId('textarea-comment'), { target: { value: 'Private draft' } });
  view.rerender(<StarRating stationId="A" ratingScopeKey="user-b" initialRating={0} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(star(4)).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByTestId('button-add-review'));
  expect(screen.getByTestId('textarea-comment')).toHaveValue('');
});

it('accepts asynchronous initial rating/comment without erasing a dirty draft', () => {
  const view = render(<StarRating stationId="A" />);
  view.rerender(<StarRating stationId="A" initialRating={3} initialComment="Saved later" />);
  expect(star(3)).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByTestId('button-add-review'));
  expect(screen.getByTestId('textarea-comment')).toHaveValue('Saved later');
  fireEvent.change(screen.getByTestId('textarea-comment'), { target: { value: 'Editing now' } });
  view.rerender(<StarRating stationId="A" initialRating={2} initialComment="Background refresh" />);
  expect(screen.getByTestId('textarea-comment')).toHaveValue('Editing now');
  expect(dialog().getByRole('button', { name: 'Rate 3 out of 5' })).toHaveAttribute('aria-pressed', 'true');
});

it.each(['accepted', 'rejected'] as const)('late station A submission (%s) cannot update station B editor', async outcome => {
  let resolve!: (result: boolean) => void;
  const submit = vi.fn(() => new Promise<boolean>(done => { resolve = done; }));
  const view = render(<StarRating stationId="A" onRatingSubmit={submit} />);
  fireEvent.click(star(5));
  expect(star(5)).toBeDisabled();
  view.rerender(<StarRating stationId="B" initialRating={1} onRatingSubmit={submit} />);
  expect(star(1)).not.toBeDisabled();
  fireEvent.click(screen.getByTestId('button-add-review'));
  fireEvent.change(screen.getByTestId('textarea-comment'), { target: { value: 'B draft' } });
  fireEvent.click(dialog().getByRole('button', { name: 'Rate 2 out of 5' }));
  await act(async () => { resolve(outcome === 'accepted'); });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByTestId('textarea-comment')).toHaveValue('B draft');
  expect(dialog().getByRole('button', { name: 'Rate 2 out of 5' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each(['false', 'throw'] as const)('rolls back an unsuccessful quick rating (%s) and prevents duplicate pending submissions', async failure => {
  let resolve!: (result: boolean) => void;
  let reject!: (error: Error) => void;
  const submit = vi.fn(() => new Promise<boolean>((done, fail) => { resolve = done; reject = fail; }));
  render(<StarRating stationId="A" initialRating={2} onRatingSubmit={submit} />);
  fireEvent.click(star(5));
  fireEvent.click(star(4));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(star(5)).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('status')).toHaveTextContent('Saving rating');
  await act(async () => { failure === 'false' ? resolve(false) : reject(new Error('offline')); });
  expect(star(2)).toHaveAttribute('aria-pressed', 'true');
  expect(star(5)).not.toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Rating could not be saved');
});

it('supports native Enter/Space activation with unchanged star geometry and async void callbacks', async () => {
  const user = userEvent.setup();
  const submit = vi.fn(async () => {});
  render(<StarRating stationId="A" onRatingSubmit={submit} />);
  await user.tab();
  expect(star(1)).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(submit).toHaveBeenLastCalledWith(1, undefined);
  await user.tab();
  await user.keyboard(' ');
  expect(submit).toHaveBeenLastCalledWith(2, undefined);
  expect(star(2)).toHaveAttribute('aria-pressed', 'true');
  expect(star(2).querySelector('svg')).toHaveClass('w-5', 'h-5');
  fireEvent.click(screen.getByTestId('button-add-review'));
  const fifth = dialog().getByRole('button', { name: 'Rate 5 out of 5' });
  fifth.focus();
  await user.keyboard(' ');
  expect(fifth).toHaveAttribute('aria-pressed', 'true');
  expect(fifth.querySelector('svg')).toHaveClass('w-8', 'h-8');
  expect(submit).toHaveBeenCalledTimes(2); // Dialog selection is a draft, not a POST.
});

it('keeps a failed comment dialog open and closes it only after an accepted retry', async () => {
  const submit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<StarRating stationId="A" initialRating={2} initialComment="Old" onRatingSubmit={submit} />);
  fireEvent.click(screen.getByTestId('button-add-review'));
  fireEvent.click(dialog().getByRole('button', { name: 'Rate 4 out of 5' }));
  fireEvent.change(screen.getByTestId('textarea-comment'), { target: { value: 'New comment' } });
  await act(async () => { fireEvent.click(screen.getByTestId('button-submit-rating')); });
  expect(submit).toHaveBeenLastCalledWith(4, 'New comment');
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByTestId('textarea-comment')).toHaveValue('New comment');
  expect(dialog().getByRole('button', { name: 'Rate 2 out of 5' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(dialog().getByRole('button', { name: 'Rate 4 out of 5' }));
  await act(async () => { fireEvent.click(screen.getByTestId('button-submit-rating')); });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(star(4)).toHaveAttribute('aria-pressed', 'true');
});

it('quick-updates an existing review score without losing its comment', async () => {
  const submit = vi.fn().mockResolvedValue(true);
  render(<StarRating stationId="A" initialRating={2} initialComment="Keep my review" onRatingSubmit={submit} />);
  await act(async () => { fireEvent.click(star(5)); });
  expect(submit).toHaveBeenCalledWith(5, 'Keep my review');
  expect(star(5)).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('rolls back a failed quick update with comment and accepts later initial data', async () => {
  const submit = vi.fn().mockResolvedValue(false);
  const view = render(<StarRating stationId="A" initialRating={2} initialComment="Saved review" onRatingSubmit={submit} />);
  await act(async () => { fireEvent.click(star(5)); });
  expect(submit).toHaveBeenCalledWith(5, 'Saved review');
  expect(star(2)).toHaveAttribute('aria-pressed', 'true');
  view.rerender(<StarRating stationId="A" initialRating={3} initialComment="Loaded review" onRatingSubmit={submit} />);
  expect(star(3)).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByTestId('button-add-review'));
  expect(screen.getByTestId('textarea-comment')).toHaveValue('Loaded review');
});

it('retains a failed modal comment draft when initial data arrives later', async () => {
  const submit = vi.fn().mockResolvedValue(false);
  const view = render(<StarRating stationId="A" initialRating={2} initialComment="Saved review" onRatingSubmit={submit} />);
  fireEvent.click(screen.getByTestId('button-add-review'));
  fireEvent.change(screen.getByTestId('textarea-comment'), { target: { value: 'Unsent edited review' } });
  fireEvent.click(dialog().getByRole('button', { name: 'Rate 4 out of 5' }));
  await act(async () => { fireEvent.click(screen.getByTestId('button-submit-rating')); });
  view.rerender(<StarRating stationId="A" initialRating={3} initialComment="Loaded review" onRatingSubmit={submit} />);
  expect(screen.getByTestId('textarea-comment')).toHaveValue('Unsent edited review');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it.each(['loading', 'error'] as const)('does not present pending/failed aggregate (%s) as zero ratings', statsStatus => {
  render(<StarRating stationId="A" statsStatus={statsStatus} totalRatings={10}
    ratingBreakdown={{ stars1: 2, stars2: 2, stars3: 2, stars4: 2, stars5: 2 }} />);
  expect(screen.queryByText('No ratings yet')).not.toBeInTheDocument();
  expect(screen.queryByText('Rating Breakdown')).not.toBeInTheDocument();
  expect(screen.getByText(statsStatus === 'loading' ? 'Loading ratings…' : 'Ratings unavailable')).toBeInTheDocument();
});

it('retains the actual empty/read-only aggregate display with no interactive stars', () => {
  render(<StarRating stationId="A" editable={false} statsStatus="ready" />);
  expect(screen.getByText('No ratings yet')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it.each(ACTIVE_SITEMAP_LANGUAGES)('%s uses same-locale fallback labels for new widget statuses', language => {
  locale.language = language;
  const labels = getLocalizedRatingLabels(language);
  if (language !== 'en') {
    const english = getLocalizedRatingLabels('en');
    for (const key of ['loading', 'unavailable', 'saving', 'failed'] as const) expect(labels[key]).not.toBe(english[key]);
  }
  render(<StarRating stationId="A" statsStatus="loading" />);
  expect(screen.getByRole('button', { name: labels.star(3) })).toBeInTheDocument();
  expect(screen.getByText(labels.loading)).toBeInTheDocument();
});

it('honors current-locale custom status/accessibility labels', () => {
  locale.language = 'tr';
  locale.dictionary = { rating_star_label: 'Özel {rating} puan', rating_loading: 'Özel yükleme' };
  render(<StarRating stationId="A" statsStatus="loading" />);
  expect(screen.getByRole('button', { name: 'Özel 3 puan' })).toBeInTheDocument();
  expect(screen.getByText('Özel yükleme')).toBeInTheDocument();
});

it('normalizes locale variants and ignores known corrupt dictionary markers', () => {
  const labels = getLocalizedRatingLabels('de-AT', {
    rating_star_label: 'Title', rating_loading: 'Subtitle', rating_unavailable: 'Homepage Placeholder',
    rating_saving: 'titel', rating_save_failed: 'subtitel',
  });
  const german = getLocalizedRatingLabels('de');
  expect(labels.star(4)).toBe(german.star(4));
  for (const key of ['loading', 'unavailable', 'saving', 'failed'] as const) expect(labels[key]).toBe(german[key]);
  expect(getLocalizedRatingLabels('DE_at').star(3)).toBe(german.star(3));
});
