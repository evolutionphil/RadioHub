import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const station = readFileSync(path.resolve(process.cwd(), 'src/pages/stations/[id].tsx'), 'utf8');
const carousel = readFileSync(path.resolve(process.cwd(), 'src/components/ad-carousel.tsx'), 'utf8');

it('desktop ad placeholders match the existing resolved carousel and AdSense minimum heights', () => {
  const desktop = station.slice(station.indexOf('{/* Desktop Ad Space'), station.indexOf('{/* Player About Section'));
  expect(carousel).toMatch(/case 'desktop_sidebar':\s*return 'w-\[218px\] h-\[218px\]/);
  expect(desktop).toMatch(/fallback=\{<div className="[^"]*w-\[218px\] h-\[218px\][^"]*" \/>\}[\s\S]*?<AdCarousel/);
  expect(desktop).toMatch(/fallback=\{<div className="[^"]*w-56 h-\[250px\][^"]*" \/>\}[\s\S]*?<AdSenseUnit[^>]*className="min-h-\[250px\]"/);
  expect(desktop).not.toMatch(/aspect-square h-56/);
  expect(desktop).toContain('hidden md:block');
  expect(desktop).toContain('!isPremium &&');
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
