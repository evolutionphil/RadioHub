import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ location: '/admin/stations' }));
vi.mock('wouter', () => ({
  useLocation: () => [state.location, vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href} onClick={event => event.preventDefault()}>{children}</a>,
}));
import Sidebar from '../src/components/layout/sidebar';

const groupButtons = (name: string) => screen.getAllByRole('button', { name, exact: true });
const expectExpanded = (name: string, expanded: boolean) => groupButtons(name).forEach(button => expect(button).toHaveAttribute('aria-expanded', String(expanded)));
beforeEach(() => { state.location = '/admin/stations'; });

describe('admin sidebar route-aware expansion', () => {
  it('allows the active group to collapse and keeps it collapsed on ordinary rerenders', () => {
    const close = vi.fn();
    const { rerender } = render(<Sidebar isMobileMenuOpen={false} setIsMobileMenuOpen={close} />);
    expectExpanded('Station Management', true);
    const toggle = groupButtons('Station Management')[0];
    toggle.focus(); fireEvent.click(toggle);
    expectExpanded('Station Management', false);
    expect(toggle).toHaveFocus();
    expect(screen.queryByRole('link', { name: 'All Stations' })).not.toBeInTheDocument();
    rerender(<Sidebar isMobileMenuOpen setIsMobileMenuOpen={close} />);
    expectExpanded('Station Management', false);
    // Desktop and mobile use the same manual expansion state.
    fireEvent.click(groupButtons('Station Management')[1]);
    expectExpanded('Station Management', true);
    expect(screen.getAllByRole('link', { name: 'All Stations' })).toHaveLength(2);
  });
  it('opens active ancestors again only on a real route change', () => {
    const close = vi.fn(); const { rerender } = render(<Sidebar isMobileMenuOpen={false} setIsMobileMenuOpen={close} />);
    fireEvent.click(groupButtons('Station Management')[0]);
    state.location = '/admin/genres';
    rerender(<Sidebar isMobileMenuOpen={false} setIsMobileMenuOpen={close} />);
    expectExpanded('Content Management', true); expectExpanded('Station Management', false);
    state.location = '/admin/stations';
    rerender(<Sidebar isMobileMenuOpen={false} setIsMobileMenuOpen={close} />);
    expectExpanded('Station Management', true);
  });
  it('opens all nested payment ancestors but permits each to close and preserves mobile navigation', () => {
    state.location = '/admin/paddle-plans';
    const close = vi.fn(); render(<Sidebar isMobileMenuOpen setIsMobileMenuOpen={close} />);
    expectExpanded('Settings', true); expectExpanded('Payment Gateway', true);
    fireEvent.click(groupButtons('Payment Gateway')[0]);
    expectExpanded('Payment Gateway', false); expect(screen.queryByRole('link', { name: 'Paddle' })).not.toBeInTheDocument();
    fireEvent.click(groupButtons('Payment Gateway')[1]);
    expectExpanded('Payment Gateway', true);
    fireEvent.click(screen.getAllByRole('link', { name: 'Paddle' })[1].firstElementChild!);
    expect(close).toHaveBeenCalledWith(false);
    fireEvent.click(groupButtons('Settings')[0]); expectExpanded('Settings', false);
    expect(screen.queryByRole('button', { name: 'Payment Gateway' })).not.toBeInTheDocument();
  });
});
