import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { safeAuthReturnTo, withAuthReturnTo } from '../src/lib/safe-auth-return';

describe('same-origin auth return targets', () => {
  it.each(['//evil.example/path', '/\\evil.example', '\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/%2Fevil.example', '/%5cevil.example', '/%0aevil', '/%zz', '/\n/evil', null])('rejects unsafe target %s', value => {
    expect(safeAuthReturnTo(value)).toBeNull();
    expect(withAuthReturnTo('/de/login', value)).toBe('/de/login');
  });
  it.each(['/tv?code=ABCD-1234', '/de/premium?plan=yearly#checkout', '/tr/istasyon/kral-fm', '/?q=hello%20world'])('preserves safe returnTo %s through signup/login', value => {
    expect(safeAuthReturnTo(value)).toBe(value);
    const link = withAuthReturnTo('/de/login', value);
    expect(new URL(link, 'https://themegaradio.com').searchParams.get('returnTo')).toBe(value);
  });
  it('both signup routes and login use shared validator/preservation', () => {
    for (const file of ['login.tsx', 'signup.tsx', 'auth/signup.tsx']) {
      const source = readFileSync(path.resolve('src/pages', file), 'utf8');
      expect(source).toContain('safeAuthReturnTo('); expect(source).toContain('withAuthReturnTo(');
      expect(source).not.toContain("returnTo.startsWith('/')");
    }
  });
});
