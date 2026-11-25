// The app's own translations (Localizable and PlaceNames catalogs, exported to JSON by
// tools/build-atlas-data.py). Strings are looked up by the app's English key; %@ / %lld /
// positional %1$@ arguments and plural substitutions work as in the String Catalogs.

export const LANGUAGES = [
  ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['de', 'Deutsch'],
  ['pt-BR', 'Português (Brasil)'], ['it', 'Italiano'], ['fr', 'Français'],
];
const SUPPORTED = LANGUAGES.map(([code]) => code);

export function preferredLanguage(saved) {
  if (saved && SUPPORTED.includes(saved)) return saved;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const lower = tag.toLowerCase();
    if (lower.startsWith('pt')) return 'pt-BR';
    const base = lower.split('-')[0];
    const hit = SUPPORTED.find((c) => c.toLowerCase() === base);
    if (hit) return hit;
  }
  return 'en';
}

let table = { ui: {}, places: {} }, lang = 'en', plural = new Intl.PluralRules('en'), regions = null, numbers = null;

export async function useLanguage(code) {
  lang = code;
  const response = await fetch(`./data/i18n/${code}.json`, { cache: 'force-cache' });
  table = await response.json();
  plural = new Intl.PluralRules(code);
  regions = new Intl.DisplayNames([code], { type: 'region', fallback: 'none' });
  numbers = new Intl.NumberFormat(code);
  document.documentElement.lang = code;
  return code;
}

export const language = () => lang;
export const isCJK = () => lang === 'ja' || lang === 'ko';

const SPEC = /%(?:(\d+)\$)?(@|lld|ld|d|lf|f|%)/g;

function format(template, args) {
  let next = 0;
  return template.replace(SPEC, (_, pos, kind) => {
    if (kind === '%') return '%';
    const i = pos ? Number(pos) - 1 : next++;
    const v = args[i];
    if (kind === '@') return v == null ? '' : String(v);
    return typeof v === 'number' ? numbers?.format(v) ?? String(v) : String(v ?? '');
  });
}

/**
 * t('%lld of %lld %@ visited', 3, 47, 'prefectures'): the app's key, then its arguments in
 * the English order. Plural keys pick their forms from the numbers given.
 */
export function t(key, ...args) {
  const entry = table.ui[key] ?? key;
  if (typeof entry === 'string') return format(entry, args);
  // Plural: the value holds %#@name@ tokens; each names the argument it counts.
  let next = 0;
  const value = entry.value.replace(/%(?:(\d+)\$)?#@(\w+)@/g, (_, pos, name) => {
    const sub = entry.subs[name];
    const argIndex = sub.arg ? sub.arg - 1 : (pos ? Number(pos) - 1 : next);
    next++;
    const n = Number(args[argIndex]);
    const form = sub[plural.select(n)] ?? sub.other ?? '';
    return form.replace(/%(?:\d+\$)?(?:arg|lld|d)/g, numbers?.format(n) ?? String(n));
  });
  return format(value, args);
}

/** A country's or territory's name for its ISO code; English uses the atlas's own names. */
export function countryName(id, english) {
  if (lang === 'en') return english;
  try { return regions.of(id) || english; } catch { return english; }
}

/** A city, landmark, state, province or region, as an atlas in this language prints it. */
export const placeName = (english) => (lang === 'en' ? english : table.places[english] ?? english);

/** Small-caps tracking: CJK scripts set tight, others tracked out (LegendText). */
export const tracking = () => (isCJK() || lang.startsWith('zh') ? '0.2px' : '1.1px');

export const upper = (s) => s.toLocaleUpperCase(lang);
