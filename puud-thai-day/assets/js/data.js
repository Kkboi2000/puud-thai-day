/**
 * data.js — the word database.
 *
 * The database is plain JSON on disk, so adding vocabulary is a text edit
 * and a git commit — no build step, no tooling.
 *
 *   data/manifest.json      { "decks": ["decks/my-deck.json", ...] }
 *   data/decks/*.json       one deck per file (see README for the schema)
 *
 * A card needs at minimum: id, th. Everything else is optional and simply
 * won't be offered as a quiz direction if absent.
 */

const DATA_ROOT = 'data/';

/** Fields a card may carry, in canonical display order. */
export const FIELDS = ['jp', 'en', 'th', 'rom'];

let cache = null;

/** Load every deck listed in the manifest. Resolves to an array of decks. */
export async function loadDecks() {
  if (cache) return cache;

  const manifest = await fetchJson(`${DATA_ROOT}manifest.json`);
  const files = Array.isArray(manifest?.decks) ? manifest.decks : [];

  const settled = await Promise.allSettled(
    files.map((f) => fetchJson(DATA_ROOT + f).then((d) => normalizeDeck(d, f))),
  );

  const decks = [];
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) decks.push(r.value);
    else console.warn('[PuudThaiDay] deck failed to load:', r.reason);
  }

  cache = decks;
  return decks;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** Fill in defaults and drop unusable cards so the rest of the app can trust the shape. */
function normalizeDeck(deck, file) {
  if (!deck || !Array.isArray(deck.cards)) throw new Error(`malformed deck: ${file}`);
  const id = deck.id || file.replace(/^.*\//, '').replace(/\.json$/, '');

  const cards = deck.cards
    .filter((c) => c && c.th)
    .map((c, i) => ({
      id: c.id || `${id}-${String(i + 1).padStart(3, '0')}`,
      jp: c.jp ?? '',
      en: c.en ?? '',
      th: c.th,
      rom: c.rom ?? '',
      note: c.note ?? null,
      deckId: id,
    }));

  return {
    id,
    title: typeof deck.title === 'string' ? { en: deck.title } : (deck.title ?? { en: id }),
    description: deck.description ?? {},
    level: deck.level ?? '',
    tags: deck.tags ?? [],
    cards,
  };
}

/** Deck title in the given UI language, falling back sensibly. */
export function deckTitle(deck, lang) {
  return deck.title?.[lang] ?? deck.title?.en ?? deck.id;
}

/** Flatten selected decks into one card pool. Empty selection = everything. */
export function poolFrom(decks, selectedIds) {
  const chosen = selectedIds?.length ? decks.filter((d) => selectedIds.includes(d.id)) : decks;
  return chosen.flatMap((d) => d.cards);
}

/** Which content languages are actually present on enough cards to quiz with. */
export function availableLangs(pool, threshold = 0.5) {
  if (!pool.length) return [...FIELDS];
  return FIELDS.filter((f) => pool.filter((c) => c[f]).length / pool.length >= threshold);
}
