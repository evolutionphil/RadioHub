import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HOME_HERO_COPY, getHomeHeroCopy } from '@workspace/seo-shared/home-hero-copy';
import HomeHeroCopy from '../src/components/HomeHeroCopy';

describe('localized homepage hero', () => {
  it.each(Object.keys(HOME_HERO_COPY))('renders all three shared lines immediately for %s', (language) => {
    const copy = getHomeHeroCopy(language);
    const { container } = render(<HomeHeroCopy language={language} />);
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copy.headline);
    expect(container.querySelector('.home-hero-eyebrow')).toHaveTextContent(copy.eyebrow);
    expect(container.querySelector('.home-hero-tagline')).toHaveTextContent(copy.tagline);
    expect(container.firstChild).toHaveAttribute('dir', copy.direction);
  });

  it('preserves the exact approved German and Turkish headlines when language changes', () => {
    const { rerender } = render(<HomeHeroCopy language="de" />);
    expect(screen.getByRole('heading')).toHaveTextContent('Radio live hören');
    rerender(<HomeHeroCopy language="tr" />);
    expect(screen.getByRole('heading')).toHaveTextContent('Canlı radyo dinle');
    expect(screen.getByText('Dünyanın sesi burada')).toBeVisible();
    expect(screen.getByText('Ücretsiz. Her an. Her yerde.')).toBeVisible();
    expect(screen.queryByText('Radio live hören')).not.toBeInTheDocument();
  });
});
