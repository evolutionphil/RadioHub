import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PublicProfileAvatar } from '../src/components/ui/public-profile-avatar';
import UserAvatar from '../src/components/ui/user-avatar';

afterEach(cleanup);

it.each([undefined, '', '   ', 'invalid-image', 'javascript:alert(1)'])('uses an accessible local default for missing or invalid photo %s', avatar => {
  const view = render(<PublicProfileAvatar profile={{ avatar }} name="Demo Listener" className="size-14" />);
  expect(screen.getByRole('img', { name: 'Demo Listener' }).tagName.toLowerCase()).toBe('svg');
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.container).not.toHaveTextContent('DL');
});

it('keeps real photos and recovers when a previously missing avatar is uploaded', () => {
  const view = render(<PublicProfileAvatar profile={{}} name="Listener" className="size-14" />);
  view.rerender(<PublicProfileAvatar profile={{ avatar: '/uploads/listener.webp' }} name="Listener" className="size-14" />);
  expect(screen.getByRole('img', { name: 'Listener' })).toHaveAttribute('src', '/uploads/listener.webp');
  fireEvent.error(screen.getByRole('img', { name: 'Listener' }));
  expect(screen.getByRole('img', { name: 'Listener' }).tagName.toLowerCase()).toBe('svg');
  view.rerender(<PublicProfileAvatar profile={{ avatar: '/uploads/new.webp' }} name="Listener" className="size-14" />);
  expect(screen.getByRole('img', { name: 'Listener' })).toHaveAttribute('src', '/uploads/new.webp');
});

it('legacy profile avatars use the same fallback without a missing /no-avatar.svg request', () => {
  const view = render(<UserAvatar avatar="/missing.jpg" name="Listener" size="sm" />);
  fireEvent.error(screen.getByRole('img', { name: 'Listener' }));
  expect(screen.getByRole('img', { name: 'Listener' }).tagName.toLowerCase()).toBe('svg');
  expect(view.container.querySelector('img')).toBeNull();
  expect(view.container.firstElementChild).toHaveClass('h-8', 'w-8');
});
