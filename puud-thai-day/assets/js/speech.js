/**
 * speech.js — Thai text-to-speech via the browser's own speechSynthesis.
 * No API key, no network call, no audio files in the repo.
 * Availability varies by browser/OS; every call degrades quietly.
 */

let voices = [];
let ready = false;

function refresh() {
  voices = window.speechSynthesis?.getVoices?.() ?? [];
  ready = voices.length > 0;
}

if ('speechSynthesis' in window) {
  refresh();
  window.speechSynthesis.addEventListener('voiceschanged', refresh);
}

export const isSupported = () => 'speechSynthesis' in window;

/** Every Thai voice this browser exposes. */
export function thaiVoices() {
  if (!ready) refresh();
  return voices.filter((v) => /^th(-|_|$)/i.test(v.lang));
}

export const hasThaiVoice = () => thaiVoices().length > 0;

/** All voices, Thai first — the settings dropdown lets you override. */
export function allVoices() {
  if (!ready) refresh();
  const thai = thaiVoices();
  return [...thai, ...voices.filter((v) => !thai.includes(v))];
}

/**
 * Speak Thai text.
 * @returns {Promise<void>} resolves when playback ends (or immediately if unsupported)
 */
export function speak(text, { voiceURI = '', rate = 0.9 } = {}) {
  if (!isSupported() || !text) return Promise.resolve();

  return new Promise((resolve) => {
    window.speechSynthesis.cancel();

    // Strip the "/" alternatives some cards carry — speak the first form only.
    const utter = new SpeechSynthesisUtterance(String(text).split('/')[0].trim());
    utter.lang = 'th-TH';
    utter.rate = rate;
    utter.pitch = 1;

    const pick = allVoices().find((v) => v.voiceURI === voiceURI) ?? thaiVoices()[0];
    if (pick) utter.voice = pick;

    utter.onend = () => resolve();
    utter.onerror = () => resolve();

    window.speechSynthesis.speak(utter);
    // Safety net: some engines never fire onend.
    setTimeout(resolve, 6000);
  });
}

export const stop = () => window.speechSynthesis?.cancel();
