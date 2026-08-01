#!/usr/bin/env node
/**
 * csv-to-deck.mjs — write vocabulary in a spreadsheet, ship it as a deck.
 *
 *   node tools/csv-to-deck.mjs my-words.csv data/decks/my-words.json
 *
 * The CSV needs a header row containing any of: jp, en, th, rom, id, note.
 * Column order does not matter; unknown columns are ignored.
 * Zero dependencies — Node 18+.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node tools/csv-to-deck.mjs <input.csv> <output.json>');
  process.exit(1);
}

/** Minimal RFC-4180 parser: handles quotes, embedded commas and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const rows = parseCsv(await readFile(inPath, 'utf8'));
const header = rows.shift().map((h) => h.trim().toLowerCase());
const col = (name) => header.indexOf(name);

const id = basename(outPath).replace(/\.json$/, '');
const at = (r, name) => (col(name) >= 0 ? (r[col(name)] ?? '').trim() : '');

const cards = rows.map((r, i) => {
  const card = {
    id: at(r, 'id') || `${id}-${String(i + 1).padStart(3, '0')}`,
    jp: at(r, 'jp'),
    en: at(r, 'en'),
    th: at(r, 'th'),
    rom: at(r, 'rom'),
  };
  const note = at(r, 'note');
  if (note) card.note = { en: note };
  return card;
}).filter((c) => c.th);

const deck = {
  id,
  title: { en: id.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) },
  description: { en: `Imported from ${basename(inPath)}` },
  level: 'beginner',
  tags: [],
  version: 1,
  cards,
};

await writeFile(outPath, `${JSON.stringify(deck, null, 2)}\n`, 'utf8');
console.log(`✔ wrote ${outPath} — ${cards.length} card(s)`);
console.log('  Remember to add it to data/manifest.json, then run tools/validate-decks.mjs');
