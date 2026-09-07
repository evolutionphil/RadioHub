/** Legacy translation templates are text, never executable JavaScript. */
export function getStationListenLabel(name: string, translate: (key: string, fallback: string) => string, language = 'en'): string {
  const fallback = `${translate('btn_play', 'Play Radio')} — ${name}`;
  const template = translate('seo_listen_to_station', fallback);
  // This exact legacy English default was copied into non-English records.
  // Prefer the existing localized play label without overwriting custom text.
  if (language !== 'en' && template?.trim() === 'Listen to ${station.name}') return fallback;
  // Support the older dotted ${station.name} spelling as well as {name}.
  // Reject incomplete expressions/unknown placeholders rather than exposing
  // code fragments to screen readers. Replace via callback so $& stays literal.
  const placeholder = /\$?\{(?:station\.)?name\}/gi;
  if (typeof template !== 'string' || !template.trim() || /\$?\{/.test(template.replace(placeholder, ''))) return fallback;
  return template.replace(placeholder, () => name);
}
