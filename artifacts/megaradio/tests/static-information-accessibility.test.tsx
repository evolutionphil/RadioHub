import React from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/SeoHead', () => ({ SeoHead: () => null }));
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }) }));
import { About } from '../src/pages/about';
import { Contact } from '../src/pages/contact';

it('About has one primary heading before section headings without changing the hero classes', () => {
  const { container } = render(<About />);
  expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('about_mega_radio');
  const headings = [...container.querySelectorAll('h1,h2,h3')];
  expect(headings[0].tagName).toBe('H1');
  expect(screen.getByText('about_page_title').tagName).toBe('P');
  expect(screen.getByText('about_page_title').className).toContain('text-[26px]');
});
it('Contact keeps the live form interactive with accessible translated labels', () => {
  render(<Contact />);
  expect(screen.getByRole('textbox',{name:'contact_email_placeholder'})).toBeEnabled();
  expect(screen.getByRole('textbox',{name:'contact_message_placeholder'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'contact_send_button'})).toBeEnabled();
  expect(screen.getAllByRole('heading',{level:1})).toHaveLength(1);
});
