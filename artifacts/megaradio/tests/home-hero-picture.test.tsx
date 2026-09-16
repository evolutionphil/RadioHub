import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import HomeHeroPicture from '../src/components/HomeHeroPicture';

let app: Root | undefined;
afterEach(() => { act(() => app?.unmount()); app = undefined; cleanup(); document.body.replaceChildren(); });

function serverRoot() {
  const root = document.createElement('div');
  root.id = 'root';
  root.innerHTML = '<div id="ssr-content"><main><div class="hero-container"><picture><source media="(min-width: 768px)" srcset="/images/hero-bg.webp" type="image/webp"><img src="/images/hero-bg-430w.webp" alt="" class="absolute inset-0 w-full h-full object-cover pointer-events-none z-0" aria-hidden="true" fetchpriority="high" decoding="async" width="1920" height="600"></picture></div></main></div>';
  document.body.appendChild(root);
  return root;
}

it('preserves the exact server picture and image through createRoot, updates and route unmount', () => {
  const root = serverRoot();
  const picture = root.querySelector('picture')!;
  const image = root.querySelector('img')!;
  const source = root.querySelector('source')!;
  function Home() {
    const [show, setShow] = useState(true);
    const [count, setCount] = useState(0);
    return <><button onClick={() => setCount(count + 1)}>Update {count}</button>
      <button onClick={() => setShow(!show)}>Navigate</button>
      {show && <div className="hero-container"><HomeHeroPicture /></div>}</>;
  }
  act(() => { app = createRoot(root); app.render(<Home />); });
  expect(root.querySelector('#ssr-content')).toBeNull();
  expect(root.querySelectorAll('img')).toHaveLength(1);
  expect(root.querySelector('picture')).toBe(picture);
  expect(root.querySelector('img')).toBe(image);
  expect(root.querySelector('source')).toBe(source);
  expect(image.isConnected).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Update 0' }));
  expect(root.querySelector('img')).toBe(image);
  fireEvent.click(screen.getByRole('button', { name: 'Navigate' }));
  expect(image.isConnected).toBe(false);
  expect(root.querySelector('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Navigate' }));
  expect(root.querySelectorAll('img')).toHaveLength(1);
  expect(root.querySelector('img')).not.toBe(image);
  expect(root.querySelector('img')).toHaveAttribute('src', '/images/hero-bg-430w.webp');
});

it('renders the same responsive eager picture on a normal client-side visit', () => {
  const view = render(<HomeHeroPicture />);
  expect(view.container.querySelector('source')).toHaveAttribute('srcset', '/images/hero-bg.webp');
  const image = view.container.querySelector('img');
  expect(image).toHaveAttribute('fetchpriority', 'high');
  expect(image).not.toHaveAttribute('loading', 'lazy');
  expect(image).toHaveAttribute('width', '1920');
  expect(image).toHaveAttribute('height', '600');
});

it('keeps the adopted picture during StrictMode effect replay without duplicating it', () => {
  const root = serverRoot();
  const original = root.querySelector('picture');
  act(() => { app = createRoot(root); app.render(<React.StrictMode><HomeHeroPicture /></React.StrictMode>); });
  expect(root.querySelectorAll('picture')).toHaveLength(1);
  expect(root.querySelector('picture')).toBe(original);
  expect(original?.isConnected).toBe(true);
});

it.each(['image', 'source', 'media', 'style', 'nested-root'])('does not adopt incompatible %s markup', kind => {
  const root = serverRoot();
  const oldImage = root.querySelector('img');
  if (kind === 'image') oldImage?.setAttribute('src', '/other-image.webp');
  if (kind === 'source') root.querySelector('source')?.remove();
  if (kind === 'media') root.querySelector('source')?.setAttribute('media', '(min-width: 900px)');
  if (kind === 'style') oldImage?.setAttribute('class', 'different-geometry');
  if (kind === 'nested-root') root.innerHTML = `<section>${root.innerHTML}</section>`;
  act(() => { app = createRoot(root); app.render(<HomeHeroPicture />); });
  expect(root.querySelectorAll('img')).toHaveLength(1);
  expect(root.querySelector('img')).not.toBe(oldImage);
  expect(root.querySelector('img')).toHaveAttribute('src', '/images/hero-bg-430w.webp');
});
