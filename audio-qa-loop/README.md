# Audio-Question-Answer-Loop (Audio-QA-Loop / AQAL)

A static, offline-first web app for exchanging spoken questions and answers between a teacher and a student. Everything — recording, decoding, splicing, mp3 encoding — runs entirely in the browser. No backend, no accounts, no uploads. Files move between people through email, chat, or a shared drive.

Built to the design in [`audio-interface-spec.md`](audio-interface-spec.md).

## The two tabs

**Record Prompt** — the teacher records a set of questions as a single take. Pause/Resume lets you think between questions without recording dead air; paused time doesn't count against the 7-minute cap. Stop, listen to verify, download as mp3.

**Insert Response** — upload any audio file (the prompt, or a previously merged exchange), play it, pause at the point you want to respond, and press *Record Response*. Each response is added to a pending list (with preview and delete) at its timestamp. Press *Complete* to merge everything into one mp3, capped at 20 minutes total. This tab is role-agnostic: students use it to answer, teachers reuse it to add follow-up comments.

## Running it

**GitHub Pages:** push this folder to a repo, enable Pages (Settings → Pages → deploy from branch). No build step. Pages' HTTPS satisfies the browser's secure-context requirement for microphone access.

**Locally:** open `index.html` directly in Chrome/Edge/Firefox, or serve the folder (`python -m http.server`) and open `http://localhost:8000`. `localhost` and `file://` both count as secure contexts in current browsers.

**Fully offline:** the mp3 encoder ([lamejs](https://github.com/zhuker/lamejs) 1.2.1) loads from a CDN by default. To remove that one network dependency, download [`lame.min.js`](https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js) once and place it next to `index.html` — the app tries the local copy first automatically.

## Files

| File | Purpose |
|---|---|
| `index.html` | UI structure, both tabs |
| `styles.css` | Styling |
| `app.js` | All logic: recording, decode/resample/splice/encode pipeline |
| `audio-interface-spec.md` | The implementation spec this was built from |

## Tuning

The caps and encoding parameters are constants at the top of `app.js`:

```js
const MAX_RECORDING_SECONDS = 7 * 60;   // Record Prompt cap
const MAX_RESPONSE_SECONDS  = 20 * 60;  // Insert Response cap (merged total)
const MP3_BITRATE_KBPS      = 128;      // mono
const TARGET_SAMPLE_RATE    = 44100;    // common rate before splicing
```

Changing a cap is a one-line edit and redeploy.

## Browser notes

Works in current Chrome, Edge, Firefox, and Safari (iOS 14.5+). The recording `mimeType` and Pause support are feature-detected; on a browser without `MediaRecorder.pause`, the pause buttons are hidden rather than failing. Unsupported browsers get a clear banner instead of broken buttons. A `beforeunload` warning protects unsaved recordings from accidental refresh — nothing persists after the tab closes.
