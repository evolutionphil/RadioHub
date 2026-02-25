# 301 URL Redirect System

## Overview

The Mega Radio platform implements a comprehensive **301 permanent redirect system** to handle URL pattern changes across all 57 supported languages. This ensures SEO equity is preserved and users/bots never encounter 404 errors when URL structures change.

## Implementation

### Architecture

```
Request → Domain Redirect → Trailing Slash Redirect → URL Pattern Redirect → Application Routes
```

### Files

1. **`server/url-redirect-middleware.ts`** - Main redirect logic
2. **`server/index.ts`** - Middleware integration
3. **`shared/url-translations.ts`** - Translation mappings

### Middleware Flow

```typescript
// server/index.ts
app.use(urlRedirectMiddleware); // Runs after domain/trailing slash redirects
```

## Redirect Examples

### German (de)
```
/de/station/example-radio → /de/sender/example-radio (301)
/de/stations → /de/sender (301)
/de/discover-music → /de/musik-entdecken (301)
```

### Turkish (tr)
```
/tr/station/radyo-istanbul → /tr/istasyon/radyo-istanbul (301)
/tr/stations → /tr/istasyonlar (301)
/tr/discover → /tr/kesfet (301)
```

### Spanish (es)
```
/es/station/radio-nacional → /es/estacion/radio-nacional (301)
/es/stations → /es/estaciones (301)
/es/genres → /es/generos (301)
```

### French (fr)
```
/fr/station/france-inter → /fr/station/france-inter (no redirect - same)
/fr/discover-music → /fr/decouvrir-musique (301)
```

## Coverage

- **57 languages** fully supported
- **30+ path segments** per language
- **1,500+ redirect patterns** total
- **Query string preservation** ✅
- **Sub-path support** ✅

## Technical Details

### Redirect Logic

1. **Extract country code** from first URL segment
2. **Validate** language is enabled
3. **Check** if second segment is old English path
4. **Lookup** translated path in URL_TRANSLATIONS
5. **Build** new URL with translated segment
6. **Preserve** remaining path segments and query strings
7. **Redirect** with HTTP 301 status

### Performance

- **Zero database lookups** - uses in-memory translation map
- **Fast path matching** - simple string comparison
- **Minimal overhead** - only runs on potential redirect paths
- **Logged redirects** - for monitoring and debugging

### Query String Handling

```
Old: /de/station/example?autoplay=1&volume=80
New: /de/sender/example?autoplay=1&volume=80
```

Query strings are **automatically preserved** during redirect.

### Sub-Path Handling

```
Old: /de/station/example-radio/comments
New: /de/sender/example-radio/comments
```

All path segments after the translated segment are **preserved exactly**.

## Testing

### Manual Testing

1. Start the application: `npm run dev`
2. Visit an old URL: `http://localhost:5000/de/station/test`
3. Verify redirect to: `http://localhost:5000/de/sender/test`
4. Check HTTP status code is **301** (use browser DevTools Network tab)

### Automated Testing

```bash
npx tsx scripts/test-url-redirects.ts
```

This script:
- Generates all redirect patterns
- Shows examples for each language
- Verifies translation mappings
- Reports total coverage

## SEO Benefits

### ✅ Preserved SEO Equity
- 301 redirects pass **90-99% of link equity**
- Search engines update their index automatically
- No loss of ranking from URL changes

### ✅ Prevents 404 Errors
- Old URLs never return 404
- Users always reach correct content
- Better user experience

### ✅ Clean Analytics
- All traffic consolidated to new URLs
- No split metrics between old/new patterns
- Accurate reporting

### ✅ International SEO
- Language-specific URLs maintained
- Hreflang tags use correct URLs
- Google recognizes country targeting

## Monitoring

### Server Logs

Redirects are logged with the pattern:
```
🔀 SEO 301: /de/station/example → /de/sender/example (translated URL)
```

### Production Monitoring

In production, these logs help:
- Identify redirect patterns being used
- Track SEO migration progress
- Debug any redirect issues

## Configuration

### Adding New Redirects

1. Update `shared/url-translations.ts` with new translation
2. Deploy changes
3. Middleware automatically handles new pattern
4. No server restart needed (hot reload in development)

### Disabling Specific Redirects

To disable redirects for a specific path, remove it from `OLD_ENGLISH_PATHS` array in `server/url-redirect-middleware.ts`.

## Best Practices

### ✅ DO
- Always use 301 for permanent URL changes
- Preserve query strings and fragments
- Log redirects for monitoring
- Test redirects before deploying
- Update sitemaps after redirect deployment

### ❌ DON'T
- Use 302 (temporary) for permanent changes
- Chain multiple redirects (A→B→C)
- Redirect to different domain without user consent
- Remove old URL patterns immediately (keep redirects indefinitely)

## Migration Checklist

When changing URL structure:

- [ ] Add new translations to `url-translations.ts`
- [ ] Update `OLD_ENGLISH_PATHS` if needed
- [ ] Test redirects locally
- [ ] Deploy to production
- [ ] Monitor server logs for redirect patterns
- [ ] Update sitemap.xml
- [ ] Submit updated sitemap to Google Search Console
- [ ] Wait for Google to recrawl (1-2 weeks typically)
- [ ] Verify new URLs in Google Search Console
- [ ] Keep redirects indefinitely (don't remove)

## Related Documentation

- [URL Translation System](./URL-TRANSLATIONS.md)
- [SEO Configuration](./SEO.md)
- [Server-Side Rendering](./SSR.md)
- [Internationalization](./I18N.md)

## Support

For questions or issues with the redirect system, check:
1. Server logs for redirect patterns
2. Browser DevTools Network tab for status codes
3. Test script output for pattern verification
