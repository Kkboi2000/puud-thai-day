/**
 * speech.js — Thai text-to-speech via the browser's own speechSynthesis.
 *
 * No API key, no network call at runtime, no audio files in the repo.
 * The catch is that voice quality and even availability are the device's
 * decision, not ours. So this module does four things the naive version
 * of it did not:
 *
 *   1. RANKS voices instead of taking the first Thai one it finds.
 *      A network voice (Google ไทย) is dramatically better than a local
 *      formant synth, so we score and sort rather than guess.
 *   2. REFUSES to speak Thai with a non-Thai voice. An English engine
 *      reading Thai script produces noise, which is worse than silence.
 *   3. WAITS for voices properly. getVoices() is empty on first call in
 *      most browsers; some fire 'voiceschanged', some never do. We race
 *      the event against a poll.
 *   4. PRIMES the engine on the first user gesture, because Chrome drops
 *      the first utterance and iOS refuses any utterance not descended
 *      from a real interaction.
 */

/* ── voice discovery ───────────────────────────────────────── */

const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

let voices = [];
const listeners = new Set();

let resolveReady;
const readyPromise = new Promise((r) => { resolveReady = r; });
let settled = false;

function harvest() {
  if (!supported) return false;
  const next = window.speechSynthesis.getVoices() ?? [];
  const same = next.length === voices.length
    && next.every((v, i) => v.voiceURI === voices[i]?.voiceURI);
  if (same) return next.length > 0;

  voices = next;
  listeners.forEach((fn) => { try { fn(); } catch { /* listener's problem */ } });
  return voices.length > 0;
}

if (supported) {
  harvest();
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    if (harvest() && !settled) { settled = true; resolveReady(); }
  });

  // Belt and braces: a few engines populate the list without ever firing
  // 'voiceschanged'. Poll briefly, then give up and report what we have.
  let tries = 0;
  const poll = setInterval(() => {
    if (harvest() || ++tries > 24) {          // ~6s
      clearInterval(poll);
      if (!settled) { settled = true; resolveReady(); }
    }
  }, 250);
} else {
  settled = true;
  resolveReady();
}

/** Resolves once the voice list is populated (or we have stopped waiting). */
export const ready = () => readyPromise;

/** Fires whenever the available voice list changes. Returns an unsubscribe fn. */
export function onVoicesChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const isSupported = () => supported;

/* ── ranking ───────────────────────────────────────────────── */

const isThai = (v) => /^th(-|_|$)/i.test(v.lang);

/**
 * Higher is better. The heuristic that actually matters: network voices
 * are neural, local ones usually are not.
 */
function score(v) {
  let s = 0;
  if (!v.localService) s += 40;                                      // network / neural
  if (/google/i.test(v.name)) s += 25;                               // Google ไทย
  if (/kanya|premwadee|niwat|achara|pattara/i.test(v.name)) s += 15;  // named OS voices
  if (/enhanced|premium|neural/i.test(v.name)) s += 20;
  if (/compact|espeak|festival|pico/i.test(v.name)) s -= 40;         // formant synths
  if (v.default) s += 2;                                             // tie-break only
  return s;
}

/** Thai voices, best first. */
export function thaiVoices() {
  return voices.filter(isThai).sort((a, b) => score(b) - score(a));
}

export const hasThaiVoice = () => thaiVoices().length > 0;

/** The voice we would pick if the user has not chosen one. */
export const bestThaiVoice = () => thaiVoices()[0] ?? null;

/** Thai voices first, then the rest. */
export function allVoices() {
  const thai = thaiVoices();
  return [...thai, ...voices.filter((v) => !isThai(v))];
}

/** Resolve a stored voiceURI, ignoring it if it is gone or is not Thai. */
function resolve(voiceURI) {
  const chosen = voiceURI && voices.find((v) => v.voiceURI === voiceURI);
  if (chosen && isThai(chosen)) return chosen;
  return bestThaiVoice();
}

/** What the UI needs in order to explain the current situation. */
export function status() {
  const best = bestThaiVoice();
  return {
    supported,
    count: thaiVoices().length,
    name: best?.name ?? '',
    /** 'network' voices are the neural ones; 'local' are the robotic ones. */
    quality: best ? (best.localService ? 'local' : 'network') : 'none',
  };
}

/* ── priming ───────────────────────────────────────────────── */

let primed = false;

/**
 * Call from inside a real user gesture, once. Chrome silently swallows the
 * first utterance of a page; iOS rejects any utterance without a gesture
 * ancestor. A silent warm-up buys us both.
 */
export function prime() {
  if (primed || !supported) return;
  primed = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.rate = 2;
    window.speechSynthesis.speak(u);
  } catch { /* nothing to recover from */ }
}

/* ── speaking ──────────────────────────────────────────────── */

/**
 * Strip the things TTS engines stumble over: alternative forms after a
 * slash, parentheticals, ellipses, and terminal punctuation that some
 * voices vocalise as a pause-then-click.
 */
function clean(text) {
  return String(text)
    .split('/')[0]
    .replace(/\([^)]*\)/g, ' ')
    .replace(/…|\.{2,}/g, ' ')
    .replace(/[?!]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Speak Thai text.
 * @returns {Promise<'ok'|'no-voice'|'unsupported'|'empty'|'error'>}
 *          Never rejects — callers can ignore the result safely.
 */
export function speak(text, { voiceURI = '', rate = 0.9 } = {}) {
  if (!supported) return Promise.resolve('unsupported');

  const said = clean(text);
  if (!said) return Promise.resolve('empty');

  const voice = resolve(voiceURI);
  // Refusing beats an English engine mangling Thai script.
  if (!voice) return Promise.resolve('no-voice');

  return new Promise((done) => {
    window.speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(said);
    u.voice = voice;
    u.lang = voice.lang || 'th-TH';
    u.rate = Math.min(1.4, Math.max(0.4, Number(rate) || 0.9));
    u.pitch = 1;
    u.volume = 1;

    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      done(result);
    };

    u.onend = () => finish('ok');
    u.onerror = () => finish('error');

    // Some engines never fire onend. Scale the escape hatch to the phrase.
    const guard = setTimeout(() => finish('ok'), 2500 + said.length * 120);

    window.speechSynthesis.speak(u);
  });
}

export function stop() {
  if (supported) window.speechSynthesis.cancel();
}
