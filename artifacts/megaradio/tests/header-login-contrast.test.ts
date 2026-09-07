import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, test} from 'vitest';

test('desktop login retains its geometry and white text meets 4.5:1 in both states', () => {
  const source=readFileSync(resolve(process.cwd(),'src/components/layout/radio-header.tsx'),'utf8');
  const button=source.match(/className="(flex items-center justify-center text-white font-semibold transition-colors[^"]+)"/)?.[1];
  expect(button).toContain('w-[97px] h-[45px] rounded-[25px] text-sm');
  const colors=[...button!.matchAll(/bg-\[#([A-Fa-f0-9]{6})\]/g)].map(m=>m[1]);
  expect(colors).toHaveLength(2);
  for(const hex of colors){
    const c=hex.match(/../g)!.map(h=>parseInt(h,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    const luminance=c[0]*.2126+c[1]*.7152+c[2]*.0722;
    expect(1.05/(luminance+.05)).toBeGreaterThanOrEqual(4.5);
  }
});
