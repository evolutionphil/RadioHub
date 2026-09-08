import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Route, Router, Switch, useLocation } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { getLanguageFromPath, SEO_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { reverseTranslateUrl, translateUrl } from '@workspace/seo-shared/url-translations';

// Exercise the installed router against actual static PlayerWrapper mounts,
// not a second hand-maintained set of patterns that could hide a broken mount.
const app = readFileSync('src/App.tsx', 'utf8');
const patterns = [...app.matchAll(/<Route path="([^"]+)" component=\{PlayerWrapper\} \/>/g)].map(match => match[1]);
const accountPaths = ['/premium/success', '/activate/success', '/profile/messages/partner-id'];

function ResolvedAccountPage() {
  const [location] = useLocation();
  const { language, cleanPath } = getLanguageFromPath(location);
  const englishPath = reverseTranslateUrl(cleanPath, language);
  return <div>{accountPaths.includes(englishPath) ? englishPath : '404'}</div>;
}

afterEach(cleanup);

for (const { code } of SEO_LANGUAGES.filter(language => language.enabled)) {
  it.each(accountPaths)(`${code}: routes %s past the outer switch`, path => {
    const { hook } = memoryLocation({ path: `/${code}${translateUrl(path, code)}` });
    render(<Router hook={hook}><Switch>
      {patterns.map((pattern, index) => <Route key={index} path={pattern} component={ResolvedAccountPage} />)}
      <Route>404</Route>
    </Switch></Router>);
    expect(screen.queryByText('404')).not.toBeInTheDocument();
    expect(screen.getByText(path)).toBeInTheDocument();
  });
}

it('still renders a not-found result for an unknown localized nested page', () => {
  const { hook } = memoryLocation({ path: '/tr/premium/does-not-exist' });
  render(<Router hook={hook}><Switch>
    {patterns.map((pattern, index) => <Route key={index} path={pattern} component={ResolvedAccountPage} />)}
    <Route>404</Route>
  </Switch></Router>);
  expect(screen.getByText('404')).toBeInTheDocument();
});
