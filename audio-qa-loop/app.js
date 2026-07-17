/* ============================================================
 * Audio-Question-Answer-Loop (AQAL) — static, offline-first, no backend.
 * All recording, decoding, splicing and mp3 encoding happens
 * in the browser. See audio-interface-spec.md for the design.
 * ============================================================ */

'use strict';

/* ---------------- Configuration constants (spec §6) ---------------- */
const MAX_RECORDING_SECONDS = 7 * 60;   // Tab 1 cap
const MAX_RESPONSE_SECONDS  = 20 * 60;  // Tab 2 cap (cumulative, post-merge)
const MP3_BITRATE_KBPS      = 128;      // mono, applied consistently on every encode
const TARGET_SAMPLE_RATE    = 44100;    // common rate all buffers are resampled to before splicing

const LAME_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js';

/* ================================================================
 * i18n — English / French
 * ================================================================ */
const I18N = {
  en: {
    'app.subtitle': 'Record spoken questions and insert spoken responses — everything stays in your browser.',
    'tab.home': 'Home',
    'tab.record': '1 · Record Prompt',
    'tab.insert': '2 · Insert Response',
    'home.title': 'How it works',
    'home.intro': 'A spoken question-and-answer loop between two people — for example a teacher and a student. Each person records into the same audio file, then sends it to the other by email, chat or a shared drive. Nothing is uploaded anywhere: all audio is processed inside your browser.',
    'home.step1': '<strong>Record</strong> — the teacher records a set of spoken questions (Tab 1) and downloads the mp3.',
    'home.step2': '<strong>Respond</strong> — the student uploads that file, pauses playback where they want to answer, records their responses and downloads the merged file (Tab 2).',
    'home.step3': '<strong>Repeat</strong> — the teacher can use Tab 2 again on the returned file to add inline feedback, and so on.',
    'home.card1.title': 'Start a fresh recording',
    'home.card1.text': 'Record a new set of spoken questions from scratch — for example, a teacher preparing a prompt.',
    'home.card1.btn': 'Go to Record Prompt →',
    'home.card2.title': 'Respond to an audio file',
    'home.card2.text': 'Answer questions in a file you received, or add inline feedback to someone’s response.',
    'home.card2.btn': 'Go to Insert Response →',
    'rec.help': 'Record your questions as one take. Use <strong>Pause Recording</strong> to think between questions — paused time is not recorded and does not count against the limit. Leave a pause of a second or more between questions.',
    'max': 'max',
    'state.ready': 'Ready',
    'state.recording': 'Recording',
    'state.paused': 'Paused',
    'state.done': 'Done',
    'btn.start': '● Start Recording',
    'btn.again': '● Record Again',
    'btn.pause': '⏸ Pause Recording',
    'btn.resume': '▶ Resume Recording',
    'btn.stop': '■ Stop Recording',
    'btn.cancel': '✕ Cancel',
    'processing': 'Processing…',
    'rec.result.title': 'Your recording',
    'verify.help': 'Listen to verify, then download. The file only exists in this browser tab until you download it.',
    'btn.download': '⬇ Download MP3',
    'btn.discard': 'Discard',
    'ins.help': 'Upload an audio file, play it, pause where you want to respond, and record your response there. Repeat for as many points as you like, then merge everything into one file.',
    'ins.advisory': 'For best audio quality, we recommend keeping this exchange to a few rounds.',
    'ins.upload': '📁 Upload Audio File',
    'ins.playback.title': 'Playback',
    'ins.playback.help': 'Pause playback at the moment you want your response inserted, then press <strong>Record Response</strong>.',
    'ins.record': '● Record Response at',
    'ins.pending': 'Recorded responses',
    'ins.merge.btn': '✔ Merge & Create File',
    'ins.result.title': 'Merged file',
    'btn.startover': 'Start Over',
    'ins.at': 'at {time}',
    'ins.long': '({time} long)',
    'btn.delete': '🗑 Delete',
    'ins.available': '/ {time} available',
    'title.exceed': 'The merged file would exceed the maximum duration.',
    'err.mic': 'Microphone access was denied. Please allow microphone access and try again.',
    'err.start': 'Could not start recording: {msg}',
    'err.noaudio': 'No audio was captured.',
    'err.process': 'Could not process the recording: {msg}',
    'err.cap1': 'Recording limit of {time} reached — recording stopped automatically.',
    'err.cap2': 'Stopped automatically — the merged file may not exceed {time}.',
    'err.file': 'This file could not be read as audio. Please upload an mp3 or another common audio format.',
    'err.toolong': 'This file is {dur} long, which already exceeds the {max} maximum for a merged file.',
    'err.respfail': 'The recorded response could not be processed. Please try again.',
    'err.merge': 'Merge failed: {msg}',
    'err.exceeds': 'The merged file exceeds the {time} maximum.',
    'confirm.discard': 'Discard this recording? It has not been downloaded.',
    'confirm.reset': 'Start over? Your recorded responses and merged file have not been downloaded.',
    'merge.decoding': 'decoding…',
    'merge.splicing': 'splicing…',
    'merge.encoding': 'encoding… {pct}%',
    'banner.encoder': 'The MP3 encoder could not be loaded (no internet connection?). Recording will work, but downloads need the encoder. To use this app fully offline, download lame.min.js (lamejs 1.2.1) once and place it next to index.html, then reload.',
    'banner.unsupported': 'This app cannot run here: {problems}.',
    'problem.mic': 'microphone recording (getUserMedia) is not available — if you opened this page over plain http, use https or open the file locally',
    'problem.recorder': 'MediaRecorder is not supported by this browser',
    'problem.webaudio': 'Web Audio API is not supported by this browser',
    'footer': 'Runs entirely in your browser — no audio ever leaves your device. Share downloaded files by email, chat, or a shared drive.',
  },
  fr: {
    'app.subtitle': 'Enregistrez des questions orales et insérez des réponses orales — tout reste dans votre navigateur.',
    'tab.home': 'Accueil',
    'tab.record': '1 · Enregistrer les questions',
    'tab.insert': '2 · Insérer une réponse',
    'home.title': 'Comment ça marche',
    'home.intro': 'Une boucle de questions-réponses orales entre deux personnes — par exemple un enseignant et un élève. Chacun enregistre dans le même fichier audio, puis l’envoie à l’autre par e-mail, messagerie ou disque partagé. Rien n’est téléversé : tout l’audio est traité dans votre navigateur.',
    'home.step1': '<strong>Enregistrer</strong> — l’enseignant enregistre une série de questions orales (onglet 1) et télécharge le mp3.',
    'home.step2': '<strong>Répondre</strong> — l’élève téléverse ce fichier, met la lecture en pause là où il veut répondre, enregistre ses réponses et télécharge le fichier fusionné (onglet 2).',
    'home.step3': '<strong>Recommencer</strong> — l’enseignant peut réutiliser l’onglet 2 sur le fichier reçu pour ajouter des commentaires, et ainsi de suite.',
    'home.card1.title': 'Créer un nouvel enregistrement',
    'home.card1.text': 'Enregistrez une nouvelle série de questions orales — par exemple, un enseignant qui prépare un sujet.',
    'home.card1.btn': 'Vers Enregistrer les questions →',
    'home.card2.title': 'Répondre à un fichier audio',
    'home.card2.text': 'Répondez aux questions d’un fichier reçu, ou ajoutez des commentaires à une réponse.',
    'home.card2.btn': 'Vers Insérer une réponse →',
    'rec.help': 'Enregistrez vos questions en une seule prise. Utilisez <strong>Mettre en pause</strong> pour réfléchir entre les questions — le temps en pause n’est pas enregistré et ne compte pas dans la limite. Laissez une pause d’au moins une seconde entre les questions.',
    'max': 'max',
    'state.ready': 'Prêt',
    'state.recording': 'Enregistrement',
    'state.paused': 'En pause',
    'state.done': 'Terminé',
    'btn.start': '● Démarrer l’enregistrement',
    'btn.again': '● Réenregistrer',
    'btn.pause': '⏸ Mettre en pause',
    'btn.resume': '▶ Reprendre',
    'btn.stop': '■ Arrêter',
    'btn.cancel': '✕ Annuler',
    'processing': 'Traitement…',
    'rec.result.title': 'Votre enregistrement',
    'verify.help': 'Écoutez pour vérifier, puis téléchargez. Le fichier n’existe que dans cet onglet du navigateur tant qu’il n’est pas téléchargé.',
    'btn.download': '⬇ Télécharger le MP3',
    'btn.discard': 'Supprimer',
    'ins.help': 'Téléversez un fichier audio, écoutez-le, mettez en pause à l’endroit voulu et enregistrez-y votre réponse. Répétez autant de fois que nécessaire, puis fusionnez le tout en un seul fichier.',
    'ins.advisory': 'Pour une meilleure qualité audio, nous recommandons de limiter cet échange à quelques allers-retours.',
    'ins.upload': '📁 Téléverser un fichier audio',
    'ins.playback.title': 'Lecture',
    'ins.playback.help': 'Mettez la lecture en pause au moment où votre réponse doit être insérée, puis appuyez sur <strong>Enregistrer une réponse</strong>.',
    'ins.record': '● Enregistrer une réponse à',
    'ins.pending': 'Réponses enregistrées',
    'ins.merge.btn': '✔ Fusionner et créer le fichier',
    'ins.result.title': 'Fichier fusionné',
    'btn.startover': 'Recommencer',
    'ins.at': 'à {time}',
    'ins.long': '(durée {time})',
    'btn.delete': '🗑 Supprimer',
    'ins.available': '/ {time} disponibles',
    'title.exceed': 'Le fichier fusionné dépasserait la durée maximale.',
    'err.mic': 'L’accès au micro a été refusé. Veuillez autoriser l’accès au micro et réessayer.',
    'err.start': 'Impossible de démarrer l’enregistrement : {msg}',
    'err.noaudio': 'Aucun son n’a été capté.',
    'err.process': 'Impossible de traiter l’enregistrement : {msg}',
    'err.cap1': 'Limite d’enregistrement de {time} atteinte — enregistrement arrêté automatiquement.',
    'err.cap2': 'Arrêt automatique — le fichier fusionné ne peut pas dépasser {time}.',
    'err.file': 'Ce fichier n’a pas pu être lu comme audio. Veuillez téléverser un mp3 ou un autre format audio courant.',
    'err.toolong': 'Ce fichier dure {dur}, ce qui dépasse déjà le maximum de {max} pour un fichier fusionné.',
    'err.respfail': 'La réponse enregistrée n’a pas pu être traitée. Veuillez réessayer.',
    'err.merge': 'Échec de la fusion : {msg}',
    'err.exceeds': 'Le fichier fusionné dépasse le maximum de {time}.',
    'confirm.discard': 'Supprimer cet enregistrement ? Il n’a pas été téléchargé.',
    'confirm.reset': 'Recommencer ? Vos réponses enregistrées et le fichier fusionné n’ont pas été téléchargés.',
    'merge.decoding': 'décodage…',
    'merge.splicing': 'assemblage…',
    'merge.encoding': 'encodage… {pct}%',
    'banner.encoder': 'Le codeur MP3 n’a pas pu être chargé (pas de connexion Internet ?). L’enregistrement fonctionnera, mais le téléchargement nécessite le codeur. Pour utiliser l’application entièrement hors ligne, téléchargez lame.min.js (lamejs 1.2.1) une fois, placez-le à côté de index.html, puis rechargez.',
    'banner.unsupported': 'Cette application ne peut pas fonctionner ici : {problems}.',
    'problem.mic': 'l’enregistrement au micro (getUserMedia) n’est pas disponible — si vous avez ouvert cette page en http simple, utilisez https ou ouvrez le fichier localement',
    'problem.recorder': 'MediaRecorder n’est pas pris en charge par ce navigateur',
    'problem.webaudio': 'l’API Web Audio n’est pas prise en charge par ce navigateur',
    'footer': 'Fonctionne entièrement dans votre navigateur — aucun son ne quitte votre appareil. Partagez les fichiers téléchargés par e-mail, messagerie ou disque partagé.',
  },
};

let lang = 'en';
try {
  lang = localStorage.getItem('aqal-lang')
      || ((navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en');
} catch { /* localStorage unavailable (some private modes) — default to en */ }
if (!I18N[lang]) lang = 'en';

function t(key, vars) {
  let s = I18N[lang][key] ?? I18N.en[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(vars[k]);
  return s;
}

/* ---------------- Small DOM helpers ---------------- */
const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

function fmtTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------------- MP3 encoder loading ----------------
 * Try a local copy (./lame.min.js) first so the app can run fully
 * offline; fall back to the CDN. Loading starts immediately but the
 * app only *requires* the encoder at export time.
 */
let encoderReady = null; // Promise<void>, rejects if unavailable
let encoderFailed = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error(`failed: ${src}`)); };
    document.head.appendChild(s);
  });
}

function initEncoder() {
  encoderReady = (async () => {
    try {
      await loadScript('lame.min.js');           // optional local copy
    } catch {
      await loadScript(LAME_CDN_URL);            // CDN fallback
    }
    if (typeof lamejs === 'undefined' || !lamejs.Mp3Encoder) {
      throw new Error('lamejs did not initialize');
    }
  })();
  encoderReady.catch(() => {
    encoderFailed = true;
    renderEncoderBanner();
  });
}

function renderEncoderBanner() {
  const b = $('encoder-banner');
  if (!encoderFailed) return;
  b.textContent = t('banner.encoder');
  b.classList.add('error-banner');
  show(b);
}

/* ---------------- Web Audio helpers ---------------- */
let sharedCtx = null;
function audioCtx() {
  if (!sharedCtx) sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  return sharedCtx;
}

async function decodeBlob(blob) {
  const buf = await blob.arrayBuffer();
  return audioCtx().decodeAudioData(buf);
}

/** Resample any AudioBuffer to mono Float32Array at TARGET_SAMPLE_RATE. */
async function toMonoTargetRate(audioBuffer) {
  const length = Math.max(1, Math.ceil(audioBuffer.duration * TARGET_SAMPLE_RATE));
  const off = new OfflineAudioContext(1, length, TARGET_SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  // Copy out — the rendered buffer's memory may be reused by the context.
  return new Float32Array(rendered.getChannelData(0));
}

/** Encode mono Float32 samples to an mp3 Blob, yielding to the UI thread
 *  periodically so long encodes don't look frozen. */
async function encodeMp3(samples, onProgress) {
  await encoderReady; // throws if encoder unavailable
  const enc = new lamejs.Mp3Encoder(1, TARGET_SAMPLE_RATE, MP3_BITRATE_KBPS);
  const BLOCK = 1152;
  const YIELD_EVERY = 200; // blocks (~5s of audio) between UI yields
  const int16 = new Int16Array(BLOCK);
  const parts = [];
  const nBlocks = Math.ceil(samples.length / BLOCK);
  for (let b = 0; b < nBlocks; b++) {
    const start = b * BLOCK;
    const n = Math.min(BLOCK, samples.length - start);
    for (let i = 0; i < n; i++) {
      const v = Math.max(-1, Math.min(1, samples[start + i]));
      int16[i] = v < 0 ? v * 0x8000 : v * 0x7FFF;
    }
    const chunk = enc.encodeBuffer(n === BLOCK ? int16 : int16.subarray(0, n));
    if (chunk.length) parts.push(chunk);
    if (b % YIELD_EVERY === YIELD_EVERY - 1) {
      if (onProgress) onProgress(b / nBlocks);
      await new Promise(requestAnimationFrame);
    }
  }
  const tail = enc.flush();
  if (tail.length) parts.push(tail);
  if (onProgress) onProgress(1);
  return new Blob(parts, { type: 'audio/mpeg' });
}

/** Splice response clips into the original samples.
 *  insertions: [{ index: sampleIndex, samples: Float32Array }] — any order. */
function spliceSamples(original, insertions) {
  const sorted = [...insertions].sort((a, b) => a.index - b.index);
  const total = original.length + sorted.reduce((s, x) => s + x.samples.length, 0);
  const out = new Float32Array(total);
  let src = 0, dst = 0;
  for (const ins of sorted) {
    const cut = Math.min(Math.max(ins.index, src), original.length);
    out.set(original.subarray(src, cut), dst);
    dst += cut - src;
    src = cut;
    out.set(ins.samples, dst);
    dst += ins.samples.length;
  }
  out.set(original.subarray(src), dst);
  return out;
}

/* ---------------- Recorder (shared by both tabs) ----------------
 * Wraps MediaRecorder with pause/resume and a recorded-time timer
 * (paused time is excluded — recorded time is what counts vs the cap).
 */
function pickMimeType() {
  const candidates = [
    'audio/webm;codecs=opus', 'audio/webm',
    'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg',
  ];
  if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
    for (const c of candidates) if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return ''; // let the browser pick its default
}

const pauseSupported = !!(window.MediaRecorder && MediaRecorder.prototype.pause);

class Recorder {
  /** opts: { maxSeconds, onTick(sec), onAutoStop(), onError(msg) } */
  constructor(opts) {
    this.opts = opts;
    this.state = 'idle'; // idle | recording | paused | stopping
    this._recordedMs = 0;
    this._resumeTs = 0;
    this._chunks = [];
    this._timer = null;
    this._stopResolve = null;
    this._cancelled = false;
  }

  get recordedSeconds() {
    let ms = this._recordedMs;
    if (this.state === 'recording') ms += performance.now() - this._resumeTs;
    return ms / 1000;
  }

  async start() {
    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: { ideal: 1 },
        sampleRate: { ideal: TARGET_SAMPLE_RATE }, // hint only; resampling is the safety net
      },
    });
    const mimeType = pickMimeType();
    this._mr = new MediaRecorder(this._stream, mimeType ? { mimeType } : undefined);
    this._mr.ondataavailable = (e) => { if (e.data && e.data.size) this._chunks.push(e.data); };
    this._mr.onerror = (e) => this.opts.onError?.(e.error?.message || 'Recording error');
    this._donePromise = new Promise((resolve) => { this._stopResolve = resolve; });
    this._mr.onstop = () => {
      this._stream.getTracks().forEach((tr) => tr.stop());
      const blob = this._cancelled
        ? null
        : new Blob(this._chunks, { type: this._mr.mimeType || 'audio/webm' });
      this._stopResolve(blob);
    };
    this._mr.start(1000);
    this.state = 'recording';
    this._resumeTs = performance.now();
    this._timer = setInterval(() => {
      const sec = this.recordedSeconds;
      this.opts.onTick?.(sec);
      if (this.state === 'recording' && sec >= this.opts.maxSeconds) {
        // The handler is responsible for calling stop() so the normal
        // finish flow (encode / add to list) runs for the captured audio.
        this.opts.onAutoStop?.();
      }
    }, 200);
  }

  pause() {
    if (this.state !== 'recording') return;
    this._recordedMs += performance.now() - this._resumeTs;
    this._mr.pause();
    this.state = 'paused';
  }

  resume() {
    if (this.state !== 'paused') return;
    this._mr.resume();
    this._resumeTs = performance.now();
    this.state = 'recording';
  }

  /** Resolves with the recorded Blob (or null if cancelled). */
  stop({ cancel = false } = {}) {
    if (this.state === 'idle' || this.state === 'stopping') return this._donePromise;
    if (this.state === 'recording') this._recordedMs += performance.now() - this._resumeTs;
    this.state = 'stopping';
    this._cancelled = cancel;
    clearInterval(this._timer);
    try { this._mr.stop(); } catch { this._stopResolve(null); }
    return this._donePromise;
  }
}

/* ---------------- Unsaved-work guard (spec §3) ---------------- */
const unsaved = { tab1: false, tab2: false };
window.addEventListener('beforeunload', (e) => {
  if (unsaved.tab1 || unsaved.tab2) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/* ================================================================
 * TAB SWITCHING (Home / Record / Insert)
 * ================================================================ */
const tabBtns = { home: $('tab-btn-home'), record: $('tab-btn-record'), insert: $('tab-btn-insert') };
const tabPanels = { home: $('tab-home'), record: $('tab-record'), insert: $('tab-insert') };
function switchTab(name) {
  for (const k of Object.keys(tabBtns)) {
    tabBtns[k].classList.toggle('active', k === name);
    tabBtns[k].setAttribute('aria-selected', String(k === name));
    tabPanels[k].classList.toggle('hidden', k !== name);
  }
}
tabBtns.home.addEventListener('click', () => switchTab('home'));
tabBtns.record.addEventListener('click', () => switchTab('record'));
tabBtns.insert.addEventListener('click', () => switchTab('insert'));
$('home-go-record').addEventListener('click', () => switchTab('record'));
$('home-go-insert').addEventListener('click', () => switchTab('insert'));

/* ================================================================
 * TAB 1 — RECORD PROMPT
 * ================================================================ */
const rec1 = {
  startBtn: $('rec1-start'), pauseBtn: $('rec1-pause'), stopBtn: $('rec1-stop'),
  timerEl: $('rec1-timer'), capEl: $('rec1-cap'), stateEl: $('rec1-state'),
  processing: $('rec1-processing'), progress: $('rec1-progress'),
  result: $('rec1-result'), audio: $('rec1-audio'),
  downloadBtn: $('rec1-download'), discardBtn: $('rec1-discard'),
  errorEl: $('rec1-error'),
  recorder: null, mp3Blob: null,
  stateKey: 'state.ready', stateCls: 'idle',
  startKey: 'btn.start', pauseKey: 'btn.pause',
};
rec1.capEl.textContent = fmtTime(MAX_RECORDING_SECONDS);

function rec1SetState(key, cls) {
  rec1.stateKey = key;
  rec1.stateCls = cls;
  rec1.stateEl.textContent = t(key);
  rec1.stateEl.className = `state-badge ${cls}`;
}

function rec1SetPauseLabel(key) {
  rec1.pauseKey = key;
  rec1.pauseBtn.textContent = t(key);
}

function rec1SetStartLabel(key) {
  rec1.startKey = key;
  rec1.startBtn.textContent = t(key);
}

function rec1Error(msg) {
  rec1.errorEl.textContent = msg;
  show(rec1.errorEl);
}

function rec1ResetUI() {
  rec1.mp3Blob = null;
  unsaved.tab1 = false;
  rec1.audio.removeAttribute('src');
  hide(rec1.result); hide(rec1.processing); hide(rec1.errorEl);
  hide(rec1.pauseBtn); hide(rec1.stopBtn);
  show(rec1.startBtn);
  rec1.timerEl.textContent = '0:00';
  rec1SetState('state.ready', 'idle');
}

rec1.startBtn.addEventListener('click', async () => {
  rec1ResetUI();
  rec1.recorder = new Recorder({
    maxSeconds: MAX_RECORDING_SECONDS,
    onTick: (sec) => { rec1.timerEl.textContent = fmtTime(sec); },
    onAutoStop: () => {
      rec1Error(t('err.cap1', { time: fmtTime(MAX_RECORDING_SECONDS) }));
      rec1FinishStop();
    },
    onError: rec1Error,
  });
  try {
    await rec1.recorder.start();
  } catch (err) {
    rec1Error(err.name === 'NotAllowedError' ? t('err.mic') : t('err.start', { msg: err.message }));
    return;
  }
  hide(rec1.startBtn);
  if (pauseSupported) { rec1SetPauseLabel('btn.pause'); show(rec1.pauseBtn); }
  show(rec1.stopBtn);
  rec1SetState('state.recording', 'recording');
});

rec1.pauseBtn.addEventListener('click', () => {
  const r = rec1.recorder;
  if (!r) return;
  if (r.state === 'recording') {
    r.pause();
    rec1SetPauseLabel('btn.resume');
    rec1SetState('state.paused', 'paused');
  } else if (r.state === 'paused') {
    r.resume();
    rec1SetPauseLabel('btn.pause');
    rec1SetState('state.recording', 'recording');
  }
});

async function rec1FinishStop() {
  const r = rec1.recorder;
  if (!r) return;
  hide(rec1.pauseBtn); hide(rec1.stopBtn);
  rec1SetState('state.done', 'idle');
  const blob = await r.stop();
  rec1.recorder = null;
  if (!blob || !blob.size) { rec1Error(t('err.noaudio')); show(rec1.startBtn); return; }

  show(rec1.processing);
  try {
    const decoded = await decodeBlob(blob);
    const samples = await toMonoTargetRate(decoded);
    rec1.mp3Blob = await encodeMp3(samples, (p) => {
      rec1.progress.textContent = `${Math.round(p * 100)}%`;
    });
  } catch (err) {
    hide(rec1.processing);
    rec1Error(t('err.process', { msg: err.message }));
    show(rec1.startBtn);
    return;
  }
  hide(rec1.processing);
  unsaved.tab1 = true; // guard active until downloaded or discarded
  rec1.audio.src = URL.createObjectURL(rec1.mp3Blob);
  show(rec1.result);
  show(rec1.startBtn);
  rec1SetStartLabel('btn.again');
}

rec1.stopBtn.addEventListener('click', rec1FinishStop);

rec1.downloadBtn.addEventListener('click', () => {
  if (!rec1.mp3Blob) return;
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  downloadBlob(rec1.mp3Blob, `prompt-${stamp}.mp3`);
  unsaved.tab1 = false;
});

rec1.discardBtn.addEventListener('click', () => {
  if (unsaved.tab1 && !confirm(t('confirm.discard'))) return;
  rec1ResetUI();
  rec1SetStartLabel('btn.start');
});

/* ================================================================
 * TAB 2 — INSERT RESPONSE
 * ================================================================ */
const ins = {
  fileInput: $('ins-file'), filenameEl: $('ins-filename'),
  playerSection: $('ins-player-section'), audio: $('ins-audio'),
  recordBtn: $('ins-record'), recordAtEl: $('ins-record-at'),
  recordingUI: $('ins-recording-ui'),
  rec2Timer: $('rec2-timer'), rec2Remaining: $('rec2-remaining'), rec2State: $('rec2-state'),
  rec2Pause: $('rec2-pause'), rec2Stop: $('rec2-stop'), rec2Cancel: $('rec2-cancel'),
  listSection: $('ins-list-section'), list: $('ins-list'), countEl: $('ins-count'),
  completeBtn: $('ins-complete'),
  processing: $('ins-processing'), progress: $('ins-progress'),
  result: $('ins-result'), resultAudio: $('ins-result-audio'),
  downloadBtn: $('ins-download'), resetBtn: $('ins-reset'),
  errorEl: $('ins-error'),
  // state
  fileBlob: null, fileName: '', fileDuration: 0,
  insertions: [], // { id, time, blob, duration, url }
  nextId: 1,
  recorder: null,
  spliceTime: 0,
  mergedBlob: null,
  stateKey: 'state.recording', pauseKey: 'btn.pause',
};

function insError(msg) { ins.errorEl.textContent = msg; show(ins.errorEl); }
function insClearError() { hide(ins.errorEl); }

function insSetState(key, cls) {
  ins.stateKey = key;
  ins.rec2State.textContent = t(key);
  ins.rec2State.className = `state-badge ${cls}`;
}

function insSetPauseLabel(key) {
  ins.pauseKey = key;
  ins.rec2Pause.textContent = t(key);
}

function insTotalSeconds() {
  return ins.fileDuration + ins.insertions.reduce((s, x) => s + x.duration, 0);
}
function insRemainingSeconds() {
  return MAX_RESPONSE_SECONDS - insTotalSeconds();
}

function insUpdateUnsaved() {
  unsaved.tab2 = ins.insertions.length > 0 || !!ins.mergedBlob;
}

function insRenderList() {
  ins.list.innerHTML = '';
  ins.countEl.textContent = String(ins.insertions.length);
  // Reverse chronological: most recently recorded first.
  const items = [...ins.insertions].sort((a, b) => b.id - a.id);
  for (const item of items) {
    const li = document.createElement('li');

    const tm = document.createElement('span');
    tm.className = 'ins-time';
    tm.textContent = t('ins.at', { time: fmtTime(item.time) });
    li.appendChild(tm);

    const d = document.createElement('span');
    d.className = 'ins-dur';
    d.textContent = t('ins.long', { time: fmtTime(item.duration) });
    li.appendChild(d);

    const player = document.createElement('audio');
    player.controls = true;
    player.src = item.url;
    li.appendChild(player);

    const del = document.createElement('button');
    del.className = 'btn';
    del.textContent = t('btn.delete');
    del.addEventListener('click', () => {
      URL.revokeObjectURL(item.url);
      ins.insertions = ins.insertions.filter((x) => x.id !== item.id);
      insRenderList();
      insUpdateUnsaved();
      insUpdateControls();
    });
    li.appendChild(del);

    ins.list.appendChild(li);
  }
  ins.insertions.length ? show(ins.listSection) : hide(ins.listSection);
}

function insUpdateControls() {
  ins.insertions.length ? show(ins.completeBtn) : hide(ins.completeBtn);
  const remaining = insRemainingSeconds();
  if (remaining <= 1) {
    ins.recordBtn.disabled = true;
    ins.recordBtn.title = t('title.exceed');
  } else {
    ins.recordBtn.disabled = false;
    ins.recordBtn.title = '';
  }
}

ins.audio.addEventListener('timeupdate', () => {
  ins.recordAtEl.textContent = fmtTime(ins.audio.currentTime);
});
ins.audio.addEventListener('seeked', () => {
  ins.recordAtEl.textContent = fmtTime(ins.audio.currentTime);
});

ins.fileInput.addEventListener('change', async () => {
  const file = ins.fileInput.files[0];
  if (!file) return;
  if (ins.recorder) await insStopRecording(true); // a new file abandons any in-flight recording
  insClearError();
  ins.filenameEl.textContent = file.name;

  let decoded;
  try {
    decoded = await decodeBlob(file);
  } catch {
    insError(t('err.file'));
    return;
  }
  if (decoded.duration > MAX_RESPONSE_SECONDS) {
    insError(t('err.toolong', { dur: fmtTime(decoded.duration), max: fmtTime(MAX_RESPONSE_SECONDS) }));
    return;
  }

  // Reset any previous session state.
  ins.insertions.forEach((x) => URL.revokeObjectURL(x.url));
  ins.insertions = [];
  ins.mergedBlob = null;
  hide(ins.result); hide(ins.listSection); hide(ins.recordingUI);
  insUpdateUnsaved();

  ins.fileBlob = file;
  ins.fileName = file.name;
  ins.fileDuration = decoded.duration;
  ins.audio.src = URL.createObjectURL(file);
  show(ins.playerSection);
  insUpdateControls();
});

/* --- Response recording --- */
ins.recordBtn.addEventListener('click', async () => {
  insClearError();
  ins.audio.pause();
  ins.spliceTime = ins.audio.currentTime;

  const remaining = insRemainingSeconds();
  ins.recorder = new Recorder({
    maxSeconds: remaining,
    onTick: (sec) => {
      ins.rec2Timer.textContent = fmtTime(sec);
      ins.rec2Remaining.textContent = t('ins.available', { time: fmtTime(remaining) });
    },
    onAutoStop: () => {
      insError(t('err.cap2', { time: fmtTime(MAX_RESPONSE_SECONDS) }));
      insStopRecording(false);
    },
    onError: insError,
  });
  try {
    await ins.recorder.start();
  } catch (err) {
    ins.recorder = null;
    insError(err.name === 'NotAllowedError' ? t('err.mic') : t('err.start', { msg: err.message }));
    return;
  }
  ins.rec2Timer.textContent = '0:00';
  insSetState('state.recording', 'recording');
  insSetPauseLabel('btn.pause');
  pauseSupported ? show(ins.rec2Pause) : hide(ins.rec2Pause);
  show(ins.recordingUI);
  ins.recordBtn.disabled = true;
  ins.audio.controls = false; // avoid confusing playback-pause with recording-pause
});

ins.rec2Pause.addEventListener('click', () => {
  const r = ins.recorder;
  if (!r) return;
  if (r.state === 'recording') {
    r.pause();
    insSetPauseLabel('btn.resume');
    insSetState('state.paused', 'paused');
  } else if (r.state === 'paused') {
    r.resume();
    insSetPauseLabel('btn.pause');
    insSetState('state.recording', 'recording');
  }
});

async function insStopRecording(cancel) {
  const r = ins.recorder;
  if (!r) return;
  const blob = await r.stop({ cancel });
  ins.recorder = null;
  hide(ins.recordingUI);
  ins.recordBtn.disabled = false;
  ins.audio.controls = true;

  if (cancel || !blob || !blob.size) { insUpdateControls(); return; }

  let duration = 0;
  try {
    duration = (await decodeBlob(blob)).duration;
  } catch {
    insError(t('err.respfail'));
    return;
  }
  ins.insertions.push({
    id: ins.nextId++,
    time: ins.spliceTime,
    blob,
    duration,
    url: URL.createObjectURL(blob),
  });
  ins.mergedBlob = null; // a previous merge no longer reflects the list
  hide(ins.result);
  insRenderList();
  insUpdateUnsaved();
  insUpdateControls();
}

ins.rec2Stop.addEventListener('click', () => insStopRecording(false));
ins.rec2Cancel.addEventListener('click', () => insStopRecording(true));

/* --- Merge --- */
ins.completeBtn.addEventListener('click', async () => {
  insClearError();
  ins.completeBtn.disabled = true;
  ins.recordBtn.disabled = true;
  show(ins.processing);
  ins.progress.textContent = t('merge.decoding');

  try {
    // 1. Decode + resample everything to a common rate (spec §4).
    const originalSamples = await toMonoTargetRate(await decodeBlob(ins.fileBlob));
    const clips = [];
    for (const item of ins.insertions) {
      const samples = await toMonoTargetRate(await decodeBlob(item.blob));
      clips.push({ index: Math.round(item.time * TARGET_SAMPLE_RATE), samples });
    }

    // 2. Splice in ascending timestamp order.
    ins.progress.textContent = t('merge.splicing');
    const merged = spliceSamples(originalSamples, clips);

    if (merged.length / TARGET_SAMPLE_RATE > MAX_RESPONSE_SECONDS + 1) {
      throw new Error(t('err.exceeds', { time: fmtTime(MAX_RESPONSE_SECONDS) }));
    }

    // 3. Encode to mp3.
    ins.mergedBlob = await encodeMp3(merged, (p) => {
      ins.progress.textContent = t('merge.encoding', { pct: Math.round(p * 100) });
    });
  } catch (err) {
    hide(ins.processing);
    ins.completeBtn.disabled = false;
    insUpdateControls();
    insError(t('err.merge', { msg: err.message }));
    return;
  }

  hide(ins.processing);
  ins.completeBtn.disabled = false;
  insUpdateControls();
  insUpdateUnsaved();
  ins.resultAudio.src = URL.createObjectURL(ins.mergedBlob);
  show(ins.result);
  ins.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

ins.downloadBtn.addEventListener('click', () => {
  if (!ins.mergedBlob) return;
  const base = ins.fileName.replace(/\.[^.]+$/, '') || 'audio';
  downloadBlob(ins.mergedBlob, `${base}-with-responses.mp3`);
  unsaved.tab2 = false; // downloaded → nothing unsaved; responses are baked into the file
  ins.insertions.forEach((x) => URL.revokeObjectURL(x.url));
  ins.insertions = [];
  insRenderList();
  insUpdateControls();
});

ins.resetBtn.addEventListener('click', () => {
  if (unsaved.tab2 && !confirm(t('confirm.reset'))) return;
  ins.insertions.forEach((x) => URL.revokeObjectURL(x.url));
  ins.insertions = [];
  ins.mergedBlob = null;
  ins.fileBlob = null;
  ins.fileInput.value = '';
  ins.filenameEl.textContent = '';
  ins.audio.removeAttribute('src');
  hide(ins.playerSection); hide(ins.result); hide(ins.listSection);
  insUpdateUnsaved();
  insClearError();
});

/* ================================================================
 * Language switching
 * ================================================================ */
const detectedProblems = []; // filled in boot(), re-rendered on language switch

function renderUnsupportedBanner() {
  if (!detectedProblems.length) return;
  const b = $('unsupported-banner');
  b.textContent = t('banner.unsupported', { problems: detectedProblems.map((k) => t(k)).join('; ') });
  b.classList.add('error-banner');
  show(b);
}

function applyLang(next) {
  lang = I18N[next] ? next : 'en';
  try { localStorage.setItem('aqal-lang', lang); } catch { /* ignore */ }
  document.documentElement.lang = lang;
  $('lang-en').classList.toggle('active', lang === 'en');
  $('lang-fr').classList.toggle('active', lang === 'fr');

  // Static text nodes.
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });

  // Dynamic, state-dependent labels.
  rec1.stateEl.textContent = t(rec1.stateKey);
  rec1.pauseBtn.textContent = t(rec1.pauseKey);
  rec1.startBtn.textContent = t(rec1.startKey);
  ins.rec2State.textContent = t(ins.stateKey);
  ins.rec2Pause.textContent = t(ins.pauseKey);
  if (ins.recordBtn.title) ins.recordBtn.title = t('title.exceed');
  insRenderList();
  renderEncoderBanner();
  renderUnsupportedBanner();
}

$('lang-en').addEventListener('click', () => applyLang('en'));
$('lang-fr').addEventListener('click', () => applyLang('fr'));

/* ================================================================
 * Feature detection / boot
 * ================================================================ */
(function boot() {
  if (!navigator.mediaDevices?.getUserMedia) detectedProblems.push('problem.mic');
  if (!window.MediaRecorder) detectedProblems.push('problem.recorder');
  if (!(window.AudioContext || window.webkitAudioContext)) detectedProblems.push('problem.webaudio');

  if (detectedProblems.length) {
    rec1.startBtn.disabled = true;
    ins.recordBtn.disabled = true;
  }

  applyLang(lang);
  initEncoder();
})();
