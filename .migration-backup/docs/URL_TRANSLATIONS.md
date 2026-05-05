# URL Translation System

## Overview

The multilingual URL system automatically translates URL paths based on the user's language, improving SEO and user experience.

## How It Works

### Examples

**Turkish User** (`/tr`):
- `/tr/genres` → `/tr/türler`
- `/tr/recommendations` → `/tr/sizin-icin`
- `/tr/discover-music` → `/tr/muzik-kesif`

**Spanish User** (`/es`):
- `/es/genres` → `/es/generos`
- `/es/recommendations` → `/es/recomendaciones`
- `/es/discover-music` → `/es/descubrir-musica`

**English User** (`/` or `/en`):
- Remains in English (no translation)

## Configuration

All URL translations are defined in `shared/url-translations.ts`

## Usage in Components

```typescript
import { useSeoRouting } from '@/hooks/useSeoRouting';

function MyComponent() {
  const { getLocalizedUrl } = useSeoRouting();
  
  return (
    <Link href={getLocalizedUrl('/genres')}>
      View Genres
    </Link>
  );
}
```

## Adding New Languages

1. Open `shared/url-translations.ts`
2. Add a new language object with all translations
3. System automatically picks it up!

## SEO Benefits

- **Native URLs** - Users see familiar language
- **Better indexing** - Search engines understand content
- **Higher CTR** - People click localized URLs
- **Trust signals** - Professional appearance

## Supported Languages

- ✅ Turkish (tr)
- ✅ Spanish (es)
- ✅ French (fr)
- ✅ German (de)
