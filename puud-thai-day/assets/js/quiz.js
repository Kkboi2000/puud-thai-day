/**
 * quiz.js — turns a card pool + a setup into a fixed list of questions.
 *
 * Deterministic once built: the whole round is decided up front, so a slow
 * render or a paused tab can never change what you are asked.
 */

import { FIELDS } from './data.js';

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Languages a card can actually be *asked* in. 'audio' always resolves to Thai. */
const promptable = (card, langs) => langs.filter((l) => card[l]);

/**
 * @param {object[]} pool
 * @param {object} setup see storage.DEFAULT_SETUP
 * @returns {object[]} questions
 */
export function buildQuiz(pool, setup) {
  if (!pool.length) return [];

  const total = setup.count === 'all'
    ? pool.length
    : Math.min(Number(setup.count) || 10, pool.length);

  const langs = FIELDS.filter((f) => pool.some((c) => c[f]));
  const nChoices = Math.max(2, Math.min(Number(setup.choices) || 4, 6));

  const questions = [];
  for (const card of shuffle(pool)) {
    if (questions.length >= total) break;
    const q = makeQuestion(card, pool, setup, langs, nChoices);
    if (q) questions.push(q);
  }
  return questions;
}

function makeQuestion(card, pool, setup, langs, nChoices) {
  const { promptLang, answerLang } = resolveDirection(card, setup, langs);
  if (!answerLang) return null;

  const answerText = card[answerLang];
  if (!answerText) return null;
  if (promptLang !== 'audio' && !card[promptLang]) return null;

  const distractors = buildDistractors(card, pool, answerLang, nChoices - 1);
  if (distractors.length < 1) return null;

  const choices = shuffle([card, ...distractors]);

  return {
    card,
    promptLang,
    answerLang,
    choices,
    answerIndex: choices.indexOf(card),
  };
}

/** Resolve 'mix' into a concrete pair, honouring "never ask and answer in the same language". */
function resolveDirection(card, setup, langs) {
  const usable = promptable(card, langs);

  let promptLang = setup.promptLang;
  if (promptLang === 'mix') {
    const opts = [...usable];
    if (setup.voiceMode !== 'off' && card.th) opts.push('audio');
    promptLang = opts.length ? pick(opts) : usable[0];
  }

  const forbidden = promptLang === 'audio' ? 'th' : promptLang;

  let answerLang = setup.answerLang;
  if (answerLang === 'mix' || answerLang === forbidden) {
    const opts = usable.filter((l) => l !== forbidden);
    answerLang = opts.length ? pick(opts) : null;
  }

  return { promptLang, answerLang };
}

/** Wrong options: same language, distinct text, drawn from the same pool. */
function buildDistractors(card, pool, lang, want) {
  const seen = new Set([card[lang]]);
  const out = [];
  for (const c of shuffle(pool)) {
    if (out.length >= want) break;
    const text = c[lang];
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(c);
  }
  return out;
}

/** "JP → TH" style label shown above the prompt. */
export function directionLabel(q, shortOf) {
  const from = q.promptLang === 'audio' ? '🔊 TH' : shortOf(q.promptLang);
  return `${from} → ${shortOf(q.answerLang)}`;
}

/** Grade tier used for the summary line and history colouring. */
export function grade(pct) {
  if (pct >= 90) return { tier: 1, key: 'gradeA' };
  if (pct >= 70) return { tier: 2, key: 'gradeB' };
  if (pct >= 50) return { tier: 3, key: 'gradeC' };
  return { tier: 4, key: 'gradeD' };
}
