import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import React, { Suspense } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const station = readFileSync(path.resolve(process.cwd(), 'src/pages/stations/[id].tsx'), 'utf8');
const carousel = readFileSync(path.resolve(process.cwd(), 'src/components/ad-carousel.tsx'), 'utf8');

// Exercise the actual page's small JSX block without booting station queries,
// the audio player or any advertising SDK in a layout regression test.
const parsed = ts.createSourceFile('station.tsx', station, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let frameNode: ts.JsxElement | undefined;
function findFrame(node: ts.Node) {
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
    ts.isJsxAttribute(attribute) && attribute.name.getText(parsed) === 'data-testid' &&
    attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === 'station-desktop-ad-frame')) frameNode = node;
  ts.forEachChild(node, findFrame);
}
findFrame(parsed);
if (!frameNode) throw new Error('Station desktop reservation frame is missing');
const compiled = ts.transpileModule(`export const Fixture = ({isPremium, showAdvertisements, advertisements}) => (${frameNode.getText(parsed)});`, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

it.each(['auth-loading', 'auth-error', 'google', 'manual', 'failed-manual', 'lazy-loading', 'premium'])
  ('keeps one desktop frame during %s without weakening the advertisement gate', state => {
    const suspended = new Promise(() => {});
    const exports: { Fixture?: React.ComponentType<any> } = {};
    const unit = () => React.createElement('div', { 'data-ad': 'google', style: { minHeight: '90px' } });
    const manual = ({ fallback }: { fallback: React.ReactNode }) => {
      if (state === 'lazy-loading') throw suspended;
      return state === 'failed-manual' ? fallback : React.createElement('div', { 'data-ad': 'manual', style: { width: '218px', height: '218px' } });
    };
    new Function('exports', 'React', 'Suspense', 'AdCarousel', 'AdSenseUnit', 't', compiled)(
      exports, React, Suspense, manual, unit, (_key: string, fallback: string) => fallback,
    );
    const isPremium = state === 'premium';
    const showAdvertisements = !isPremium && !state.startsWith('auth-');
    const advertisements = ['manual', 'failed-manual', 'lazy-loading'].includes(state)
      ? [{ position: 'desktop_sidebar', isActive: true }] : [];
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(React.createElement(exports.Fixture!, { isPremium, showAdvertisements, advertisements }));
    const frame = container.querySelector<HTMLElement>('[data-testid="station-desktop-ad-frame"]')!;
    expect(frame.className).toContain('hidden md:block');
    expect(frame.style.width).toBe(isPremium ? '' : '224px');
    expect(frame.style.flexShrink).toBe(isPremium ? '' : '0');
    expect((frame.firstElementChild as HTMLElement).style.minHeight).toBe(isPremium ? '' : '250px');
    if (!showAdvertisements || state === 'lazy-loading') expect(frame.querySelector('[data-ad]')).toBeNull();
    else expect(frame.querySelector('[data-ad]')?.getAttribute('data-ad')).toBe(state === 'manual' ? 'manual' : 'google');
    if (state === 'manual') expect((frame.querySelector('[data-ad]') as HTMLElement).style.height).toBe('218px');
  });

it('desktop ad placeholders match the existing resolved carousel and AdSense minimum heights', () => {
  const desktop = station.slice(station.indexOf('{/* Desktop Ad Space'), station.indexOf('{/* Player About Section'));
  expect(carousel).toMatch(/case 'desktop_sidebar':\s*return 'w-\[218px\] h-\[218px\]/);
  expect(desktop).toMatch(/fallback=\{<div className="[^"]*w-\[218px\] h-\[218px\][^"]*" \/>\}[\s\S]*?<AdCarousel/);
  expect(desktop).toMatch(/fallback=\{<div className="[^"]*w-56 h-\[250px\][^"]*" \/>\}[\s\S]*?<AdSenseUnit[^>]*className="min-h-\[250px\]"/);
  expect(desktop).not.toMatch(/aspect-square h-56/);
  expect(desktop).toContain('hidden md:block');
  expect(desktop).toContain('showAdvertisements &&');
  expect(station).toContain('const showAdvertisements = !isPremium && !premiumLoading && !premiumError;');
  expect(desktop).toContain('autoSwitchInterval={8000}');
  expect(desktop).toContain('adSlot="3609188113"');
});

for (const variable of ['linkedStation', 'similarStation', 'countryStation']) {
  it(`${variable} title follows its H2 section with an H3 and retains the existing visual classes`, () => {
    const title = station.match(new RegExp(`<h([1-6])\\b([^>]*)>\\s*\\{${variable}\\.name\\}\\s*</h([1-6])>`));
    expect(title).not.toBeNull();
    expect(title![1]).toBe('3'); expect(title![3]).toBe('3');
    if (variable === 'linkedStation') {
      expect(title![2]).toContain('className="text-lg font-semibold text-white truncate mb-1"');
    } else {
      expect(title![2]).toContain('className="text-[16px] font-medium text-white truncate"');
      expect(title![2]).toContain('fontWeight: 500');
    }
  });
}
