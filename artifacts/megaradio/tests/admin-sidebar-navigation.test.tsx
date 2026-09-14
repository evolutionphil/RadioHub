import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ location: '/admin/stations' }));
vi.mock('wouter', () => ({
  useLocation: () => [state.location, vi.fn()],
  Link: ({ children, href, onClick, ...props }: any) => <a {...props} href={href} onClick={event => { event.preventDefault(); onClick?.(event); }}>{children}</a>,
}));
import Sidebar from '../src/components/layout/sidebar';

const groupButtons = (name: string) => screen.getAllByRole('button', { name, exact: true, hidden: true });
const expectExpanded = (name: string, expanded: boolean) => groupButtons(name).forEach(button => expect(button).toHaveAttribute('aria-expanded', String(expanded)));
beforeEach(() => { state.location = '/admin/stations'; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('admin sidebar route-aware expansion', () => {
  it('finds nested pages without opening each group and restores navigation after clearing', () => {
    render(<Sidebar isMobileMenuOpen={false} setIsMobileMenuOpen={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find admin page' }), { target: { value: 'paddle' } });
    expect(screen.getByRole('link', { name: /Paddle/ })).toHaveAttribute('href', '/admin/paddle-plans');
    expect(screen.queryByRole('link', { name: 'All Stations' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find admin page' }), { target: { value: 'not-a-real-page' } });
    expect(screen.getByRole('status')).toHaveTextContent('No admin pages match');
    fireEvent.click(screen.getByRole('button', { name: 'Clear page search' }));
    expect(screen.getByRole('link', { name: 'All Stations' })).toBeInTheDocument();
  });
  it('keeps keyboard focus inside the open mobile menu and restores its trigger on close', () => {
    const close = vi.fn();
    const trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus();
    const { rerender } = render(<Sidebar isMobileMenuOpen setIsMobileMenuOpen={close} />);
    const panel = screen.getByRole('dialog', { name: 'Admin navigation' });
    const first = panel.querySelector<HTMLElement>('button')!;
    const controls = panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])');
    const last = controls[controls.length - 1];
    expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(last).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' }); expect(first).toHaveFocus();
    rerender(<Sidebar isMobileMenuOpen={false} setIsMobileMenuOpen={close} />);
    expect(trigger).toHaveFocus(); trigger.remove();
  });
  it('hides the closed mobile navigation and supports Escape to close it', () => {
    const close = vi.fn(); const { rerender } = render(<Sidebar isMobileMenuOpen={false} setIsMobileMenuOpen={close} />);
    expect(document.getElementById('admin-mobile-navigation')).toHaveAttribute('inert');
    expect(screen.getAllByRole('link', { name: 'All Stations' })).toHaveLength(1);
    rerender(<Sidebar isMobileMenuOpen setIsMobileMenuOpen={close} />);
    fireEvent.keyDown(document, { key: 'Escape' }); expect(close).toHaveBeenCalledWith(false);
  });
  it('closes the mobile menu and releases its focus trap when resizing to desktop', () => {
    const media = Object.assign(new EventTarget(), { matches: false, media: '(min-width: 768px)' });
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    const removeListener = vi.spyOn(media, 'removeEventListener');
    const trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus();
    function Navigation() {
      const [open, setOpen] = React.useState(true);
      return <Sidebar isMobileMenuOpen={open} setIsMobileMenuOpen={setOpen} />;
    }
    render(<Navigation />);
    expect(screen.getByRole('button', { name: 'Close admin navigation' })).toHaveFocus();
    act(() => { media.matches = true; media.dispatchEvent(new Event('change')); });
    expect(screen.queryByRole('dialog', { name: 'Admin navigation' })).not.toBeInTheDocument();
    expect(document.getElementById('admin-mobile-navigation')).toHaveAttribute('inert');
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(trigger).toHaveFocus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(tab); expect(tab.defaultPrevented).toBe(false);
    trigger.remove();
  });
  it('does not mark a route prefix sibling active', () => {
    state.location = '/admin/coverage/compare'; render(<Sidebar isMobileMenuOpen={false} setIsMobileMenuOpen={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'SEO Coverage' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'SEO Preview' })).not.toHaveAttribute('aria-current');
  });
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
