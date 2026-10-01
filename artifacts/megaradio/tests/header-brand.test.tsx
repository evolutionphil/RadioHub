import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeaderBrand } from '../src/components/layout/header-brand';

describe('public header brand', () => {
  it.each(['/de', '/tr', '/en'])('keeps its localized home link for %s', (href) => {
    render(<HeaderBrand href={href} />);
    expect(screen.getByRole('link', { name: 'MegaRadio' })).toHaveAttribute('href', href);
  });

  it('uses the original high-resolution asset with stable dimensions and immediate loading', () => {
    const { container } = render(<HeaderBrand href="/de" />);
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', '/logo-icon.webp');
    expect(image).toHaveAttribute('width', '322');
    expect(image).toHaveAttribute('height', '299');
    expect(image).toHaveAttribute('loading', 'eager');
    expect(image).toHaveAttribute('decoding', 'async');
    expect(image).toHaveClass('header-brand__image');
  });

  it('announces one brand label and retains its existing wordmark styling', () => {
    const { container } = render(<HeaderBrand href="/de" />);
    expect(screen.getAllByRole('link', { name: 'MegaRadio' })).toHaveLength(1);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('.header-brand__mark')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.header-brand__wordmark')).toHaveTextContent('megaradio');
    expect(container.querySelector('.header-brand__wordmark')).toHaveClass('font-ubuntu');
    expect(container.querySelector('.header-brand__wordmark')).not.toHaveAttribute('style');
  });
});
