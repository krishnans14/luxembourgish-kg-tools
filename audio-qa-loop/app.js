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
    const b = $('encoder-banner');
    b.textContent = 'The MP3 encoder could not be loaded (no internet connection?). ' +
      'Recording will work, but downloads need the encoder. To use this app fully offline, ' +
      'download lame.min.js (lamejs 1.2.1) once and place it next to index.html, then reload.';
    b.classList.add('error-banner');
    show(b);
  });
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
      this._stream.getTracks().forEach((t) => t.stop());
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
 * TAB SWITCHING
 * ================================================================ */
const tabBtns = { record: $('tab-btn-record'), insert: $('tab-btn-insert') };
const tabPanels = { record: $('tab-record'), insert: $('tab-insert') };
function switchTab(name) {
  for (const k of Object.keys(tabBtns)) {
    tabBtns[k].classList.toggle('active', k === name);
    tabBtns[k].setAttribute('aria-selected', String(k === name));
    tabPanels[k].classList.toggle('hidden', k !== name);
  }
}
tabBtns.record.addEventListener('click', () => switchTab('record'));
tabBtns.insert.addEventListener('click', () => switchTab('insert'));

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
};
rec1.capEl.textContent = fmtTime(MAX_RECORDING_SECONDS);

function rec1SetState(text, cls) {
  rec1.stateEl.textContent = text;
  rec1.stateEl.className = `state-badge ${cls}`;
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
  rec1SetState('Ready', 'idle');
}

rec1.startBtn.addEventListener('click', async () => {
  rec1ResetUI();
  rec1.recorder = new Recorder({
    maxSeconds: MAX_RECORDING_SECONDS,
    onTick: (sec) => { rec1.timerEl.textContent = fmtTime(sec); },
    onAutoStop: () => {
      rec1Error(`Recording limit of ${fmtTime(MAX_RECORDING_SECONDS)} reached — recording stopped automatically.`);
      rec1FinishStop();
    },
    onError: rec1Error,
  });
  try {
    await rec1.recorder.start();
  } catch (err) {
    rec1Error(err.name === 'NotAllowedError'
      ? 'Microphone access was denied. Please allow microphone access and try again.'
      : `Could not start recording: ${err.message}`);
    return;
  }
  hide(rec1.startBtn);
  if (pauseSupported) { rec1.pauseBtn.textContent = '⏸ Pause Recording'; show(rec1.pauseBtn); }
  show(rec1.stopBtn);
  rec1SetState('Recording', 'recording');
});

rec1.pauseBtn.addEventListener('click', () => {
  const r = rec1.recorder;
  if (!r) return;
  if (r.state === 'recording') {
    r.pause();
    rec1.pauseBtn.textContent = '▶ Resume Recording';
    rec1SetState('Paused', 'paused');
  } else if (r.state === 'paused') {
    r.resume();
    rec1.pauseBtn.textContent = '⏸ Pause Recording';
    rec1SetState('Recording', 'recording');
  }
});

async function rec1FinishStop() {
  const r = rec1.recorder;
  if (!r) return;
  hide(rec1.pauseBtn); hide(rec1.stopBtn);
  rec1SetState('Done', 'idle');
  const blob = await r.stop();
  rec1.recorder = null;
  if (!blob || !blob.size) { rec1Error('No audio was captured.'); show(rec1.startBtn); return; }

  show(rec1.processing);
  try {
    const decoded = await decodeBlob(blob);
    const samples = await toMonoTargetRate(decoded);
    rec1.mp3Blob = await encodeMp3(samples, (p) => {
      rec1.progress.textContent = `${Math.round(p * 100)}%`;
    });
  } catch (err) {
    hide(rec1.processing);
    rec1Error(`Could not process the recording: ${err.message}`);
    show(rec1.startBtn);
    return;
  }
  hide(rec1.processing);
  unsaved.tab1 = true; // guard active until downloaded or discarded
  rec1.audio.src = URL.createObjectURL(rec1.mp3Blob);
  show(rec1.result);
  show(rec1.startBtn);
  rec1.startBtn.textContent = '● Record Again';
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
  if (unsaved.tab1 && !confirm('Discard this recording? It has not been downloaded.')) return;
  rec1ResetUI();
  rec1.startBtn.textContent = '● Start Recording';
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
  listSection: $('ins-list-section'), list: $('ins-list'),
  completeBtn: $('ins-complete'),
  processing: $('ins-processing'), progress: $('ins-progress'),
  result: $('ins-result'), resultAudio: $('ins-result-audio'),
  downloadBtn: $('ins-download'), resetBtn: $('ins-reset'),
  errorEl: $('ins-error'),
  // state
  fileBlob: null, fileName: '', fileDuration: 0,
  insertions: [], // { id, time, blob, duration }
  nextId: 1,
  recorder: null,
  spliceTime: 0,
  mergedBlob: null,
};

function insError(msg) { ins.errorEl.textContent = msg; show(ins.errorEl); }
function insClearError() { hide(ins.errorEl); }

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
  ins.insertions.sort((a, b) => a.time - b.time);
  for (const item of ins.insertions) {
    const li = document.createElement('li');

    const t = document.createElement('span');
    t.className = 'ins-time';
    t.textContent = `at ${fmtTime(item.time)}`;
    li.appendChild(t);

    const d = document.createElement('span');
    d.className = 'ins-dur';
    d.textContent = `(${fmtTime(item.duration)} long)`;
    li.appendChild(d);

    const player = document.createElement('audio');
    player.controls = true;
    player.src = item.url;
    li.appendChild(player);

    const del = document.createElement('button');
    del.className = 'btn';
    del.textContent = '🗑 Delete';
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
    ins.recordBtn.title = 'The merged file would exceed the maximum duration.';
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
    insError('This file could not be read as audio. Please upload an mp3 or another common audio format.');
    return;
  }
  if (decoded.duration > MAX_RESPONSE_SECONDS) {
    insError(`This file is ${fmtTime(decoded.duration)} long, which already exceeds the ${fmtTime(MAX_RESPONSE_SECONDS)} maximum for a merged file.`);
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
      ins.rec2Remaining.textContent = `/ ${fmtTime(remaining)} available`;
    },
    onAutoStop: () => {
      insError(`Stopped automatically — the merged file may not exceed ${fmtTime(MAX_RESPONSE_SECONDS)}.`);
      insStopRecording(false);
    },
    onError: insError,
  });
  try {
    await ins.recorder.start();
  } catch (err) {
    ins.recorder = null;
    insError(err.name === 'NotAllowedError'
      ? 'Microphone access was denied. Please allow microphone access and try again.'
      : `Could not start recording: ${err.message}`);
    return;
  }
  ins.rec2Timer.textContent = '0:00';
  ins.rec2State.textContent = 'Recording';
  ins.rec2State.className = 'state-badge recording';
  ins.rec2Pause.textContent = '⏸ Pause Recording';
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
    ins.rec2Pause.textContent = '▶ Resume Recording';
    ins.rec2State.textContent = 'Paused';
    ins.rec2State.className = 'state-badge paused';
  } else if (r.state === 'paused') {
    r.resume();
    ins.rec2Pause.textContent = '⏸ Pause Recording';
    ins.rec2State.textContent = 'Recording';
    ins.rec2State.className = 'state-badge recording';
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
    insError('The recorded response could not be processed. Please try again.');
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
  ins.progress.textContent = 'decoding…';

  try {
    // 1. Decode + resample everything to a common rate (spec §4).
    const originalSamples = await toMonoTargetRate(await decodeBlob(ins.fileBlob));
    const clips = [];
    for (const item of ins.insertions) {
      const samples = await toMonoTargetRate(await decodeBlob(item.blob));
      clips.push({ index: Math.round(item.time * TARGET_SAMPLE_RATE), samples });
    }

    // 2. Splice in ascending timestamp order.
    ins.progress.textContent = 'splicing…';
    const merged = spliceSamples(originalSamples, clips);

    if (merged.length / TARGET_SAMPLE_RATE > MAX_RESPONSE_SECONDS + 1) {
      throw new Error(`The merged file exceeds the ${fmtTime(MAX_RESPONSE_SECONDS)} maximum.`);
    }

    // 3. Encode to mp3.
    ins.mergedBlob = await encodeMp3(merged, (p) => {
      ins.progress.textContent = `encoding… ${Math.round(p * 100)}%`;
    });
  } catch (err) {
    hide(ins.processing);
    ins.completeBtn.disabled = false;
    insUpdateControls();
    insError(`Merge failed: ${err.message}`);
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
  if (unsaved.tab2 && !confirm('Start over? Your recorded responses and merged file have not been downloaded.')) return;
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
 * Feature detection / boot
 * ================================================================ */
(function boot() {
  const problems = [];
  if (!navigator.mediaDevices?.getUserMedia) {
    problems.push('microphone recording (getUserMedia) is not available — if you opened this page over plain http, use https or open the file locally');
  }
  if (!window.MediaRecorder) problems.push('MediaRecorder is not supported by this browser');
  if (!(window.AudioContext || window.webkitAudioContext)) problems.push('Web Audio API is not supported by this browser');

  if (problems.length) {
    const b = $('unsupported-banner');
    b.textContent = `This app cannot run here: ${problems.join('; ')}.`;
    b.classList.add('error-banner');
    show(b);
    rec1.startBtn.disabled = true;
    ins.recordBtn.disabled = true;
  }

  initEncoder();
})();

