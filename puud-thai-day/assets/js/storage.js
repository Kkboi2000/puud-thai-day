/**
 * storage.js — everything that outlives a page load.
 * All of it is localStorage: no server, no account, nothing leaves the device.
 *
 *   ptd:settings           display + voice + UI language preferences
 *   ptd:setup              last game setup, so Start is one tap next time
 *   ptd:profiles           ["Krit", "Mai", ...]
 *   ptd:history:<name>     [ sessionRecord, ... ]  newest first
 */

const K = {
  settings: 'ptd:settings',
  setup: 'ptd:setup',
  profiles: 'ptd:profiles',
  history: (name) => `ptd:history:${name}`,
};

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};

const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
};

/* ── settings ──────────────────────────────────────────────── */

export const DEFAULT_SETTINGS = {
  uiLang: 'en',
  /** Exactly one main layer. */
  mainLang: 'th',
  /** Sub layers, rendered in array order within their position group. */
  subLangs: [
    { lang: 'jp', pos: 'above' },
    { lang: 'rom', pos: 'below' },
  ],
  voiceURI: '',
  voiceRate: 0.9,
};

export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...read(K.settings, {}) });
export const saveSettings = (s) => write(K.settings, s);

/* ── last-used game setup ──────────────────────────────────── */

export const DEFAULT_SETUP = {
  decks: [],          // deck ids; empty means "all"
  count: 10,          // number, or 'all'
  timer: 0,           // seconds per question, 0 = no limit
  choices: 4,
  promptLang: 'jp',   // 'jp'|'en'|'th'|'rom'|'audio'|'mix'
  answerLang: 'th',   // 'jp'|'en'|'th'|'rom'|'mix'
  voiceMode: 'demand',// 'off'|'demand'|'auto'
};

export const loadSetup = () => ({ ...DEFAULT_SETUP, ...read(K.setup, {}) });
export const saveSetup = (s) => write(K.setup, s);

/* ── profiles ──────────────────────────────────────────────── */

export const listProfiles = () => read(K.profiles, []);

export function addProfile(name) {
  const clean = String(name).trim().slice(0, 24);
  if (!clean) return null;
  const all = listProfiles();
  const existing = all.find((n) => n.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  all.push(clean);
  write(K.profiles, all);
  return clean;
}

/* ── history ───────────────────────────────────────────────── */

export const loadHistory = (name) => (name ? read(K.history(name), []) : []);

export function saveSession(name, record) {
  if (!name) return;                       // guests leave no trace
  const all = loadHistory(name);
  all.unshift(record);
  write(K.history(name), all.slice(0, 500));
}

export function clearHistory(name) {
  if (name) localStorage.removeItem(K.history(name));
}

/** Aggregate stats for the history screen. */
export function historyStats(rows) {
  if (!rows.length) return { rounds: 0, answered: 0, best: 0, avg: 0 };
  const pcts = rows.map((r) => (r.total ? r.score / r.total : 0));
  return {
    rounds: rows.length,
    answered: rows.reduce((n, r) => n + r.total, 0),
    best: Math.round(Math.max(...pcts) * 100),
    avg: Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100),
  };
}
