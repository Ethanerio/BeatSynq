/* ============================================================
   BeatSync Studio — Main Application JS
   ============================================================ */
'use strict';

// ================================================================
// STATE
// ================================================================
const state = {
  mode: 'slideshow',
  audioBuffer: null,
  audioFile: null,
  beats: [],
  mediaFiles: [],
  mediaObjects: [],
  scene3dFiles: [],
  scene3dObjects: [],
  // Warp schedule
  warpSchedule: [],
  currentWarpRate: 1.0,
  currentSlotIdx: -1,
  // Playback
  isPlaying: false,
  startTime: 0,
  pauseOffset: 0,
  audioCtx: null,
  audioSource: null,
  analyser: null,
  currentMediaIdx: 0,
  nextBeatIdx: 0,
  animFrame: null,
  isExporting: false,
  recorder: null,
  // 3D
  threeRenderer: null,
  threeScene: null,
  threeCamera: null,
  threeTargetPos: null,
  threeTargetLook: null,
};

// Transition state (persisted outside render loop)
let transitionState = {
  active: false, progress: 0,
  fromIdx: 0, toIdx: 0,
  type: 'fade', duration: 0.15, startTime: 0
};

// ================================================================
// DOM REFS (cached once DOMContentLoaded fires)
// ================================================================
let $ = {};

function cacheDom() {
  const ids = [
    'audioInput','audioZone','waveformCanvas','beatCanvas','warpCanvas',
    'warpLegend','beatStatus','sensitivity','sensitivityVal',
    'minGap','minGapVal','bandSelect',
    'mediaInput','mediaZone','mediaChips',
    'scene3dInput','scene3dZone','scene3dChips',
    'tab2d','tab3d','slideshowPanel','scene3dPanel',
    'transition','transDuration','transDurVal',
    'loopMedia','warpEnabled','warpBody','warpMode',
    'warpMin','warpMinVal','warpMax','warpMaxVal','warpStat',
    'sceneType','camSpeed','camSpeedVal','beatSnap','beatSnapVal',
    'resolution','quality','flashAlpha','flashAlphaVal',
    'exportStatus','previewBtn','previewCanvas','threeCanvas',
    'beatFlash','warpBadge','warpBadgeText','nowPlaying','emptyState',
    'playBtn','timeDisplay','progressBar','progressThumb',
    'progressWrap','progressTrack','progressBeats','exportBtn',
    'step1num','step2num','step3num',
    'hstatBeats','hstatDuration','hstatClips',
    'toastContainer'
  ];
  ids.forEach(id => { $[id] = document.getElementById(id); });
}

// ================================================================
// TOAST NOTIFICATIONS
// ================================================================
function toast(msg, type = 'info', duration = 3200) {
  const icons = { info: 'ℹ️', ok: '✅', warn: '⚠️', error: '❌', rec: '🔴' };
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  $.toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('exit');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ================================================================
// STATUS (inline, in sidebar)
// ================================================================
function setStatus(id, html, type = 'info') {
  const el = document.getElementById(id);
  if (!el) return;
  if (!html) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="status-msg ${type}">${html}</div>`;
}

// ================================================================
// HEADER STATS
// ================================================================
function updateHeaderStats() {
  if ($.hstatBeats) $.hstatBeats.textContent = state.beats.length || '—';
  if ($.hstatDuration) $.hstatDuration.textContent = state.audioBuffer ? fmt(state.audioBuffer.duration) : '—';
  if ($.hstatClips) $.hstatClips.textContent = state.mediaObjects.length || '—';
}

// ================================================================
// SLIDER HELPERS
// ================================================================
const SLIDER_SUFFIX = {
  sensitivityVal: '×', minGapVal: 's', transDurVal: 's',
  camSpeedVal: '×', beatSnapVal: '', flashAlphaVal: '',
  warpMinVal: '×', warpMaxVal: '×'
};

function updateSliderDisplay(inputEl, valId) {
  const v = parseFloat(inputEl.value);
  const suffix = SLIDER_SUFFIX[valId] ?? '';
  const el = document.getElementById(valId);
  if (el) el.textContent = v.toFixed(2) + suffix;
}

// ================================================================
// SECTION ACCORDION
// ================================================================
function toggleSection(id) {
  document.getElementById(id).classList.toggle('open');
}

// ================================================================
// FORMAT TIME
// ================================================================
function fmt(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ================================================================
// DRAG & DROP SETUP
// ================================================================
function setupDrop(zoneEl, inputEl, handler) {
  zoneEl.addEventListener('dragover', e => { e.preventDefault(); zoneEl.classList.add('drag'); });
  zoneEl.addEventListener('dragleave', () => zoneEl.classList.remove('drag'));
  zoneEl.addEventListener('drop', e => { e.preventDefault(); zoneEl.classList.remove('drag'); handler(e.dataTransfer.files); });
  inputEl.addEventListener('change', e => handler(e.target.files));
}

// ================================================================
// MODE SWITCH
// ================================================================
function setMode(m) {
  state.mode = m;
  $.tab2d.classList.toggle('active', m === 'slideshow');
  $.tab3d.classList.toggle('active', m === 'scene3d');
  $.slideshowPanel.style.display = m === 'slideshow' ? '' : 'none';
  $.scene3dPanel.style.display   = m === 'scene3d'   ? '' : 'none';
  if (m === 'scene3d') initThreeIfNeeded();
  checkReady();
}

// ================================================================
// WARP TOGGLE
// ================================================================
function toggleWarpUI() {
  const on = $.warpEnabled.checked;
  $.warpBody.classList.toggle('hidden', !on);
  $.warpLegend.style.display = on ? 'flex' : 'none';
  recomputeWarp();
}

// ================================================================
// AUDIO LOADING
// ================================================================
async function loadAudio(file) {
  if (!file) return;
  state.audioFile = file;
  setStatus('beatStatus', '⏳ Decoding audio…', 'info');

  let arrayBuf;
  try { arrayBuf = await file.arrayBuffer(); }
  catch(e) { setStatus('beatStatus', '❌ File read error: ' + e.message, 'error'); return; }

  const tmpCtx = new OfflineAudioContext(1, 1, 44100);
  try {
    state.audioBuffer = await tmpCtx.decodeAudioData(arrayBuf);
  } catch(e) {
    setStatus('beatStatus', '❌ Could not decode audio: ' + e.message, 'error');
    toast('Could not decode audio file', 'error');
    return;
  }

  drawWaveform();
  detectBeats();
  $.step1num.classList.add('done');
  $.timeDisplay.textContent = '0:00 / ' + fmt(state.audioBuffer.duration);
  updateHeaderStats();
  toast(`Loaded "${file.name}"`, 'ok', 2500);
  checkReady();
}

// ================================================================
// BEAT DETECTION
// ================================================================
function detectBeats() {
  if (!state.audioBuffer) return;
  const buf = state.audioBuffer;
  const sr = buf.sampleRate;
  const band = $.bandSelect.value;
  const sensitivity = parseFloat($.sensitivity.value);
  const minGap = parseFloat($.minGap.value);

  // Mono mix
  let data;
  if (buf.numberOfChannels === 1) {
    data = buf.getChannelData(0);
  } else {
    const ch0 = buf.getChannelData(0), ch1 = buf.getChannelData(1);
    data = new Float32Array(ch0.length);
    for (let i = 0; i < data.length; i++) data[i] = (ch0[i] + ch1[i]) * 0.5;
  }

  // Band filter
  let filtered = data;
  if (band === 'bass') filtered = lpf(data, sr, 200);
  else if (band === 'mid') filtered = bpf(data, sr, 200, 2000);

  // Energy windows
  const wMs = 10, wSamp = Math.floor(sr * wMs / 1000), hop = Math.floor(wSamp / 2);
  const energies = [], times = [];
  for (let i = 0; i < filtered.length - wSamp; i += hop) {
    let e = 0;
    for (let j = 0; j < wSamp; j++) e += filtered[i + j] ** 2;
    energies.push(e / wSamp);
    times.push(i / sr);
  }

  // Onset strength (positive energy delta)
  const onset = new Float32Array(energies.length);
  for (let i = 1; i < energies.length; i++) onset[i] = Math.max(0, energies[i] - energies[i - 1]);
  const smoothed = movingAvg(onset, 3);

  // Adaptive threshold peak-picking
  const localWin = 20;
  const beats = [];
  let lastBeat = -999;
  for (let i = 2; i < smoothed.length - 2; i++) {
    const s = Math.max(0, i - localWin), e2 = Math.min(smoothed.length, i + localWin);
    let lMean = 0;
    for (let j = s; j < e2; j++) lMean += smoothed[j];
    lMean /= (e2 - s);
    if (
      smoothed[i] > lMean * sensitivity &&
      smoothed[i] > smoothed[i - 1] && smoothed[i] > smoothed[i - 2] &&
      smoothed[i] > smoothed[i + 1] && smoothed[i] > smoothed[i + 2]
    ) {
      const t = times[i];
      if (t - lastBeat >= minGap) { beats.push(t); lastBeat = t; }
    }
  }

  state.beats = beats;
  setStatus('beatStatus', `✅ Detected <strong>${beats.length}</strong> beats`, 'ok');
  drawBeatCanvas();
  renderProgressBeats();
  recomputeWarp();
  updateHeaderStats();
  checkReady();
}

function redetect() { if (state.audioBuffer) detectBeats(); }

// DSP filters
function lpf(data, sr, cutHz) {
  const alpha = (1 / sr) / (1 / (2 * Math.PI * cutHz) + 1 / sr);
  const out = new Float32Array(data.length);
  out[0] = data[0];
  for (let i = 1; i < data.length; i++) out[i] = out[i - 1] + alpha * (data[i] - out[i - 1]);
  return out;
}
function bpf(data, sr, lo, hi) {
  const a = lpf(data, sr, hi), b = lpf(data, sr, lo);
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = a[i] - b[i];
  return out;
}
function movingAvg(arr, w) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(arr.length - 1, i + w); j++) { sum += arr[j]; cnt++; }
    out[i] = sum / cnt;
  }
  return out;
}

// ================================================================
// WARP ENGINE
// ================================================================
function recomputeWarp() {
  if (!state.beats.length || !state.mediaObjects.length) {
    state.warpSchedule = [];
    drawWarpTimeline();
    return;
  }
  const warpEnabled = $.warpEnabled.checked;
  const warpMode    = $.warpMode.value;
  const warpMin     = parseFloat($.warpMin.value);
  const warpMax     = parseFloat($.warpMax.value);
  const loopMode    = $.loopMedia.value;
  const audioDur    = state.audioBuffer ? state.audioBuffer.duration : 0;
  const beats       = state.beats;
  const schedule    = [];

  for (let i = 0; i < beats.length; i++) {
    const startTime   = beats[i];
    const endTime     = i + 1 < beats.length ? beats[i + 1] : audioDur;
    const gapDuration = endTime - startTime;

    let mediaIdx;
    if (loopMode === 'random') mediaIdx = Math.floor(Math.random() * state.mediaObjects.length);
    else if (loopMode === 'once') mediaIdx = Math.min(i, state.mediaObjects.length - 1);
    else mediaIdx = i % state.mediaObjects.length;

    const obj     = state.mediaObjects[mediaIdx];
    const isVideo = obj && obj.tagName === 'VIDEO';
    const clipName = state.mediaFiles[mediaIdx]?.name ?? '';

    let warpRate = 1.0;
    if (warpEnabled && isVideo && obj.duration && isFinite(obj.duration) && gapDuration > 0) {
      const clipDur = obj.duration;
      if      (warpMode === 'fit')  warpRate = clipDur / gapDuration;
      else if (warpMode === 'fill') warpRate = Math.max(1.0, clipDur / gapDuration);
      // loop / trim → 1.0
      warpRate = Math.max(warpMin, Math.min(warpMax, warpRate));
    }

    schedule.push({ beatIdx: i, mediaIdx, startTime, endTime, gapDuration, warpRate, isVideo, clipName });
  }

  state.warpSchedule = schedule;
  drawWarpTimeline();
  showWarpStats();
}

function showWarpStats() {
  if (!state.warpSchedule.length || !$.warpEnabled.checked) { $.warpStat.style.display = 'none'; return; }
  const vidSlots = state.warpSchedule.filter(s => s.isVideo);
  if (!vidSlots.length) { $.warpStat.style.display = 'none'; return; }

  const rates = vidSlots.map(s => s.warpRate);
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  const minR = Math.min(...rates), maxR = Math.max(...rates);
  const warpMin = parseFloat($.warpMin.value), warpMax = parseFloat($.warpMax.value);
  const clamped = state.warpSchedule.filter(s => {
    if (!s.isVideo) return false;
    const obj = state.mediaObjects[s.mediaIdx];
    if (!obj?.duration) return false;
    const ideal = obj.duration / s.gapDuration;
    return ideal < warpMin || ideal > warpMax;
  }).length;

  $.warpStat.style.display = '';
  $.warpStat.innerHTML = `
    <strong>Warp Statistics</strong>
    ${vidSlots.length} video slots &nbsp;·&nbsp; ${rates.length - vidSlots.length} image slots<br>
    Speed range: <strong>${minR.toFixed(2)}×</strong> → <strong>${maxR.toFixed(2)}×</strong><br>
    Average speed: <strong>${avg.toFixed(2)}×</strong><br>
    ${clamped ? `<span style="color:var(--warn)">⚠ ${clamped} slot(s) hit speed clamp</span>` : '<span style="color:var(--success)">✓ All slots within limits</span>'}
  `;
}

// ================================================================
// CANVAS RENDERING: WAVEFORM + BEAT + WARP
// ================================================================
function drawWaveform() {
  const canvas = $.waveformCanvas;
  const W = canvas.offsetWidth || 300, H = 56;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const data = state.audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / W);
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#7c3aed');
  grad.addColorStop(0.5, '#06b6d4');
  grad.addColorStop(1, '#7c3aed');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < W; x++) {
    let mn = 1, mx = -1;
    for (let j = 0; j < step; j++) {
      const v = data[x * step + j] || 0;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    ctx.moveTo(x, (1 - mx) / 2 * H);
    ctx.lineTo(x, (1 - mn) / 2 * H);
  }
  ctx.stroke();
}

function drawBeatCanvas() {
  const canvas = $.beatCanvas;
  const W = canvas.offsetWidth || 300, H = 22;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#181830'; ctx.fillRect(0, 0, W, H);
  if (!state.audioBuffer || !state.beats.length) return;
  const dur = state.audioBuffer.duration;
  state.beats.forEach(t => {
    const x = (t / dur) * W;
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(x - 1, 2, 2, H - 4);
  });
}

function drawWarpTimeline(progressTime) {
  const canvas = $.warpCanvas;
  const W = canvas.offsetWidth || 300, H = 34;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#181830'; ctx.fillRect(0, 0, W, H);
  if (!state.audioBuffer) return;
  const dur = state.audioBuffer.duration;
  const warpOn = $.warpEnabled.checked;
  const sched = state.warpSchedule;

  if (!sched.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let t = 0; t < dur; t += 5) ctx.fillRect((t / dur) * W, 0, 1, H);
  } else {
    sched.forEach(slot => {
      const x1 = Math.floor((slot.startTime / dur) * W);
      const x2 = Math.floor((slot.endTime   / dur) * W);
      const bw  = Math.max(1, x2 - x1 - 1);
      let color;
      if (!slot.isVideo || !warpOn) color = 'rgba(124,58,237,0.32)';
      else {
        const r = slot.warpRate;
        if      (r < 0.7)  color = '#3b82f6';
        else if (r <= 1.3) color = '#10b981';
        else if (r <= 2.0) color = '#f59e0b';
        else               color = '#ef4444';
      }
      ctx.fillStyle = color;
      ctx.fillRect(x1, 4, bw, H - 8);

      if (bw > 24) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          slot.isVideo && warpOn ? slot.warpRate.toFixed(2) + '×' : '🖼',
          x1 + 3, H / 2
        );
      }

      // beat divider
      ctx.fillStyle = 'rgba(245,158,11,0.5)';
      ctx.fillRect(x1, 0, 1, 4);
    });
  }

  // playhead
  if (progressTime !== undefined) {
    const px = (progressTime / dur) * W;
    // highlight active slot
    const activeSlot = sched.find(s => progressTime >= s.startTime && progressTime < s.endTime);
    if (activeSlot) {
      const x1 = Math.floor((activeSlot.startTime / dur) * W);
      const x2 = Math.floor((activeSlot.endTime   / dur) * W);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x1 + 0.5, 4.5, Math.max(1, x2 - x1 - 1), H - 9);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(px - 1, 0, 2, H);
  }
}

// Draw beat ticks on the progress bar
function renderProgressBeats() {
  if (!$.progressBeats || !state.audioBuffer || !state.beats.length) return;
  $.progressBeats.innerHTML = '';
  const dur = state.audioBuffer.duration;
  state.beats.forEach(t => {
    const div = document.createElement('div');
    div.className = 'pb-tick';
    div.style.left = ((t / dur) * 100) + '%';
    $.progressBeats.appendChild(div);
  });
}

// ================================================================
// MEDIA LOADING
// ================================================================
async function addMedia(files) {
  let added = 0;
  for (const f of files) {
    if (state.mediaFiles.find(x => x.name === f.name)) continue;
    state.mediaFiles.push(f);
    const url = URL.createObjectURL(f);
    let obj;
    if (f.type.startsWith('video/')) {
      obj = document.createElement('video');
      obj.src = url;
      obj.muted = true;
      obj.preload = 'auto';
      obj.loop = true;
      await new Promise(r => { obj.onloadedmetadata = r; obj.onerror = r; setTimeout(r, 4000); });
    } else {
      obj = new Image();
      obj.src = url;
      await new Promise(r => { obj.onload = r; obj.onerror = r; });
    }
    state.mediaObjects.push(obj);
    addChip('mediaChips', f, () => removeMedia(f.name));
    added++;
  }
  if (added) {
    $.step2num.classList.add('done');
    $.emptyState.style.display = 'none';
    recomputeWarp();
    updateHeaderStats();
    checkReady();
    toast(`Added ${added} clip${added > 1 ? 's' : ''}`, 'ok', 2200);
  }
}

function removeMedia(name) {
  const idx = state.mediaFiles.findIndex(f => f.name === name);
  if (idx >= 0) { state.mediaFiles.splice(idx, 1); state.mediaObjects.splice(idx, 1); }
  rebuildChips('mediaChips', state.mediaFiles, f => removeMedia(f.name));
  recomputeWarp();
  updateHeaderStats();
  checkReady();
}

async function addScene3d(files) {
  for (const f of files) {
    if (state.scene3dFiles.find(x => x.name === f.name)) continue;
    state.scene3dFiles.push(f);
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await new Promise(r => { img.onload = r; img.onerror = r; });
    state.scene3dObjects.push(img);
    addChip('scene3dChips', f, () => removeScene3d(f.name));
  }
  $.step2num.classList.add('done');
  $.emptyState.style.display = 'none';
  buildThreeScene();
  checkReady();
}

function removeScene3d(name) {
  const idx = state.scene3dFiles.findIndex(f => f.name === name);
  if (idx >= 0) { state.scene3dFiles.splice(idx, 1); state.scene3dObjects.splice(idx, 1); }
  rebuildChips('scene3dChips', state.scene3dFiles, f => removeScene3d(f.name));
  buildThreeScene();
}

function addChip(containerId, file, onRemove) {
  const c = document.getElementById(containerId);
  const isVid = file.type?.startsWith('video/');
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.dataset.name = file.name;
  chip.innerHTML = `
    <span class="chip-icon">${isVid ? '🎬' : '🖼'}</span>
    <span class="chip-name" title="${file.name}">${file.name}</span>
    <span class="chip-x">✕</span>`;
  chip.querySelector('.chip-x').addEventListener('click', onRemove);
  c.appendChild(chip);
}

function rebuildChips(containerId, files, removeFn) {
  document.getElementById(containerId).innerHTML = '';
  files.forEach(f => addChip(containerId, f, () => removeFn(f)));
}

// ================================================================
// READINESS
// ================================================================
function checkReady() {
  const hasAudio = !!state.audioBuffer;
  const hasMedia = state.mode === 'slideshow'
    ? state.mediaObjects.length > 0
    : state.scene3dObjects.length > 0;
  const ready = hasAudio && hasMedia && state.beats.length > 0;
  $.previewBtn.disabled = !ready;
  $.exportBtn.disabled  = !ready;
}

// ================================================================
// PLAYBACK
// ================================================================
function togglePlay() {
  if (state.isPlaying) stopPlayback();
  else startPreview();
}

async function startPreview(exportMode = false) {
  if (!state.audioBuffer) return;
  stopPlayback();
  $.emptyState.style.display = 'none';

  state.audioCtx  = new AudioContext();
  const ab        = await state.audioFile.arrayBuffer();
  const decoded   = await state.audioCtx.decodeAudioData(ab);
  state.analyser  = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 256;
  state.audioSource = state.audioCtx.createBufferSource();
  state.audioSource.buffer = decoded;

  let audioDest = null;
  if (exportMode) {
    audioDest = state.audioCtx.createMediaStreamDestination();
    state.audioSource.connect(state.analyser);
    state.analyser.connect(audioDest);
    state.analyser.connect(state.audioCtx.destination);
  } else {
    state.audioSource.connect(state.analyser);
    state.analyser.connect(state.audioCtx.destination);
  }

  state.audioSource.start(0, state.pauseOffset);
  state.startTime       = state.audioCtx.currentTime - state.pauseOffset;
  state.isPlaying       = true;
  state.currentMediaIdx = 0;
  state.currentSlotIdx  = -1;
  state.nextBeatIdx     = Math.max(0, state.beats.findIndex(b => b >= state.pauseOffset));
  $.playBtn.textContent = '⏸';

  state.audioSource.onended = () => {
    if (!state.isExporting) stopPlayback();
    else if (state.recorder) state.recorder.stop();
  };

  // Pause all videos
  state.mediaObjects.forEach(o => { if (o.tagName === 'VIDEO') { o.pause(); o.currentTime = 0; } });

  if (state.mode === 'scene3d') {
    $.previewCanvas.style.display = 'none';
    $.threeCanvas.style.display   = '';
    renderLoop3D();
  } else {
    $.previewCanvas.style.display = '';
    $.threeCanvas.style.display   = 'none';
    renderLoop2D();
  }

  return audioDest;
}

function stopPlayback() {
  if (state.audioSource) { try { state.audioSource.stop(); } catch (e) {} state.audioSource = null; }
  if (state.audioCtx)    { state.audioCtx.close(); state.audioCtx = null; }
  if (state.animFrame)   { cancelAnimationFrame(state.animFrame); state.animFrame = null; }
  state.mediaObjects.forEach(o => { if (o.tagName === 'VIDEO') o.pause(); });
  state.isPlaying    = false;
  state.isExporting  = false;
  state.pauseOffset  = 0;
  state.currentSlotIdx = -1;
  $.playBtn.textContent = '▶';
  $.progressBar.style.width = '0%';
  $.progressThumb.style.left = '0%';
  $.timeDisplay.textContent = '0:00 / ' + fmt(state.audioBuffer?.duration ?? 0);
  $.warpBadge.classList.remove('visible');
  $.nowPlaying.classList.remove('visible');
  drawWarpTimeline();
}

function seekAudio(e) {
  if (!state.audioBuffer) return;
  const rect = $.progressWrap.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  state.pauseOffset = ratio * state.audioBuffer.duration;
  if (state.isPlaying) startPreview();
  else {
    $.progressBar.style.width = (ratio * 100) + '%';
    $.progressThumb.style.left = (ratio * 100) + '%';
    $.timeDisplay.textContent = fmt(state.pauseOffset) + ' / ' + fmt(state.audioBuffer.duration);
  }
}

// ================================================================
// 2D RENDER LOOP
// ================================================================
function renderLoop2D() {
  if (!state.isPlaying) return;
  const currentTime = state.audioCtx.currentTime - state.startTime;
  const duration    = state.audioBuffer.duration;

  while (state.nextBeatIdx < state.beats.length && state.beats[state.nextBeatIdx] <= currentTime) {
    triggerBeat2D(state.nextBeatIdx);
    state.nextBeatIdx++;
  }

  const energy = getEnergy();
  const res = $.resolution.value.split('x');
  const W = parseInt(res[0]), H = parseInt(res[1]);
  if ($.previewCanvas.width !== W) { $.previewCanvas.width = W; $.previewCanvas.height = H; }
  const ctx = $.previewCanvas.getContext('2d');

  drawFrame2D(ctx, W, H, currentTime, energy);

  const pct = Math.min(1, currentTime / duration) * 100;
  $.progressBar.style.width  = pct + '%';
  $.progressThumb.style.left = pct + '%';
  $.timeDisplay.textContent  = fmt(currentTime) + ' / ' + fmt(duration);
  drawWarpTimeline(currentTime);
  updateWarpBadge(currentTime);
  updateNowPlaying(currentTime);

  if (currentTime < duration) {
    state.animFrame = requestAnimationFrame(renderLoop2D);
  } else {
    stopPlayback();
  }
}

function triggerBeat2D(beatIdx) {
  const n = state.mediaObjects.length;
  if (!n) return;

  const warpEnabled = $.warpEnabled.checked;
  const warpMode    = $.warpMode.value;
  const slot        = state.warpSchedule[beatIdx];

  let nextMediaIdx = 0;
  let warpRate     = 1.0;

  if (slot) {
    nextMediaIdx = slot.mediaIdx;
    warpRate     = slot.warpRate;
    state.currentSlotIdx = beatIdx;
  } else {
    const loopMode = $.loopMedia.value;
    if      (loopMode === 'random') nextMediaIdx = Math.floor(Math.random() * n);
    else if (loopMode === 'once')   nextMediaIdx = Math.min(state.currentMediaIdx + 1, n - 1);
    else                            nextMediaIdx = (state.currentMediaIdx + 1) % n;
  }

  const prevIdx      = state.currentMediaIdx;
  const incomingObj  = state.mediaObjects[nextMediaIdx];

  // Apply warp rate to incoming video
  if (incomingObj?.tagName === 'VIDEO') {
    incomingObj.playbackRate = warpEnabled
      ? Math.max(0.0625, Math.min(16, warpRate))
      : 1.0;
    incomingObj.loop = true;
    incomingObj.currentTime = 0;
    try { incomingObj.play(); } catch (e) {}
  }

  // Pause previous if different
  if (prevIdx !== nextMediaIdx) {
    const prev = state.mediaObjects[prevIdx];
    if (prev?.tagName === 'VIDEO') prev.pause();
  }

  state.currentMediaIdx = nextMediaIdx;
  state.currentWarpRate = warpRate;

  // Start transition
  const currentTime = state.audioCtx ? state.audioCtx.currentTime - state.startTime : 0;
  transitionState = {
    active: true, progress: 0,
    fromIdx: prevIdx, toIdx: nextMediaIdx,
    type: $.transition.value,
    duration: parseFloat($.transDuration.value),
    startTime: currentTime
  };

  // Beat flash
  const fa = parseFloat($.flashAlpha.value);
  if (fa > 0) {
    $.beatFlash.style.opacity = fa;
    setTimeout(() => { $.beatFlash.style.opacity = 0; }, 60);
  }
}

function drawFrame2D(ctx, W, H, currentTime, energy) {
  if (!state.mediaObjects.length) return;

  if (transitionState.active) {
    const elapsed = currentTime - transitionState.startTime;
    transitionState.progress = Math.min(1, elapsed / Math.max(0.01, transitionState.duration));
    if (transitionState.progress >= 1) transitionState.active = false;
  }

  const fromObj = state.mediaObjects[transitionState.active ? transitionState.fromIdx : state.currentMediaIdx];
  const toObj   = state.mediaObjects[state.currentMediaIdx];
  const t       = transitionState.active ? transitionState.progress : 1;
  const type    = transitionState.type;

  ctx.save();
  drawMedia(ctx, fromObj, 0, 0, W, H);

  if (transitionState.active && t < 1) {
    if (type === 'cut') {
      if (t > 0.5) drawMedia(ctx, toObj, 0, 0, W, H);
    } else if (type === 'fade') {
      ctx.globalAlpha = t; drawMedia(ctx, toObj, 0, 0, W, H); ctx.globalAlpha = 1;
    } else if (type === 'zoom') {
      const scale = 1 + (1 - t) * 0.3;
      ctx.save();
      ctx.translate(W / 2, H / 2); ctx.scale(scale, scale); ctx.translate(-W / 2, -H / 2);
      ctx.globalAlpha = t; drawMedia(ctx, toObj, 0, 0, W, H);
      ctx.restore();
    } else if (type === 'slide') {
      drawMedia(ctx, toObj, (1 - t) * W, 0, W, H);
    } else if (type === 'flash') {
      if (t < 0.5) {
        ctx.fillStyle = `rgba(255,255,255,${1 - t * 2})`; ctx.fillRect(0, 0, W, H);
      } else {
        ctx.globalAlpha = (t - 0.5) * 2; drawMedia(ctx, toObj, 0, 0, W, H); ctx.globalAlpha = 1;
      }
    }
  } else {
    drawMedia(ctx, toObj, 0, 0, W, H);
  }

  // Energy vignette
  if (energy > 0.2) {
    const r   = Math.floor(energy * 255);
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.8);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(${r},0,${Math.floor(energy * 80)},${energy * 0.18})`);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

function drawMedia(ctx, obj, x, y, w, h) {
  if (!obj) return;
  try {
    if (obj.tagName === 'VIDEO') {
      ctx.drawImage(obj, x, y, w, h);
    } else {
      const iw = obj.naturalWidth  || obj.width  || 1;
      const ih = obj.naturalHeight || obj.height || 1;
      const scale = Math.max(w / iw, h / ih);
      ctx.drawImage(obj, x + (w - iw * scale) / 2, y + (h - ih * scale) / 2, iw * scale, ih * scale);
    }
  } catch (e) {}
}

function getEnergy() {
  if (!state.analyser) return 0;
  const data = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteFrequencyData(data);
  let sum = 0;
  const bins = Math.min(20, data.length);
  for (let i = 0; i < bins; i++) sum += data[i];
  return sum / (bins * 255);
}

// ================================================================
// HUD UPDATES
// ================================================================
function updateWarpBadge(currentTime) {
  const warpOn = $.warpEnabled.checked;
  const slot   = state.warpSchedule.find(s => currentTime >= s.startTime && currentTime < s.endTime);

  if (warpOn && slot?.isVideo) {
    $.warpBadge.classList.add('visible');
    $.warpBadgeText.textContent = slot.warpRate.toFixed(2) + '×';
    const r = slot.warpRate;
    const col = r < 0.7 ? '#3b82f6' : r <= 1.3 ? '#10b981' : r <= 2.0 ? '#f59e0b' : '#ef4444';
    $.warpBadge.style.borderColor = col;
    $.warpBadge.style.color = col;
  } else {
    $.warpBadge.classList.remove('visible');
  }
}

function updateNowPlaying(currentTime) {
  const slot = state.warpSchedule[state.currentSlotIdx];
  if (!slot) { $.nowPlaying.classList.remove('visible'); return; }
  $.nowPlaying.classList.add('visible');
  const name = slot.clipName || `Clip ${slot.mediaIdx + 1}`;
  $.nowPlaying.querySelector('.np-text').textContent = name;
}

// ================================================================
// THREE.JS 3D SCENE
// ================================================================
function initThreeIfNeeded() {
  if (state.threeRenderer) return;
  const canvas = $.threeCanvas;
  const wrap   = document.getElementById('canvasWrap');
  state.threeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  state.threeRenderer.setPixelRatio(window.devicePixelRatio);
  state.threeRenderer.setSize(wrap.offsetWidth, wrap.offsetHeight);
  state.threeCamera = new THREE.PerspectiveCamera(75, wrap.offsetWidth / wrap.offsetHeight, 0.1, 1000);
  state.threeScene  = new THREE.Scene();
  state.threeCamera.position.set(0, 0, 5);
  state.threeTargetPos  = new THREE.Vector3(0, 0, 5);
  state.threeTargetLook = new THREE.Vector3(0, 0, 0);
}

function buildThreeScene() {
  initThreeIfNeeded();
  const scene = state.threeScene;
  while (scene.children.length) scene.remove(scene.children[0]);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dl = new THREE.DirectionalLight(0xffffff, 0.8);
  dl.position.set(5, 5, 5); scene.add(dl);

  const sceneType = $.sceneType.value;
  const imgs = state.scene3dObjects;

  if (sceneType === 'panorama' && imgs.length > 0) {
    const tex = new THREE.Texture(imgs[0]); tex.needsUpdate = true;
    const geo = new THREE.SphereGeometry(50, 60, 40); geo.scale(-1, 1, 1);
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex })));
    state.threeCamera.position.set(0, 0, 0);
    state.threeTargetPos = new THREE.Vector3(0, 0, 0);
  } else if (sceneType === 'gallery' && imgs.length > 0) {
    imgs.forEach((img, i) => {
      const tex = new THREE.Texture(img); tex.needsUpdate = true;
      const aspect = img.naturalWidth / (img.naturalHeight || 1);
      const geo = new THREE.PlaneGeometry(4 * aspect, 4);
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      const angle = (i / imgs.length) * Math.PI * 2;
      mesh.position.set(Math.cos(angle) * 12, (Math.random() - 0.5) * 6, Math.sin(angle) * 12);
      mesh.lookAt(0, 0, 0);
      scene.add(mesh);
    });
    state.threeCamera.position.set(0, 0, 0.1);
    state.threeTargetPos = new THREE.Vector3(0, 0, 0.1);
    addParticles(scene, 300, 20);
  } else if (sceneType === 'particles') {
    addParticles(scene, 2000, 30);
    if (imgs.length > 0) {
      const tex = new THREE.Texture(imgs[0]); tex.needsUpdate = true;
      const geo = new THREE.SphereGeometry(20, 32, 32); geo.scale(-1, 1, 1);
      scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.4 })));
    }
  } else {
    addParticles(scene, 1000, 40);
  }
}

function addParticles(scene, count, spread) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) pos[i] = (Math.random() - 0.5) * spread;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x7c3aed, size: 0.08, transparent: true, opacity: 0.6 })));
}

function pickNewThreeTarget() {
  const sceneType = $.sceneType.value;
  if (sceneType === 'panorama') {
    const yaw = (Math.random() - 0.5) * Math.PI * 2, pitch = (Math.random() - 0.5) * 0.8;
    state.threeTargetLook.set(Math.sin(yaw) * 0.01, Math.sin(pitch) * 0.01, Math.cos(yaw) * 0.01);
  } else if (sceneType === 'gallery' && state.scene3dObjects.length > 0) {
    const idx = Math.floor(Math.random() * state.scene3dObjects.length);
    const angle = (idx / state.scene3dObjects.length) * Math.PI * 2;
    state.threeTargetPos.set(Math.cos(angle) * 7, (Math.random() - 0.5) * 2, Math.sin(angle) * 7);
    state.threeTargetLook.set(Math.cos(angle) * 12, 0, Math.sin(angle) * 12);
  } else {
    state.threeTargetLook.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 10);
  }
}

function renderLoop3D() {
  if (!state.isPlaying) return;
  const currentTime = state.audioCtx.currentTime - state.startTime;
  const duration    = state.audioBuffer.duration;

  while (state.nextBeatIdx < state.beats.length && state.beats[state.nextBeatIdx] <= currentTime) {
    pickNewThreeTarget();
    const fa = parseFloat($.flashAlpha.value);
    if (fa > 0) { $.beatFlash.style.opacity = fa; setTimeout(() => { $.beatFlash.style.opacity = 0; }, 80); }
    state.nextBeatIdx++;
  }

  const energy    = getEnergy();
  const baseSpeed = parseFloat($.camSpeed.value);
  const snapStr   = parseFloat($.beatSnap.value);
  const lerpSpeed = 0.02 + energy * baseSpeed * 0.08;

  state.threeCamera.position.lerp(state.threeTargetPos, lerpSpeed * baseSpeed);
  const tq = new THREE.Quaternion();
  const lm = new THREE.Matrix4().lookAt(state.threeCamera.position, state.threeTargetLook, new THREE.Vector3(0, 1, 0));
  tq.setFromRotationMatrix(lm);
  state.threeCamera.quaternion.slerp(tq, lerpSpeed * snapStr * 3);
  state.threeCamera.position.y += Math.sin(currentTime * 2) * energy * 0.02 * baseSpeed;

  const wrap = document.getElementById('canvasWrap');
  state.threeRenderer.setSize(wrap.offsetWidth, wrap.offsetHeight);
  state.threeCamera.aspect = wrap.offsetWidth / wrap.offsetHeight;
  state.threeCamera.updateProjectionMatrix();
  state.threeRenderer.render(state.threeScene, state.threeCamera);

  const pct = Math.min(1, currentTime / duration) * 100;
  $.progressBar.style.width  = pct + '%';
  $.progressThumb.style.left = pct + '%';
  $.timeDisplay.textContent  = fmt(currentTime) + ' / ' + fmt(duration);
  drawWarpTimeline(currentTime);

  if (currentTime < duration) state.animFrame = requestAnimationFrame(renderLoop3D);
  else stopPlayback();
}

function updateSceneTypeUI() { if (state.scene3dObjects.length > 0) buildThreeScene(); }

// ================================================================
// EXPORT
// ================================================================
async function startExport() {
  if (state.isExporting || !state.audioBuffer) return;
  stopPlayback();
  state.isExporting = true;
  setStatus('exportStatus', '<span class="rec-dot"></span>&nbsp;Recording… plays through automatically', 'warn');
  $.exportBtn.disabled = true;
  toast('Recording started — play through to the end', 'rec', 5000);

  const audioDest = await startPreview(true);
  const exportCanvas = state.mode === 'slideshow' ? $.previewCanvas : $.threeCanvas;
  const quality   = parseInt($.quality.value);
  const vStream   = exportCanvas.captureStream(30);
  const tracks    = [...vStream.getTracks()];
  if (audioDest) tracks.push(...audioDest.stream.getTracks());

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus' : 'video/webm';
  state.recorder = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: quality });
  const chunks = [];
  state.recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  state.recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'beatsynq_export.webm'; a.click();
    setStatus('exportStatus', '✅ Export downloaded!', 'ok');
    $.exportBtn.disabled = false;
    state.isExporting = false;
    toast('Export ready — check your downloads', 'ok');
  };
  state.recorder.start(100);
}

// ================================================================
// BOOT — wire everything up once DOM is ready
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  cacheDom();

  // Accordion sections
  document.querySelectorAll('.section-header').forEach(h => {
    h.addEventListener('click', () => h.closest('.section').classList.toggle('open'));
  });
  ['sec1','sec2','sec3'].forEach(id => document.getElementById(id)?.classList.add('open'));

  // Drop zones
  setupDrop($.audioZone,   $.audioInput,   files => loadAudio(files[0]));
  setupDrop($.mediaZone,   $.mediaInput,   files => addMedia([...files]));
  setupDrop($.scene3dZone, $.scene3dInput, files => addScene3d([...files]));

  // Dropzone click passthroughs
  $.audioZone.addEventListener('click',   () => $.audioInput.click());
  $.mediaZone.addEventListener('click',   () => $.mediaInput.click());
  $.scene3dZone.addEventListener('click', () => $.scene3dInput.click());

  // Mode tabs
  $.tab2d.addEventListener('click', () => setMode('slideshow'));
  $.tab3d.addEventListener('click', () => setMode('scene3d'));

  // Playback buttons
  $.playBtn.addEventListener('click', togglePlay);
  document.getElementById('stopBtn')?.addEventListener('click', stopPlayback);
  document.getElementById('previewBtn').addEventListener('click', startPreview);
  $.exportBtn.addEventListener('click', startExport);

  // Seek
  $.progressWrap.addEventListener('click', seekAudio);

  // Sliders with display update
  const sliderMap = {
    sensitivity: { val: 'sensitivityVal', fn: redetect },
    minGap:      { val: 'minGapVal',      fn: redetect },
    transDuration: { val: 'transDurVal' },
    camSpeed:    { val: 'camSpeedVal' },
    beatSnap:    { val: 'beatSnapVal' },
    flashAlpha:  { val: 'flashAlphaVal' },
    warpMin:     { val: 'warpMinVal',     fn: recomputeWarp },
    warpMax:     { val: 'warpMaxVal',     fn: recomputeWarp },
  };
  Object.entries(sliderMap).forEach(([id, { val, fn }]) => {
    const el = document.getElementById(id);
    if (!el) return;
    updateSliderDisplay(el, val); // init display
    el.addEventListener('input', () => { updateSliderDisplay(el, val); fn?.(); });
  });

  // Selects
  $.bandSelect.addEventListener('change', redetect);
  $.loopMedia.addEventListener('change', recomputeWarp);
  $.warpMode.addEventListener('change', recomputeWarp);
  $.sceneType.addEventListener('change', updateSceneTypeUI);

  // Warp toggle
  $.warpEnabled.addEventListener('change', toggleWarpUI);

  // Resize
  window.addEventListener('resize', () => {
    if (state.audioBuffer) { drawWaveform(); drawBeatCanvas(); drawWarpTimeline(); }
    if (state.threeRenderer) {
      const wrap = document.getElementById('canvasWrap');
      state.threeRenderer.setSize(wrap.offsetWidth, wrap.offsetHeight);
      if (state.threeCamera) {
        state.threeCamera.aspect = wrap.offsetWidth / wrap.offsetHeight;
        state.threeCamera.updateProjectionMatrix();
      }
    }
  });

  console.log('🎵 BeatSync Studio ready');
});
