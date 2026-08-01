/**
 * app.js — screens, wiring, and the round loop.
 *
 * Flow:  title → setup → play → summary → (history)
 * Guests never touch storage; users write one record per finished round.
 */

import * as I18N from './i18n.js';
import * as Store from './storage.js';
import * as Data from './data.js';
import * as Speech from './speech.js';
import { renderPhrase, renderOne, SAMPLE_CARD } from './display.js';
import { buildQuiz, directionLabel, grade } from './quiz.js';

const $ = (s, r = document) => r.querySelector(s);

/**
 * The DOM is a separate file that users upload by hand, so it can lag behind
 * the JS. A missing node should degrade one feature, never kill init().
 */
const on = (sel, handler) => { const n = $(sel); if (n) n.onclick = handler; return n; };
const setHidden = (sel, v) => { const n = $(sel); if (n) n.hidden = v; return n; };

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ── state ─────────────────────────────────────────────────── */

const S = {
  decks: [],
  pool: [],
  settings: Store.loadSettings(),
  setup: Store.loadSetup(),
  profile: null,          // null === guest
  screen: 'title',
  round: null,            // live round, see startRound()
};

const layers = () => ({ mainLang: S.settings.mainLang, subLangs: S.settings.subLangs });
const isGuest = () => !S.profile;

/* ── boot ──────────────────────────────────────────────────── */

init();

async function init() {
  I18N.setUiLang(S.settings.uiLang);
  wireChrome();
  wireTitle();
  wireSetup();
  wirePlay();
  wireSummary();
  wireHistory();
  wireSettings();
  renderProfileChips();

  try {
    S.decks = await Data.loadDecks();
  } catch (err) {
    console.error(err);
    toast('Could not load data/manifest.json — run this over http://, not file://');
  }
  renderDecks();
  refreshPool();

  // Voices populate asynchronously and inconsistently across browsers.
  // Refresh anything that describes them once the list settles.
  Speech.onVoicesChanged(onVoices);
  Speech.ready().then(onVoices);
}

function onVoices() {
  renderVoiceStatus();
  if (!$('#modal-settings').hidden) renderVoiceSelect();
}

/* ── navigation ────────────────────────────────────────────── */

function show(name) {
  Speech.stop();                       // never let a phrase trail into the next screen
  S.screen = name;
  document.querySelectorAll('.screen').forEach((sc) => {
    sc.classList.toggle('is-active', sc.id === `screen-${name}`);
  });
  $('#topbar').hidden = name === 'title';
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function setProfile(name) {
  S.profile = name || null;
  const chip = $('#who-chip');
  chip.hidden = false;
  chip.textContent = name || I18N.t('guest');
  $('#set-profile-name').textContent = name || I18N.t('guest');
  $('#btn-setup-history').hidden = isGuest();
}

/* ── chrome (topbar + modal + toast) ───────────────────────── */

function wireChrome() {
  $('#btn-home').onclick = () => {
    if (S.screen === 'play' && !confirm(I18N.t('quitConfirm'))) return;
    stopTimer();
    show('title');
    renderProfileChips();
  };
  $('#btn-settings').onclick = openSettings;

  // Chrome swallows the first utterance of a page and iOS refuses any
  // utterance without a gesture ancestor. One silent warm-up fixes both.
  document.addEventListener('pointerdown', () => Speech.prime(), { once: true });
  document.addEventListener('keydown', () => Speech.prime(), { once: true });

  document.addEventListener('keydown', onKey);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ── 1. title ──────────────────────────────────────────────── */

function wireTitle() {
  $('#btn-guest').onclick = () => { setProfile(null); goSetup(); };
  $('#btn-user-go').onclick = () => {
    const name = Store.addProfile($('#input-name').value);
    if (!name) return toast(I18N.t('nameNeeded'));
    $('#input-name').value = '';
    setProfile(name);
    renderProfileChips();
    goSetup();
  };
  $('#input-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-user-go').click();
  });
}

function renderProfileChips() {
  const names = Store.listProfiles();
  const wrap = $('#gate-profiles');
  const box = $('#profile-chips');
  wrap.hidden = names.length === 0;
  box.textContent = '';
  names.slice(-6).reverse().forEach((n) => {
    const b = el('button', null, n);
    b.type = 'button';
    b.onclick = () => { setProfile(n); goSetup(); };
    box.appendChild(b);
  });
}

function goSetup() {
  syncSetup();
  show('setup');
}

/* ── 2. setup ──────────────────────────────────────────────── */

/** Build a segmented control. Rebuilt on every language change. */
function seg(node, options, selected, onPick) {
  node.textContent = '';
  options.forEach((o) => {
    const b = el('button', null, o.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(o.value === selected));
    b.onclick = () => onPick(o.value);
    node.appendChild(b);
  });
}

function wireSetup() {
  $('#btn-setup-back').onclick = () => show('title');
  $('#btn-setup-history').onclick = () => { renderHistory(); show('history'); };
  $('#btn-start').onclick = startRound;
  on('#btn-voice-test', async () => {
    const r = await Speech.speak('สวัสดี ยินดีที่ได้รู้จัก', {
      voiceURI: S.settings.voiceURI, rate: S.settings.voiceRate,
    });
    if (r === 'no-voice') toast(I18N.t('vNone'));
    if (r === 'unsupported') toast(I18N.t('vUnsupported'));
  });
}

/** Platform-specific instructions for installing a Thai voice. */
function voiceHelpKey() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'vHelpIOS';
  if (/Mac OS X/.test(ua)) return 'vHelpMac';
  if (/Windows/.test(ua)) return 'vHelpWin';
  return 'vHelpOther';
}

/**
 * Say plainly which voice is in use and how good it is, because the answer
 * is entirely the device's decision and the user can act on it.
 */
function renderVoiceStatus() {
  const warn = $('#voice-warn');
  if (!warn) return;                    // older index.html — skip the readout

  const st = Speech.status();
  const off = S.setup.voiceMode === 'off';

  setHidden('#voice-status', off || st.count === 0);
  warn.hidden = off || st.quality === 'network';

  if (st.count > 0 && $('#voice-name')) {
    $('#voice-name').textContent = st.name;
    const badge = $('#voice-badge');
    badge.textContent = I18N.t(st.quality === 'network' ? 'badgeNeural' : 'badgeBasic');
    badge.classList.toggle('is-local', st.quality === 'local');
    $('#voice-dot').className = `dot ${st.quality === 'network' ? 'is-good' : 'is-ok'}`;
  }

  if (!warn.hidden) {
    if (!st.supported) warn.textContent = I18N.t('vUnsupported');
    else if (st.count === 0) warn.textContent = `${I18N.t('vNone')} ${I18N.t(voiceHelpKey())}`;
    else warn.textContent = I18N.t('vBasic');
  }
}

function renderDecks() {
  const grid = $('#deck-grid');
  grid.textContent = '';
  if (!S.decks.length) {
    grid.appendChild(el('p', 'empty', 'No decks found in data/decks/.'));
    return;
  }
  S.decks.forEach((deck) => {
    const on = S.setup.decks.includes(deck.id);
    const b = el('button', 'deck');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.appendChild(el('span', 'deck-box'));
    const body = el('span', 'deck-body');
    body.appendChild(el('span', 'deck-name', Data.deckTitle(deck, I18N.getUiLang())));
    body.appendChild(el('span', 'deck-meta', `${deck.cards.length} · ${deck.level || '—'}`));
    b.appendChild(body);
    b.onclick = () => {
      const i = S.setup.decks.indexOf(deck.id);
      if (i >= 0) S.setup.decks.splice(i, 1); else S.setup.decks.push(deck.id);
      Store.saveSetup(S.setup);
      renderDecks();
      refreshPool();
    };
    grid.appendChild(b);
  });
}

function refreshPool() {
  S.pool = Data.poolFrom(S.decks, S.setup.decks);
  $('#pool-count').textContent = S.pool.length;
  syncSetup();
}

function syncSetup() {
  const t = I18N.t;
  const short = I18N.langShort;
  const set = (k, v) => { S.setup[k] = v; Store.saveSetup(S.setup); syncSetup(); };

  seg($('#seg-count'),
    [5, 10, 20, 30].map((n) => ({ value: n, label: String(n) }))
      .concat([{ value: 'all', label: t('all') }]),
    S.setup.count, (v) => set('count', v));

  seg($('#seg-timer'),
    [{ value: 0, label: t('off') }, { value: 10, label: '10s' }, { value: 20, label: '20s' }, { value: 30, label: '30s' }],
    S.setup.timer, (v) => set('timer', v));

  seg($('#seg-choices'),
    [2, 4, 6].map((n) => ({ value: n, label: String(n) })),
    S.setup.choices, (v) => set('choices', v));

  const contentOpts = Data.FIELDS.map((f) => ({ value: f, label: short(f) }));

  seg($('#seg-prompt'),
    [...contentOpts, { value: 'audio', label: t('audio') }, { value: 'mix', label: t('mixed') }],
    S.setup.promptLang, (v) => set('promptLang', v));

  seg($('#seg-answer'),
    [...contentOpts, { value: 'mix', label: t('mixed') }],
    S.setup.answerLang, (v) => set('answerLang', v));

  seg($('#seg-voice'),
    [{ value: 'off', label: t('off') }, { value: 'demand', label: t('onDemand') }, { value: 'auto', label: t('auto') }],
    S.setup.voiceMode, (v) => set('voiceMode', v));

  const clash = S.setup.promptLang !== 'mix' && S.setup.answerLang !== 'mix'
    && (S.setup.promptLang === S.setup.answerLang
        || (S.setup.promptLang === 'audio' && S.setup.answerLang === 'th'));
  $('#dir-warn').hidden = !clash;
  $('#btn-start').disabled = clash || S.pool.length === 0;

  renderVoiceStatus();
}

/* ── 3. play ───────────────────────────────────────────────── */

function wirePlay() {
  $('#btn-quit').onclick = () => {
    if (!confirm(I18N.t('quitConfirm'))) return;
    stopTimer();
    show('setup');
  };
  $('#btn-next').onclick = nextQuestion;
  $('#btn-speak').onclick = () => speakCurrent();
  on('#btn-replay', () => speakCurrent($('#btn-replay')));
}

function startRound() {
  if (!S.pool.length) return toast(I18N.t('pickDeck'));
  const questions = buildQuiz(S.pool, S.setup);
  if (!questions.length) return toast(I18N.t('pickDeck'));

  S.round = {
    questions, i: 0, score: 0, streak: 0, bestStreak: 0,
    wrong: [], times: [], answered: false, startedAt: Date.now(),
  };
  show('play');
  renderQuestion();
}

function renderQuestion() {
  const r = S.round;
  const q = r.questions[r.i];
  r.answered = false;
  r.qStart = performance.now();

  $('#hud-index').textContent = `${r.i + 1} / ${r.questions.length}`;
  $('#hud-score').textContent = r.score;
  $('#hud-bar').style.width = `${(r.i / r.questions.length) * 100}%`;
  $('#streak').hidden = r.streak < 2;
  $('#streak-num').textContent = r.streak;

  $('#q-kicker').textContent = directionLabel(q, I18N.langShort);

  const phrase = $('#q-phrase');
  if (q.promptLang === 'audio') {
    phrase.textContent = '';
    const cue = el('div', 'phrase-line phrase-line--main', '🔊');
    cue.dataset.lang = 'audio';
    phrase.appendChild(cue);
  } else {
    renderOne(q.card, q.promptLang, phrase);
  }

  const canSpeak = S.setup.voiceMode !== 'off' && Speech.hasThaiVoice();
  $('#btn-speak').hidden = !canSpeak;
  setHidden('#btn-replay', true);
  if (canSpeak && (S.setup.voiceMode === 'auto' || q.promptLang === 'audio')) {
    speakCurrent();
  }

  renderChoices(q);
  $('#reveal').hidden = true;
  startTimer();
}

function renderChoices(q) {
  const box = $('#choices');
  box.textContent = '';
  q.choices.forEach((card, idx) => {
    const b = el('button', 'choice');
    b.type = 'button';
    b.appendChild(el('span', 'choice-key', String(idx + 1)));
    b.appendChild(renderOne(card, q.answerLang));
    b.onclick = () => answer(idx);
    box.appendChild(b);
  });
}

function speakCurrent(btn = $('#btn-speak')) {
  const q = S.round?.questions[S.round.i];
  if (!q || S.setup.voiceMode === 'off') return Promise.resolve();
  btn?.classList.add('is-playing');
  return Speech.speak(q.card.th, { voiceURI: S.settings.voiceURI, rate: S.settings.voiceRate })
    .then((r) => { if (r === 'no-voice') toast(I18N.t('vNone')); return r; })
    .finally(() => btn?.classList.remove('is-playing'));
}

function answer(idx) {
  const r = S.round;
  if (!r || r.answered) return;
  r.answered = true;
  stopTimer();
  Speech.stop();

  const q = r.questions[r.i];
  const correct = idx === q.answerIndex;
  const seconds = (performance.now() - r.qStart) / 1000;
  r.times.push(seconds);

  if (correct) {
    r.score++;
    r.streak++;
    r.bestStreak = Math.max(r.bestStreak, r.streak);
  } else {
    r.streak = 0;
    r.wrong.push(q);
  }

  document.querySelectorAll('.choice').forEach((b, i) => {
    b.disabled = true;
    if (i === q.answerIndex) b.classList.add('is-right');
    else if (i === idx) b.classList.add('is-wrong');
    else b.classList.add('is-dim');
  });

  $('#hud-score').textContent = r.score;

  const verdict = $('#reveal-verdict');
  verdict.textContent = idx < 0 ? I18N.t('timeUp') : (correct ? I18N.t('correct') : I18N.t('wrong'));
  verdict.className = `reveal-verdict ${correct ? 'ok' : 'no'}`;
  renderPhrase(q.card, layers(), $('#reveal-card'));

  // Hearing the correct Thai at the moment of correction is where the
  // audio actually teaches something — do it on every reveal, not just
  // when the question itself was audio.
  const canSpeak = S.setup.voiceMode !== 'off' && Speech.hasThaiVoice();
  setHidden('#btn-replay', !canSpeak);
  if (canSpeak) speakCurrent($('#btn-replay'));

  $('#reveal').hidden = false;
  $('#btn-next').focus({ preventScroll: true });
}

function nextQuestion() {
  const r = S.round;
  r.i++;
  if (r.i >= r.questions.length) finishRound();
  else renderQuestion();
}

/* timer -------------------------------------------------------- */

let timerRaf = null;
const CIRC = 2 * Math.PI * 19;

function startTimer() {
  stopTimer();
  const secs = Number(S.setup.timer) || 0;
  const box = $('#timer');
  box.hidden = secs === 0;
  if (!secs) return;

  const end = performance.now() + secs * 1000;
  box.classList.remove('is-low');

  const tick = () => {
    const left = Math.max(0, end - performance.now());
    const frac = left / (secs * 1000);
    $('#timer-run').style.strokeDashoffset = String(CIRC * (1 - frac));
    $('#timer-num').textContent = Math.ceil(left / 1000);
    box.classList.toggle('is-low', frac < 0.25);
    if (left <= 0) { timerRaf = null; answer(-1); return; }
    timerRaf = requestAnimationFrame(tick);
  };
  timerRaf = requestAnimationFrame(tick);
}

function stopTimer() {
  if (timerRaf) cancelAnimationFrame(timerRaf);
  timerRaf = null;
}

/* ── 4. summary ────────────────────────────────────────────── */

function wireSummary() {
  $('#btn-sum-back').onclick = () => show('setup');
  $('#btn-sum-main').onclick = () => {
    if (isGuest()) startRound();
    else { renderHistory(); show('history'); }
  };
}

function finishRound() {
  const r = S.round;
  stopTimer();
  const total = r.questions.length;
  const pct = total ? Math.round((r.score / total) * 100) : 0;
  const avg = r.times.length ? r.times.reduce((a, b) => a + b, 0) / r.times.length : 0;

  if (!isGuest()) {
    Store.saveSession(S.profile, {
      at: Date.now(),
      score: r.score,
      total,
      avgTime: Number(avg.toFixed(2)),
      bestStreak: r.bestStreak,
      decks: [...S.setup.decks],
      dir: `${S.setup.promptLang}->${S.setup.answerLang}`,
      timer: S.setup.timer,
    });
  }

  $('#sum-score').textContent = r.score;
  $('#sum-of').textContent = `/ ${total}`;
  $('#sum-pct').textContent = `${pct}%`;
  $('#sum-time').textContent = `${avg.toFixed(1)}s`;
  $('#sum-streak').textContent = r.bestStreak;
  $('#sum-grade').textContent = I18N.t(grade(pct).key);

  const ring = $('#ring-run');
  ring.style.strokeDashoffset = '326.7';
  requestAnimationFrame(() => {
    ring.style.strokeDashoffset = String(326.7 * (1 - pct / 100));
  });

  const panel = $('#sum-review-panel');
  const list = $('#sum-review');
  list.textContent = '';
  panel.hidden = r.wrong.length === 0;
  r.wrong.forEach((q) => {
    const row = el('div', 'review-item');
    row.appendChild(renderPhrase(q.card, layers()));
    list.appendChild(row);
  });

  $('#btn-sum-main').textContent = isGuest() ? I18N.t('playAgain') : I18N.t('history');
  show('summary');
}

/* ── 5. history ────────────────────────────────────────────── */

function wireHistory() {
  $('#btn-hist-back').onclick = () => show('setup');
  $('#btn-hist-play').onclick = startRound;
  $('#btn-clear').onclick = () => {
    if (!confirm(I18N.t('clearConfirm'))) return;
    Store.clearHistory(S.profile);
    renderHistory();
    toast(I18N.t('cleared'));
  };
  $('#btn-export').onclick = exportHistory;
}

function renderHistory() {
  const rows = Store.loadHistory(S.profile);
  const st = Store.historyStats(rows);

  const stats = $('#hist-stats');
  stats.textContent = '';
  [
    [st.rounds, 'rounds_'], [st.answered, 'answered'],
    [`${st.best}%`, 'bestScore'], [`${st.avg}%`, 'average'],
  ].forEach(([num, key]) => {
    const box = el('div', 'stat');
    box.appendChild(el('span', 'stat-num mono', String(num)));
    box.appendChild(el('span', 'stat-key', I18N.t(key)));
    stats.appendChild(box);
  });

  const spark = $('#hist-spark');
  spark.textContent = '';
  const recent = rows.slice(0, 12).reverse();
  if (!recent.length) spark.appendChild(el('p', 'empty', I18N.t('noHistory')));
  recent.forEach((r) => {
    const pct = r.total ? Math.round((r.score / r.total) * 100) : 0;
    const col = el('div', 'spark-col');
    const bar = el('div', 'spark-bar');
    bar.style.height = `${Math.max(4, pct)}%`;
    bar.title = `${pct}%`;
    col.appendChild(bar);
    col.appendChild(el('span', 'spark-lab', `${pct}`));
    spark.appendChild(col);
  });

  const list = $('#hist-list');
  list.textContent = '';
  if (!rows.length) { list.appendChild(el('p', 'empty', I18N.t('noHistory'))); return; }
  rows.forEach((r) => {
    const pct = r.total ? Math.round((r.score / r.total) * 100) : 0;
    const row = el('div', 'hist-row');
    row.appendChild(el('span', `hist-pct t${grade(pct).tier}`, `${pct}%`));
    const mid = el('div', 'hist-mid');
    mid.appendChild(el('span', 'hist-when', new Date(r.at).toLocaleString()));
    mid.appendChild(el('span', 'hist-tags',
      `${r.dir} · ${r.timer ? `${r.timer}s` : '∞'} · 🔥${r.bestStreak} · ${r.avgTime}s`));
    row.appendChild(mid);
    row.appendChild(el('span', 'hist-raw', `${r.score}/${r.total}`));
    list.appendChild(row);
  });
}

function exportHistory() {
  const data = { profile: S.profile, exported: new Date().toISOString(), rounds: Store.loadHistory(S.profile) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = `puudthaiday-${S.profile || 'guest'}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(I18N.t('exported'));
}

/* ── settings modal ────────────────────────────────────────── */

function wireSettings() {
  const modal = $('#modal-settings');
  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeSettings();
  });
  $('#btn-switch-user').onclick = () => { closeSettings(); show('title'); renderProfileChips(); };
  const voiceSel = $('#voice-select');
  if (voiceSel) voiceSel.onchange = (e) => {
    S.settings.voiceURI = e.target.value;
    Store.saveSettings(S.settings);
    renderVoiceStatus();
    Speech.speak('สวัสดี ยินดีที่ได้รู้จัก', { voiceURI: S.settings.voiceURI, rate: S.settings.voiceRate });
  };
  const rate = $('#voice-rate');
  if (rate) rate.oninput = (e) => {
    S.settings.voiceRate = Number(e.target.value);
    $('#voice-rate-val').textContent = `${S.settings.voiceRate.toFixed(2)}×`;
    Store.saveSettings(S.settings);
  };
}

function openSettings() {
  renderSettings();
  $('#modal-settings').hidden = false;
}

function closeSettings() {
  $('#modal-settings').hidden = true;
  Store.saveSettings(S.settings);
}

function renderSettings() {
  seg($('#seg-ui-lang'),
    I18N.UI_LANGS.map((l) => ({ value: l.id, label: l.label })),
    S.settings.uiLang,
    (v) => {
      S.settings.uiLang = v;
      Store.saveSettings(S.settings);
      I18N.setUiLang(v);
      renderSettings();
      renderDecks();
      syncSetup();
      setProfile(S.profile);
      if (S.screen === 'history') renderHistory();
    });

  seg($('#seg-main-lang'),
    Data.FIELDS.map((f) => ({ value: f, label: I18N.langShort(f) })),
    S.settings.mainLang,
    (v) => {
      S.settings.mainLang = v;
      S.settings.subLangs = S.settings.subLangs.filter((s) => s.lang !== v);
      Store.saveSettings(S.settings);
      renderSettings();
    });

  renderLayerList();
  renderPhrase(SAMPLE_CARD, layers(), $('#layer-preview'));
  renderVoiceSelect();
  $('#set-profile-name').textContent = S.profile || I18N.t('guest');
}

function renderLayerList() {
  const list = $('#layer-list');
  list.textContent = '';

  Data.FIELDS.forEach((lang) => {
    const isMain = lang === S.settings.mainLang;
    const sub = S.settings.subLangs.find((s) => s.lang === lang);

    const row = el('div', 'layer-row');
    const name = el('span', `layer-name${isMain ? ' is-main' : ''}`,
      `${I18N.langShort(lang)} · ${I18N.langLabel(lang)}`);
    row.appendChild(name);

    if (isMain) {
      row.appendChild(el('span', 'layer-tag', I18N.t('mainLine').toUpperCase()));
      list.appendChild(row);
      return;
    }

    const pos = el('button', 'pos-toggle', sub?.pos === 'above' ? '▲' : '▼');
    pos.type = 'button';
    pos.disabled = !sub;
    pos.onclick = () => {
      sub.pos = sub.pos === 'above' ? 'below' : 'above';
      Store.saveSettings(S.settings);
      renderSettings();
    };

    const sw = el('button', 'switch');
    sw.type = 'button';
    sw.setAttribute('aria-pressed', String(!!sub));
    sw.setAttribute('aria-label', I18N.langLabel(lang));
    sw.onclick = () => {
      if (sub) S.settings.subLangs = S.settings.subLangs.filter((s) => s.lang !== lang);
      else S.settings.subLangs.push({ lang, pos: 'below' });
      Store.saveSettings(S.settings);
      renderSettings();
    };

    row.appendChild(pos);
    row.appendChild(sw);
    list.appendChild(row);
  });
}

function renderVoiceSelect() {
  const sel = $('#voice-select');
  if (!sel) return;
  // Thai only. Offering an English voice for Thai script would just let
  // someone pick an option that produces nonsense.
  const voices = Speech.thaiVoices();
  const hint = $('#voice-hint') ?? { textContent: '' };
  sel.textContent = '';

  if (!voices.length) {
    sel.appendChild(new Option(I18N.t('noVoice'), ''));
    sel.disabled = true;
    hint.textContent = `${I18N.t('vNone')} ${I18N.t(voiceHelpKey())}`;
  } else {
    sel.disabled = false;
    voices.forEach((v) => {
      const tag = I18N.t(v.localService ? 'badgeBasic' : 'badgeNeural');
      sel.appendChild(new Option(`${v.name} · ${tag}`, v.voiceURI));
    });
    sel.value = voices.some((v) => v.voiceURI === S.settings.voiceURI)
      ? S.settings.voiceURI
      : voices[0].voiceURI;
    hint.textContent = I18N.t('vPickHint');
  }

  if ($('#voice-rate')) {
    $('#voice-rate').value = String(S.settings.voiceRate);
    $('#voice-rate-val').textContent = `${Number(S.settings.voiceRate).toFixed(2)}×`;
  }
}

/* ── keyboard ──────────────────────────────────────────────── */

function onKey(e) {
  if (!$('#modal-settings').hidden) {
    if (e.key === 'Escape') closeSettings();
    return;
  }
  if (S.screen !== 'play' || !S.round) return;

  if (!S.round.answered && /^[1-6]$/.test(e.key)) {
    const i = Number(e.key) - 1;
    if (i < S.round.questions[S.round.i].choices.length) answer(i);
    return;
  }
  if (S.round.answered && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    nextQuestion();
    return;
  }
  if (e.key.toLowerCase() === 's') {
    speakCurrent(S.round.answered ? $('#btn-replay') : $('#btn-speak'));
  }
}
