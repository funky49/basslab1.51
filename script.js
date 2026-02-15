// script.js
document.addEventListener('DOMContentLoaded', () => {
  // -----------------------------
  // Year
  // -----------------------------
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // -----------------------------
  // Shared Audio Engine
  // -----------------------------
  let audioContext = null;

  // Generator nodes
  let genOsc = null;
  let genGain = null;
  let genLPF = null;
  let genRunning = false;

  // Test tone nodes
  let testOsc = null;
  let testGain = null;
  let testRunning = false;

  // Visualizer
  let analyser = null;
  let vizRAF = 0;

  function ensureContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
  }

  function setupAnalyser(ctx) {
    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.1; // tweak to taste (0.9 = gooey)
    }
    return analyser;
  }

  function softStopNode(ctx, osc, gain, onDone) {
    try {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.06);
      osc.stop(now + 0.07);
      osc.onended = () => onDone?.();
    } catch {
      onDone?.();
    }
  }

  // -----------------------------
  // Waveform visualizer (canvas inside panic button)
  // -----------------------------
  function stopWaveform() {
    if (vizRAF) cancelAnimationFrame(vizRAF);
    vizRAF = 0;

    const canvas = document.getElementById('waveCanvas');
    if (canvas) {
      const c = canvas.getContext('2d');
      c.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function startWaveform() {
    const canvas = document.getElementById('waveCanvas');
    if (!canvas || !analyser) return;

    const c = canvas.getContext('2d', { alpha: true });

    // size canvas to CSS pixels * DPR for crispness
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    const data = new Uint8Array(analyser.fftSize);

    c.lineWidth = 2;
    c.strokeStyle = 'rgba(255,59,48,0.90)';

    function draw() {
      vizRAF = requestAnimationFrame(draw);

      analyser.getByteTimeDomainData(data);

      const w = rect.width;
      const h = rect.height;

      c.clearRect(0, 0, w, h);

      // baseline
      c.globalAlpha = 0.25;
      c.beginPath();
      c.moveTo(0, h / 2);
      c.lineTo(w, h / 2);
      c.stroke();
      c.globalAlpha = 1;

      // waveform
      const mid = h / 2;
      const scaleX = w / (data.length - 1);

      c.beginPath();
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128; // -1..1
        const x = i * scaleX;
        const y = mid + v * (mid - 2);

        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }

    stopWaveform();
    draw();
  }

  // -----------------------------
  // Stop everything (single source of truth)
  // -----------------------------
  function stopAllAudio() {
    const ctx = audioContext;

    // stop generator
    if (ctx && genRunning && genOsc && genGain) {
      genRunning = false;
      softStopNode(ctx, genOsc, genGain, () => {
        genOsc = null;
        genGain = null;
        genLPF = null;
      });
    }

    // stop test tone
    if (ctx && testRunning && testOsc && testGain) {
      testRunning = false;
      softStopNode(ctx, testOsc, testGain, () => {
        testOsc = null;
        testGain = null;
      });
    }

    document.body.classList.remove('active-audio');
    stopWaveform();
  }

  // -----------------------------
  // Frequency control (25–75 Hz, default 49)
  // -----------------------------
  const MIN_HZ = 25;
  const MAX_HZ = 75;
  let currentHz = 49;

  const knobEl = document.getElementById('freqKnob');
  const readoutEl = document.getElementById('freqReadout');
  const indicatorEl = knobEl ? knobEl.querySelector('.knob-indicator') : null;

  function hzToAngle(hz) {
    const t = (hz - MIN_HZ) / (MAX_HZ - MIN_HZ);
    return -135 + t * 270;
  }

  function angleToHz(angle) {
    const a = Math.max(-135, Math.min(135, angle));
    const t = (a + 135) / 270;
    return Math.round(MIN_HZ + t * (MAX_HZ - MIN_HZ));
  }

  function setHz(hz) {
    currentHz = Math.max(MIN_HZ, Math.min(MAX_HZ, Math.round(hz)));

    if (readoutEl) readoutEl.textContent = String(currentHz);
    if (knobEl) {
      knobEl.setAttribute('aria-valuenow', String(currentHz));
      knobEl.setAttribute('aria-valuetext', `${currentHz} Hz`);
    }
    if (indicatorEl) {
      indicatorEl.style.transform = `translateX(-50%) rotate(${hzToAngle(currentHz)}deg)`;
    }

    // If generator running, update smoothly
    if (genRunning && audioContext && genOsc) {
      genOsc.frequency.setTargetAtTime(currentHz, audioContext.currentTime, 0.02);
    }
  }

  setHz(currentHz);

  // Knob drag
  let dragging = false;

  function getAngleFromPointer(clientX, clientY) {
    const rect = knobEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;

    let deg = Math.atan2(dy, dx) * (180 / Math.PI);
    deg = deg + 90;
    if (deg > 180) deg -= 360;
    return deg;
  }

  function pointerMove(e) {
    if (!dragging) return;
    const pt = e.touches ? e.touches[0] : e;
    setHz(angleToHz(getAngleFromPointer(pt.clientX, pt.clientY)));
  }

  function pointerUp() {
    dragging = false;
    window.removeEventListener('mousemove', pointerMove);
    window.removeEventListener('mouseup', pointerUp);
    window.removeEventListener('touchmove', pointerMove, { passive: false });
    window.removeEventListener('touchend', pointerUp);
  }

  if (knobEl) {
    knobEl.addEventListener('mousedown', (e) => {
      dragging = true;
      pointerMove(e);
      window.addEventListener('mousemove', pointerMove);
      window.addEventListener('mouseup', pointerUp);
    });

    knobEl.addEventListener(
      'touchstart',
      (e) => {
        dragging = true;
        pointerMove(e);
        window.addEventListener('touchmove', pointerMove, { passive: false });
        window.addEventListener('touchend', pointerUp);
      },
      { passive: true }
    );

    // Keyboard
    knobEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); setHz(currentHz + 1); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); setHz(currentHz - 1); }
      else if (e.key === 'PageUp') { e.preventDefault(); setHz(currentHz + 5); }
      else if (e.key === 'PageDown') { e.preventDefault(); setHz(currentHz - 5); }
      else if (e.key === 'Home') { e.preventDefault(); setHz(MIN_HZ); }
      else if (e.key === 'End') { e.preventDefault(); setHz(MAX_HZ); }
    });
  }

  // +/- buttons
  const downBtn = document.getElementById('freqDownBtn');
  const upBtn = document.getElementById('freqUpBtn');
  if (downBtn) downBtn.addEventListener('click', () => setHz(currentHz - 1));
  if (upBtn) upBtn.addEventListener('click', () => setHz(currentHz + 1));

  // -----------------------------
  // Generator Start/Stop (sine + LPF@120)
  // -----------------------------
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');

  function startGenerator() {
    if (genRunning) return;

    // ensure no other audio is running
    stopAllAudio();

    const ctx = ensureContext();
    setupAnalyser(ctx);

    genOsc = ctx.createOscillator();
    genGain = ctx.createGain();
    genLPF = ctx.createBiquadFilter();

    genOsc.type = 'sine';
    genOsc.frequency.value = currentHz;

    genLPF.type = 'lowpass';
    genLPF.frequency.value = 120;
    genLPF.Q.value = 0.707;

    genGain.gain.setValueAtTime(0, ctx.currentTime);

    genOsc.connect(genLPF);
    genLPF.connect(genGain);

    // visualizer tap
    genGain.connect(analyser);

    genGain.connect(ctx.destination);

    genOsc.start();
    genGain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.08);

    genRunning = true;
    document.body.classList.add('active-audio');
    startWaveform();
  }

  if (startBtn) startBtn.addEventListener('click', startGenerator);

  // Stop button = same as panic
  if (stopBtn) {
    stopBtn.addEventListener('click', stopAllAudio);
    stopBtn.addEventListener('pointerdown', stopAllAudio);
  }

  // -----------------------------
  // Test tone (3030Hz for 9s)
  // -----------------------------
  const testBtn = document.getElementById('testToneBtn');

  function playTestTone() {
    if (testRunning) return;

    // stop generator first
    stopAllAudio();

    const ctx = ensureContext();
    setupAnalyser(ctx);

    testOsc = ctx.createOscillator();
    testGain = ctx.createGain();

    testOsc.type = 'sine';
    testOsc.frequency.value = 3030;

    testGain.gain.setValueAtTime(0, ctx.currentTime);

    testOsc.connect(testGain);

    // visualizer tap
    testGain.connect(analyser);

    testGain.connect(ctx.destination);

    testOsc.start();

    testGain.gain.linearRampToValueAtTime(0.20, ctx.currentTime + 0.08);
    testGain.gain.setValueAtTime(0.20, ctx.currentTime + 8.8);
    testGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 9);

    testOsc.stop(ctx.currentTime + 9);

    testRunning = true;
    document.body.classList.add('active-audio');
    startWaveform();

    testOsc.onended = () => {
      testRunning = false;
      testOsc = null;
      testGain = null;
      document.body.classList.remove('active-audio');
      stopWaveform();
    };
  }

  if (testBtn) testBtn.addEventListener('click', playTestTone);

  // -----------------------------
  // Panic stop = unbreakable
  // -----------------------------
  const panicBtn = document.getElementById('vizStopBtn');
  if (panicBtn) {
    const panicStop = (e) => {
      e?.preventDefault?.();
      stopAllAudio();
      panicBtn.classList.add('warn-pressed');
      setTimeout(() => panicBtn.classList.remove('warn-pressed'), 120);
    };

    panicBtn.addEventListener('click', panicStop);
    panicBtn.addEventListener('pointerdown', panicStop);
  }
});
