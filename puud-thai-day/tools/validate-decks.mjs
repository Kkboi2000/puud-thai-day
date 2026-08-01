#!/usr/bin/env node
/**
 * validate-decks.mjs — guard rail for the word database.
 *
 *   node tools/validate-decks.mjs
 *
 * Checks that every deck in data/manifest.json exists, parses, and has
 * unique, non-empty cards. Exits 1 on any error so CI can block a bad commit.
 * Zero dependencies — Node 18+.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const errors = [];
const warnings = [];
const seenCardIds = new Map();

const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const manifestPath = join(DATA, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('✖ data/manifest.json is missing');
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!Array.isArray(manifest.decks) || manifest.decks.length === 0) {
  fail('manifest.decks must be a non-empty array of deck paths');
}

let totalCards = 0;
const deckIds = new Set();

for (const rel of manifest.decks ?? []) {
  const path = join(DATA, rel);
  if (!existsSync(path)) { fail(`${rel}: file not found`); continue; }

  let deck;
  try {
    deck = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    fail(`${rel}: invalid JSON — ${e.message}`);
    continue;
  }

  if (!deck.id) fail(`${rel}: missing "id"`);
  else if (deckIds.has(deck.id)) fail(`${rel}: duplicate deck id "${deck.id}"`);
  else deckIds.add(deck.id);

  if (!deck.title || typeof deck.title !== 'object') warn(`${rel}: "title" should be an object keyed by language`);
  if (!Array.isArray(deck.cards) || deck.cards.length === 0) { fail(`${rel}: "cards" must be a non-empty array`); continue; }

  const thaiSeen = new Set();

  deck.cards.forEach((c, i) => {
    const where = `${rel}#${c?.id ?? i}`;
    if (!c || typeof c !== 'object') return fail(`${where}: card is not an object`);
    if (!c.id) fail(`${where}: missing "id"`);
    else if (seenCardIds.has(c.id)) fail(`${where}: card id also used in ${seenCardIds.get(c.id)}`);
    else seenCardIds.set(c.id, rel);

    if (!c.th || !String(c.th).trim()) fail(`${where}: "th" is required`);
    else if (thaiSeen.has(c.th)) warn(`${where}: duplicate Thai "${c.th}" inside this deck`);
    else thaiSeen.add(c.th);

    if (!c.rom) warn(`${where}: no "rom" — audio-free romanization quizzes will skip it`);
    if (!c.en && !c.jp) warn(`${where}: no "en" or "jp" — nothing to translate from`);

    for (const k of Object.keys(c)) {
      if (!['id', 'jp', 'en', 'th', 'rom', 'note', 'tags'].includes(k)) {
        warn(`${where}: unknown field "${k}" (ignored by the app)`);
      }
    }
    totalCards++;
  });
}

for (const w of warnings) console.warn(`⚠ ${w}`);
for (const e of errors) console.error(`✖ ${e}`);

console.log(
  `\n${errors.length ? '✖ FAILED' : '✔ OK'} — ` +
  `${deckIds.size} deck(s), ${totalCards} card(s), ` +
  `${errors.length} error(s), ${warnings.length} warning(s)`,
);

process.exit(errors.length ? 1 : 0);
