# PuudThaiDay · พูดไทยเดย์

A browser quiz for everyday Thai phrases — Japanese, English, Thai script and romanization, quizzed in any direction you like.

Static site. No build step, no framework, no backend. Drop it on GitHub Pages and it runs.

---

## Features

| | |
|---|---|
| **Guest or User** | Guest plays with nothing saved. User saves every round to that browser's local history. |
| **Fully custom direction** | Ask in JP / EN / TH / ROM / 🔊 audio → answer in any other. Or 🎲 Mixed to reshuffle every question. |
| **Layered display** | Pick one *main* line and any number of *sub* lines, each pinned above ▲ or below ▼. Configured once in ⚙️, applied everywhere. |
| **Voice samples** | Thai text-to-speech from the browser itself. Off / on-demand / auto-play, with voice and speed pickers. |
| **Round setup** | Word lists, question count, per-question timer, 2–6 choices. |
| **Score history** | Per-profile stats, last-12 sparkline, full round log, JSON export. |
| **UI in EN / 日本語 / ไทย** | Independent of the quiz content languages. |

Everything lives in `localStorage`. Nothing is uploaded anywhere.

---

## Repository structure

```
puud-thai-day/
├── index.html                    # the whole app shell — every screen is a <section>
├── .nojekyll                     # tells GitHub Pages to serve files starting with _
├── README.md
├── LICENSE
│
├── assets/
│   ├── css/
│   │   └── theme.css             # navy + kanok-gold design system
│   ├── js/                       # ES modules, no bundler
│   │   ├── app.js                # screens, wiring, the round loop
│   │   ├── data.js               # deck loading + card pool
│   │   ├── quiz.js               # question generation, distractors, grading
│   │   ├── display.js            # the main/sub layered phrase renderer
│   │   ├── storage.js            # localStorage: settings, setup, profiles, history
│   │   ├── speech.js             # Thai text-to-speech wrapper
│   │   └── i18n.js               # UI strings for EN / JP / TH
│   └── img/
│       └── favicon.svg
│
├── data/                         # ◀ THE DATABASE — edit this to add words
│   ├── manifest.json             # the index of decks; a new deck must be listed here
│   └── decks/
│       ├── daily-phrases-01.json
│       ├── daily-phrases-02.json
│       ├── daily-phrases-03.json
│       └── _template.json.example
│
├── tools/                        # optional Node helpers, zero dependencies
│   ├── validate-decks.mjs        # lint the database before committing
│   └── csv-to-deck.mjs           # spreadsheet → deck JSON
│
├── docs/screenshots/             # reference shots, not used by the app
│
└── .github/workflows/
    ├── pages.yml                 # auto-deploy to GitHub Pages on push to main
    └── validate.yml              # run the deck validator on every PR
```

**Why JSON files and not a real database:** GitHub Pages serves static files only. Plain JSON means a new word list is a text file you can edit *in the GitHub web UI on your phone*, review as a diff, and revert like any other commit. `tools/` gives you spreadsheet import and a validator so it still behaves like a database.

---

## Adding words

### 1. Add cards to an existing deck

Open `data/decks/daily-phrases-01.json` and append to `cards`:

```json
{ "id": "dp1-21", "jp": "またね", "en": "See you", "th": "แล้วเจอกัน", "rom": "lɛ́ɛo cəə kan" }
```

### 2. Add a whole new deck

1. Copy `data/decks/_template.json.example` → `data/decks/food.json`
2. Fill it in.
3. Register it in `data/manifest.json`:

```json
{
  "schemaVersion": 1,
  "decks": [
    "decks/daily-phrases-01.json",
    "decks/food.json"
  ]
}
```

4. `node tools/validate-decks.mjs`
5. Commit. The new list appears in Game Setup automatically.

### Card schema

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique across **all** decks. Convention: `<deck-prefix>-NNN`. |
| `th` | yes | Thai script. The only truly mandatory content field — it's what the voice reads. |
| `jp` | no | Japanese. |
| `en` | no | English. |
| `rom` | no | Romanization / IPA. Cards without it are skipped in ROM-answer questions. |
| `note` | no | `{ "en": "...", "jp": "..." }`. Stored, not yet displayed. |
| `tags` | no | Free-form array, reserved for future filtering. |

A language a card lacks is simply never used for that card — the quiz builder skips it rather than showing a blank.

### From a spreadsheet

Export a CSV with a header row (`jp,en,th,rom`), then:

```bash
node tools/csv-to-deck.mjs my-words.csv data/decks/my-words.json
```

---

## Publishing to GitHub Pages

```bash
cd puud-thai-day
git init -b main
git add .
git commit -m "PuudThaiDay: initial"
git remote add origin https://github.com/<you>/puud-thai-day.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: GitHub Actions**.

The included `pages.yml` workflow publishes the repo root on every push to `main`. Your site lands at:

```
https://<you>.github.io/puud-thai-day/
```

> If you prefer the no-Actions route, choose **Source: Deploy from a branch → main → / (root)** instead and delete `.github/workflows/pages.yml`. Both work; the Actions route gives you a deploy log.

---

## Running locally

ES modules and `fetch()` need a real HTTP origin — opening `index.html` by double-clicking will not load the decks.

```bash
cd puud-thai-day
python3 -m http.server 8080
# → http://localhost:8080
```

Any static server works (`npx serve`, VS Code Live Server, …).

---

## Notes on the content

The three starter decks come from a Japanese–English–Thai phrase sheet. Two gaps in the source were filled in when building the database:

- **Deck 2** had Thai script but no romanization for 19 of 20 rows — romanization added.
- **Deck 3** had Japanese only for 9 of 10 rows — English, Thai script and romanization added.

Romanization was also normalized to one consistent Haas-style scheme across all three decks (the source mixed capitalized and lowercase forms, and a few readings didn't match their Thai script). One card, `dp1-09` (とりま), carries a `note` because the source paired ก่อนอื่น with the reading for สำหรับตอนนี้; the app follows the Thai script shown.

**Please have a native speaker review the added rows before you rely on them** — they're reasonable everyday equivalents, not verified translations.

---

## Browser support

Modern Chrome, Edge, Firefox, Safari. Thai text-to-speech depends on voices installed by the OS/browser — desktop Chrome and Edge generally have one; if none is found the app says so and the rest keeps working.

---

## License

MIT — see `LICENSE`.
