import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('swiper/react', () => ({
  Swiper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SwiperSlide: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('swiper/modules', () => ({ Pagination: {}, Mousewheel: {} }));
vi.mock('wouter', () => ({
  Link: ({ to, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => <a href={to} {...props}>{children}</a>,
}));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({ getLocalizedUrl: (path: string) => `/de${path}` }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));

import DiscoverableGenreSlider from '../src/components/DiscoverableGenreSlider';

const rock = { _id: 'rock', name: 'Rock', slug: 'rock', discoverableImage: '/uploads/genres/discoverable/rock.png' };
const gradient = (card: Element) => card.querySelector<HTMLElement>('[style]')!;

it('layers a decorative uploaded image above a gradient without changing the genre destination', () => {
  render(<DiscoverableGenreSlider genres={[rock]} />);
  const card = screen.getByRole('link', { name: 'Rock Discover all the stations' });
  expect(card).toHaveAttribute('href', '/de/genres/rock');
  expect(gradient(card).style.backgroundImage).toContain('linear-gradient');
  const image = card.querySelector('img')!;
  expect(image).toHaveAttribute('src', rock.discoverableImage);
  expect(image).toHaveAttribute('alt', '');
  expect(image).toHaveAttribute('aria-hidden', 'true');
  expect(image).toHaveAttribute('loading', 'lazy');
  expect(image).toHaveAttribute('decoding', 'async');
  expect(image).toHaveAttribute('draggable', 'false');
  expect(image).toBeVisible();
});

it('keeps a gradient and readable link when no discoverable image was configured', () => {
  render(<DiscoverableGenreSlider genres={[{ ...rock, discoverableImage: undefined }]} />);
  const card = screen.getByRole('link', { name: /Rock/ });
  expect(card.querySelector('img')).toBeNull();
  expect(gradient(card).style.backgroundImage).toContain('linear-gradient');
  expect(screen.getByText('Rock')).toBeVisible();
});

it('reveals the gradient after a missing image fails and keeps the genre usable', () => {
  render(<DiscoverableGenreSlider genres={[rock]} />);
  const card = screen.getByRole('link', { name: /Rock/ });
  const background = gradient(card);
  fireEvent.error(card.querySelector('img')!);
  expect(card.querySelector('img')).not.toBeVisible();
  expect(background).toBeVisible();
  expect(background.style.backgroundImage).toContain('linear-gradient');
  expect(screen.getByText('Rock')).toBeVisible();
  expect(card).toHaveAttribute('href', '/de/genres/rock');
});

it('tries a replacement image instead of retaining the failed image state', () => {
  const view = render(<DiscoverableGenreSlider genres={[rock]} />);
  const card = screen.getByRole('link', { name: /Rock/ });
  const failedImage = card.querySelector('img')!;
  fireEvent.error(failedImage);
  view.rerender(<DiscoverableGenreSlider genres={[{ ...rock, discoverableImage: '/uploads/genres/discoverable/restored-rock.png' }]} />);
  const replacement = card.querySelector('img')!;
  expect(replacement).not.toBe(failedImage);
  expect(replacement).toHaveAttribute('src', '/uploads/genres/discoverable/restored-rock.png');
  expect(replacement).toBeVisible();
  expect(gradient(card).style.backgroundImage).toContain('linear-gradient');
});
