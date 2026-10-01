import { getHomeHeroCopy } from '@workspace/seo-shared/home-hero-copy';

/** Shared with the initial server HTML: no translation request or copy flash. */
export default function HomeHeroCopy({ language }: { language: string }) {
  const copy = getHomeHeroCopy(language);
  return (
    <div className="home-hero-copy" dir={copy.direction}>
      <p className="home-hero-eyebrow">{copy.eyebrow}</p>
      <h1 className="home-hero-title">{copy.headline}</h1>
      <p className="home-hero-tagline">{copy.tagline}</p>
    </div>
  );
}
