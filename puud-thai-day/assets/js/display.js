/**
 * display.js — the layered phrase renderer.
 *
 * A phrase is drawn as a stack:
 *
 *      ▲ sub lines   (small, muted)
 *        MAIN LINE   (large)
 *      ▼ sub lines   (small, muted)
 *
 * Exactly one main; any number of subs, each pinned above or below.
 * The same renderer draws the answer reveal, the review list and the
 * settings preview, so what you configure is literally what you see.
 */

const put = (parent, cls, lang, text) => {
  if (!text) return null;
  const el = document.createElement('div');
  el.className = `phrase-line phrase-line--${cls}`;
  el.dataset.lang = lang;
  el.textContent = text;
  parent.appendChild(el);
  return el;
};

/**
 * Full layered rendering of a card.
 * @param {object} card
 * @param {{mainLang:string, subLangs:{lang:string,pos:string}[]}} layers
 * @param {HTMLElement} [into] reuse an existing node
 */
export function renderPhrase(card, layers, into) {
  const root = into ?? document.createElement('div');
  if (!into) root.className = 'phrase';
  root.textContent = '';

  const subs = layers.subLangs ?? [];
  subs.filter((s) => s.pos === 'above' && s.lang !== layers.mainLang)
      .forEach((s) => put(root, 'sub', s.lang, card[s.lang]));

  put(root, 'main', layers.mainLang, card[layers.mainLang]) ||
    // main layer empty for this card — fall back so nothing renders blank
    put(root, 'main', 'th', card.th);

  subs.filter((s) => s.pos === 'below' && s.lang !== layers.mainLang)
      .forEach((s) => put(root, 'sub', s.lang, card[s.lang]));

  return root;
}

/** A single language, drawn as the main line. Used for prompts and choices. */
export function renderOne(card, lang, into) {
  const root = into ?? document.createElement('div');
  if (!into) root.className = 'phrase';
  root.textContent = '';
  put(root, 'main', lang, card[lang] || card.th);
  return root;
}

/** The card used to preview layer settings — real content, not lorem. */
export const SAMPLE_CARD = {
  jp: 'そういえば',
  en: 'Speaking of which',
  th: 'จะว่าไป',
  rom: 'cà wâa pai',
};
