async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}"
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (!res.ok) {
    const message = (json && (json.message || json.title)) ? (json.message || json.title) : text;
    throw new Error(message || `Request failed (${res.status})`);
  }

  return json;
}

function wireExplainAndVideoButtons() {
  const root = document.querySelector("[data-attempt-id]");
  if (!root) return;

  const attemptId = root.getAttribute("data-attempt-id");
  const videoOverlay = document.querySelector('[data-loading-overlay="video"]');
  const hideVideoOverlay = () => { if (videoOverlay) videoOverlay.hidden = true; };
  const showVideoOverlay = () => { if (videoOverlay) videoOverlay.hidden = false; };
  hideVideoOverlay();
  window.addEventListener("pageshow", hideVideoOverlay);

  for (const btn of document.querySelectorAll('button[data-action="explain"]')) {
    btn.addEventListener("click", async () => {
      const qid = btn.getAttribute("data-question-id");
      const target = document.getElementById(`explain_${qid}`);
      if (!qid || !attemptId || !target) return;

      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = "Generating…";

      try {
        const data = await postJson(`/api/attempts/${attemptId}/questions/${qid}/explanation`);
        const pre = document.createElement("pre");
        pre.className = "script";
        pre.textContent = data.explanation || "";
        target.innerHTML = "";
        target.appendChild(pre);
      } catch (e) {
        target.textContent = `Error: ${e.message || e}`;
      } finally {
        btn.textContent = oldText;
        btn.disabled = false;
      }
    });
  }

  for (const btn of document.querySelectorAll('button[data-action="make-video"]')) {
    btn.addEventListener("click", async () => {
      const qid = btn.getAttribute("data-question-id");
      if (!qid || !attemptId) return;

      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = "Creating…";
      showVideoOverlay();
      let navigating = false;

      try {
        const data = await postJson(`/api/attempts/${attemptId}/questions/${qid}/video`);
        if (data && data.watchUrl) {
          navigating = true;
          window.location.href = data.watchUrl;
          return;
        }
      } catch (e) {
        alert(e.message || String(e));
      } finally {
        if (!navigating) hideVideoOverlay();
        btn.textContent = oldText;
        btn.disabled = false;
      }
    });
  }
}

function wireFormLoadingOverlays() {
  const overlays = document.querySelectorAll("[data-loading-overlay]");
  if (!overlays.length) return;

  for (const overlay of overlays) {
    const key = overlay.getAttribute("data-loading-overlay");
    if (!key) continue;

    const forms = Array.from(document.querySelectorAll(`form[data-loading="${key}"]`));
    if (forms.length === 0) continue;

    let shown = false;
    let disabled = [];

    function reset() {
      overlay.hidden = true;
      shown = false;
      for (const el of disabled) el.disabled = false;
      disabled = [];
    }

    function show() {
      if (shown) return;
      shown = true;
      overlay.hidden = false;

      for (const form of forms) {
        for (const el of form.querySelectorAll('button[type="submit"], input[type="submit"]')) {
          if (!el.disabled) {
            el.disabled = true;
            disabled.push(el);
          }
        }
      }
    }

    reset();
    for (const form of forms) form.addEventListener("submit", show);
    window.addEventListener("pageshow", reset);
  }
}

function wireSpeechPlayer() {
  const scriptEl = document.getElementById("lesson-script");
  if (!scriptEl) return;
  if (!("speechSynthesis" in window)) return;

  const playBtn = document.getElementById("speech-play");
  const stopBtn = document.getElementById("speech-stop");
  const rate = document.getElementById("speech-rate");
  const rateValue = document.getElementById("speech-rate-value");

  function getRate() {
    const r = parseFloat(rate && rate.value ? rate.value : "1.0");
    return Number.isFinite(r) ? r : 1.0;
  }

  function updateRateLabel() {
    if (rateValue) rateValue.textContent = `${getRate().toFixed(1)}×`;
  }

  function play() {
    const text = (scriptEl.textContent || "").trim();
    if (!text) return;

    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = getRate();
    window.speechSynthesis.speak(u);
  }

  playBtn && playBtn.addEventListener("click", play);
  stopBtn && stopBtn.addEventListener("click", () => window.speechSynthesis.cancel());
  rate && rate.addEventListener("input", updateRateLabel);
  updateRateLabel();
}

function wireAvatarVideoPlayer() {
  const canvas = document.getElementById("avatar-canvas");
  if (!canvas) return;

  const videoId = canvas.getAttribute("data-video-id");
  const avatarUrl = canvas.getAttribute("data-avatar-url");
  const boardEl = document.getElementById("board-lines");
  const timingsEl = document.getElementById("board-timings");
  let boardLines = [];
  let boardTimings = [];
  if (boardEl) {
    try {
      const parsed = JSON.parse(boardEl.textContent || "[]");
      if (Array.isArray(parsed)) {
        boardLines = parsed.map((s) => String(s || "").trim()).filter((s) => s.length > 0);
      }
    } catch { /* ignore */ }
  }
  if (timingsEl) {
    try {
      const parsed = JSON.parse(timingsEl.textContent || "[]");
      if (Array.isArray(parsed)) {
        boardTimings = parsed;
      }
    } catch { /* ignore */ }
  }

  const playBtn = document.getElementById("avatar-play");
  const stopBtn = document.getElementById("avatar-stop");
  const exportBtn = document.getElementById("avatar-export");
  const askBtn = document.getElementById("lesson-ask");
  const understoodBtn = document.getElementById("qa-understood");
  const speed = document.getElementById("avatar-speed");
  const speedValue = document.getElementById("avatar-speed-value");

  const audio = document.getElementById("narration-audio");

  const qaOverlay = document.getElementById("qa-overlay");
  const qaClose = document.getElementById("qa-close");
  const qaContinue = document.getElementById("qa-continue");
  const qaQuestion = document.getElementById("qa-question");
  const qaSubmit = document.getElementById("qa-submit");
  const qaAnswer = document.getElementById("qa-answer");
  const qaError = document.getElementById("qa-error");

  const ctx = canvas.getContext("2d");
  const img = new Image();
  img.decoding = "async";

  let raf = 0;
  let lastLevel = 0;
  let audioCtx = null;
  let analyser = null;
  let analyserData = null;
  let manualPlayStart = 0;
  let manualElapsedSeconds = 0;
  let manualIsPaused = false;
  let manualIsPlaying = false;
  let manualUtterance = null;
  let resumeAfterQa = false;
  let mode = "lesson"; // "lesson" | "qa"
  let lessonBoardLines = [];
  let lessonBoardTimings = [];
  let qaPlayStart = 0;
  let qaElapsedSeconds = 0;
  let qaDurationSeconds = 0;
  let qaIsSpeaking = false;
  let qaUtterance = null;
  let qaAudio = null;
  const scriptEl = document.getElementById("lesson-script");
  const scriptText = (scriptEl && scriptEl.textContent ? scriptEl.textContent : "").trim();
  if (boardLines.length === 0 && scriptText) {
    const rawLines = scriptText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const shortLines = rawLines.filter((l) => l.length <= 56).slice(0, 14);
    if (shortLines.length > 0) {
      boardLines = shortLines;
    } else {
      const sentences = scriptText
        .replace(/\r\n/g, "\n")
        .replace(/[!?]/g, ".")
        .split(".")
        .map((s) => s.trim())
        .filter((s) => s.length >= 12 && s.length <= 56)
        .slice(0, 14);
      if (sentences.length > 0) boardLines = sentences;
    }
  }

  function evenTimings(count) {
    if (count <= 0) return [];
    if (count === 1) return [0.35];
    const start = 0.12;
    const end = 0.92;
    const step = (end - start) / (count - 1);
    const t = [];
    for (let i = 0; i < count; i++) t.push(start + step * i);
    return t;
  }

  function sanitizeTimings(timings, count) {
    if (!Array.isArray(timings) || timings.length !== count) return evenTimings(count);
    const out = [];
    let prev = -1;
    for (const raw of timings) {
      const v = (typeof raw === "number") ? raw : parseFloat(String(raw));
      if (!Number.isFinite(v)) return evenTimings(count);
      const clamped = Math.min(1, Math.max(0, v));
      if (clamped <= prev) return evenTimings(count);
      out.push(clamped);
      prev = clamped;
    }
    return out;
  }

  boardTimings = sanitizeTimings(boardTimings, boardLines.length);
  lessonBoardLines = Array.isArray(boardLines) ? boardLines.slice() : [];
  lessonBoardTimings = Array.isArray(boardTimings) ? boardTimings.slice() : [];

  function estimateDurationSeconds() {
    // Rough estimate for spoken narration when audio duration isn't available.
    const chars = scriptText.length;
    const seconds = chars > 0 ? chars / 13 : 90;
    return Math.max(45, Math.min(300, seconds));
  }

  function roundedRectPath(c, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    if (c.roundRect) {
      c.beginPath();
      c.roundRect(x, y, w, h, radius);
      return;
    }
    c.beginPath();
    c.moveTo(x + radius, y);
    c.lineTo(x + w - radius, y);
    c.quadraticCurveTo(x + w, y, x + w, y + radius);
    c.lineTo(x + w, y + h - radius);
    c.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    c.lineTo(x + radius, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - radius);
    c.lineTo(x, y + radius);
    c.quadraticCurveTo(x, y, x + radius, y);
  }

  function drawImageCover(c, image, x, y, w, h) {
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    if (!iw || !ih) return;
    const scale = Math.max(w / iw, h / ih);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;
    c.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  }

  function getSpeed() {
    const r = parseFloat(speed && speed.value ? speed.value : "1.0");
    return Number.isFinite(r) ? r : 1.0;
  }

  function updateSpeedLabel() {
    if (speedValue) speedValue.textContent = `${getSpeed().toFixed(1)}×`;
    if (audio) audio.playbackRate = getSpeed();
    if (qaAudio) qaAudio.playbackRate = getSpeed();
  }

  function startLoop() {
    if (raf) return;
    const start = performance.now();

    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      const elapsed = (t - start) / 1000;

      let level = 0;
      if (analyser && analyserData) {
        analyser.getByteTimeDomainData(analyserData);
        let sum = 0;
        for (let i = 0; i < analyserData.length; i++) {
          const v = (analyserData[i] - 128) / 128;
          sum += v * v;
        }
        level = Math.min(1, Math.sqrt(sum / analyserData.length) * 2.2);
      }

      // No analyser in QA mode (or audio paused): simulate speech so the avatar "talks".
      if (qaIsSpeaking) {
        level = Math.max(level, 0.18 + Math.abs(Math.sin(elapsed * 10.0)) * 0.35);
      }

      // Smooth transitions so the mouth doesn't jitter.
      lastLevel = lastLevel * 0.85 + level * 0.15;

      const w = canvas.width;
      const h = canvas.height;

      // Background
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "rgba(124, 58, 237, 0.22)");
      grad.addColorStop(1, "rgba(34, 197, 94, 0.14)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const padding = 18;
      const teacher = {
        x: padding,
        y: padding,
        w: Math.floor(w * 0.33),
        h: h - padding * 2
      };
      const board = {
        x: teacher.x + teacher.w + padding,
        y: padding,
        w: w - (teacher.x + teacher.w + padding) - padding,
        h: h - padding * 2
      };

      // Teacher panel
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 20;
      roundedRectPath(ctx, teacher.x, teacher.y, teacher.w, teacher.h, 18);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Draw avatar inside teacher panel with subtle "breathing" motion.
      const breath = Math.sin(elapsed * 1.2) * 1.2;
      const speak = lastLevel * 2.2;
      const innerPad = 10;
      const tx = teacher.x + innerPad;
      const ty = teacher.y + innerPad;
      const tw = teacher.w - innerPad * 2;
      const th = teacher.h - innerPad * 2;

      if (img.complete && img.naturalWidth > 0) {
        ctx.save();
        const scale = 1 + (speak * 0.004);
        const tilt = Math.sin(elapsed * 0.9) * 0.012 + speak * 0.006;
        const swayX = Math.sin(elapsed * 0.8) * 1.8 + speak * 1.2;
        ctx.translate(tx + tw / 2 + swayX, ty + th / 2 + breath);
        ctx.rotate(tilt);
        ctx.scale(scale, scale);
        roundedRectPath(ctx, -tw / 2, -th / 2, tw, th, 14);
        ctx.clip();
        drawImageCover(ctx, img, -tw / 2, -th / 2, tw, th);
        ctx.restore();
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.20)";
        roundedRectPath(ctx, tx, ty, tw, th, 14);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.font = "18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Loading teacher…", tx + tw / 2, ty + th / 2);
      }

      // Whiteboard
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.25)";
      ctx.shadowBlur = 22;
      roundedRectPath(ctx, board.x, board.y, board.w, board.h, 18);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(17,24,39,0.18)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.clip();

      // Subtle grid
      ctx.strokeStyle = "rgba(17,24,39,0.06)";
      ctx.lineWidth = 1;
      const grid = 34;
      for (let x = board.x + grid; x < board.x + board.w; x += grid) {
        ctx.beginPath();
        ctx.moveTo(x, board.y);
        ctx.lineTo(x, board.y + board.h);
        ctx.stroke();
      }
      for (let y = board.y + grid; y < board.y + board.h; y += grid) {
        ctx.beginPath();
        ctx.moveTo(board.x, y);
        ctx.lineTo(board.x + board.w, y);
        ctx.stroke();
      }

      // Writing progress
      const est = estimateDurationSeconds();
      let progress = 0;
      if (mode === "qa") {
        if (qaAudio && Number.isFinite(qaAudio.duration) && qaAudio.duration > 0) {
          const cur = Number.isFinite(qaAudio.currentTime) ? qaAudio.currentTime : 0;
          const dur = qaAudio.duration;
          progress = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
        } else {
          const seconds = qaElapsedSeconds + (qaPlayStart > 0 ? (t - qaPlayStart) / 1000 : 0);
          const dur = qaDurationSeconds > 0 ? qaDurationSeconds : 30;
          progress = dur > 0 ? Math.min(1, Math.max(0, seconds / dur)) : 0;
        }
      } else if (audio) {
        const cur = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const dur = (Number.isFinite(audio.duration) && audio.duration > 0) ? audio.duration : est;
        progress = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
      } else {
        const seconds = manualElapsedSeconds + (manualPlayStart > 0 ? (t - manualPlayStart) / 1000 : 0);
        progress = est > 0 ? Math.min(1, Math.max(0, seconds / est)) : 0;
      }

      const lines = Array.isArray(boardLines) ? boardLines : [];
      const timings = (Array.isArray(boardTimings) && boardTimings.length === lines.length)
        ? boardTimings
        : evenTimings(lines.length);
      const total = lines.length;
      let activeLine = -1;
      for (let i = 0; i < total; i++) {
        if (progress >= timings[i]) activeLine = i;
      }

      const textPad = 22;
      const x0 = board.x + textPad;
      let y0 = board.y + textPad;
      const maxWidth = board.w - textPad * 2;
      const lineHeight = 30;
      ctx.fillStyle = "#111827";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "22px 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";

      function drawLine(text, isPartial) {
        if (y0 > board.y + board.h - textPad - lineHeight) return;
        ctx.fillText(text, x0, y0, maxWidth);
        if (!isPartial) y0 += lineHeight;
      }

      let penX = null;
      let penY = null;

      for (let i = 0; i < activeLine && i < total; i++) drawLine(lines[i], false);

      if (activeLine >= 0 && activeLine < total) {
        const startAt = timings[activeLine];
        const endAt = (activeLine + 1 < total) ? timings[activeLine + 1] : 1.0;
        const local = endAt > startAt ? (progress - startAt) / (endAt - startAt) : 1.0;
        const line = lines[activeLine];
        const count = Math.max(0, Math.min(line.length, Math.floor(line.length * Math.max(0, Math.min(1, local)))));
        const partialText = count > 0 ? line.substring(0, count) : "";
        drawLine(partialText, true);

        // Cursor
        if (partialText.length > 0) {
          const metrics = ctx.measureText(partialText);
          const cx = x0 + Math.min(metrics.width, maxWidth - 4);
          const cy = y0;
          ctx.fillStyle = "rgba(124,58,237,0.9)";
          ctx.fillRect(cx, cy + 4, 6, 22);
          ctx.fillStyle = "#111827";
          penX = cx;
          penY = cy + 16;
        }
      }

      ctx.restore();

      // "Body language": point to the line being written.
      if (penX !== null && penY !== null) {
        const handX = teacher.x + teacher.w - 26;
        const handY = teacher.y + teacher.h * 0.72;
        const wiggle = Math.sin(elapsed * 6.0) * 1.8;
        const hx = handX + wiggle;
        const hy = handY - speak * 2.5;

        ctx.save();
        ctx.lineCap = "round";

        // Shadow
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(penX, penY);
        ctx.stroke();

        // Pointer line
        ctx.strokeStyle = "rgba(17,24,39,0.62)";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(penX, penY);
        ctx.stroke();

        // Marker tip
        ctx.fillStyle = "rgba(124,58,237,0.95)";
        ctx.beginPath();
        ctx.ellipse(penX, penY, 10, 6, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }

      // Watermark (AI-generated)
      ctx.fillStyle = "rgba(255,255,255,0.70)";
      ctx.font = "13px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("AI-generated teacher + whiteboard", 16, h - 16);
    };

    raf = requestAnimationFrame(draw);
  }

  function stopLoop() {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  async function ensureAnalyser() {
    if (!audio) return;
    if (audioCtx && analyser) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyserData = new Uint8Array(analyser.fftSize);

    const source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
  }

  async function play() {
    if (mode === "qa") return;
    updateSpeedLabel();
    startLoop();

    if (audio) {
      await ensureAnalyser();
      if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
      await audio.play();
      return;
    }

    if (!("speechSynthesis" in window)) return;
    const text = scriptText || "";
    if (!text) return;

    window.speechSynthesis.cancel();
    manualElapsedSeconds = 0;
    manualPlayStart = performance.now();
    manualIsPaused = false;
    manualIsPlaying = true;
    manualUtterance = new SpeechSynthesisUtterance(text);
    manualUtterance.rate = getSpeed();
    manualUtterance.onend = () => {
      manualElapsedSeconds = estimateDurationSeconds();
      manualIsPlaying = false;
      manualIsPaused = false;
      manualPlayStart = 0;
    };
    window.speechSynthesis.speak(manualUtterance);
  }

  function stop() {
    if (mode === "qa" || qaIsSpeaking) {
      resumeAfterQa = false;
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      finishQa({ resumeLessonAfter: false });
    }

    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    } else if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      manualIsPlaying = false;
      manualPlayStart = 0;
      manualElapsedSeconds = 0;
      manualIsPaused = false;
      manualUtterance = null;
    }
    stopLoop();
  }

  function progressFractionNow() {
    const est = estimateDurationSeconds();
    if (audio) {
      const cur = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const dur = (Number.isFinite(audio.duration) && audio.duration > 0) ? audio.duration : est;
      return dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
    }

    const seconds = manualElapsedSeconds + (manualPlayStart > 0 ? (performance.now() - manualPlayStart) / 1000 : 0);
    return est > 0 ? Math.min(1, Math.max(0, seconds / est)) : 0;
  }

  function lessonIsPlaying() {
    if (audio) return !audio.paused && !audio.ended;
    return manualIsPlaying && !manualIsPaused;
  }

  function pauseLesson() {
    if (audio) {
      if (!audio.paused) audio.pause();
      return;
    }

    if ("speechSynthesis" in window) {
      if (manualIsPlaying && !manualIsPaused) {
        if (manualPlayStart > 0) {
          manualElapsedSeconds += (performance.now() - manualPlayStart) / 1000;
          manualPlayStart = 0;
        }
        manualIsPaused = true;
        try { window.speechSynthesis.pause(); } catch { /* ignore */ }
      }
    }
  }

  async function resumeLesson() {
    if (audio) {
      if (audio.paused && !audio.ended) {
        try { await audio.play(); } catch { /* ignore */ }
      }
      return;
    }

    if ("speechSynthesis" in window) {
      if (manualIsPlaying && manualIsPaused) {
        manualPlayStart = performance.now();
        manualIsPaused = false;
        try { window.speechSynthesis.resume(); } catch { /* ignore */ }
      }
    }
  }

  function resetQaUi() {
    if (qaError) {
      qaError.textContent = "";
      qaError.hidden = true;
    }
    if (qaAnswer) {
      qaAnswer.textContent = "";
      qaAnswer.hidden = true;
    }
    if (qaSubmit) {
      qaSubmit.disabled = false;
      qaSubmit.textContent = "Ask";
    }
  }

  function openQa() {
    if (!qaOverlay) return;
    resumeAfterQa = lessonIsPlaying();
    pauseLesson();
    resetQaUi();
    if (qaQuestion) qaQuestion.value = "";
    qaOverlay.hidden = false;
    qaQuestion && qaQuestion.focus();
  }

  function closeQa({ resume } = { resume: true }) {
    if (!qaOverlay) return;
    qaOverlay.hidden = true;
    if (resume && resumeAfterQa) resumeLesson();
  }

  function estimateSpeechSeconds(text, rate) {
    const t = String(text || "").trim();
    if (!t) return 20;
    const chars = t.length;
    const base = chars / 13; // ~13 chars/sec
    const r = Number.isFinite(rate) && rate > 0 ? rate : 1.0;
    return Math.max(12, Math.min(120, base / r));
  }

  function restoreLessonBoard() {
    mode = "lesson";
    boardLines = lessonBoardLines.slice();
    boardTimings = lessonBoardTimings.slice();
  }

  function finishQa({ resumeLessonAfter } = { resumeLessonAfter: true }) {
    if (qaAudio) {
      try { qaAudio.pause(); } catch { /* ignore */ }
      try { qaAudio.currentTime = 0; } catch { /* ignore */ }
      qaAudio = null;
    }
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }

    qaIsSpeaking = false;
    qaPlayStart = 0;
    qaElapsedSeconds = qaDurationSeconds;
    qaDurationSeconds = 0;
    qaUtterance = null;
    understoodBtn && (understoodBtn.hidden = true);

    restoreLessonBoard();
    askBtn && (askBtn.disabled = false);
    playBtn && (playBtn.disabled = false);
    exportBtn && (exportBtn.disabled = false);

    if (resumeLessonAfter && resumeAfterQa) {
      resumeLesson();
    } else if (audio) {
      // Match the old behavior: paused audio means no animation loop.
      stopLoop();
    }
  }

  function startQaSegment(pack) {
    const narration = (pack && pack.narration) ? String(pack.narration || "").trim() : "";
    const audioUrl = (pack && pack.audioUrl) ? String(pack.audioUrl || "").trim() : "";
    let qaLines = Array.isArray(pack && pack.boardLines) ? pack.boardLines : [];
    qaLines = qaLines.map((s) => String(s || "").trim()).filter((s) => s.length > 0);

    if (qaLines.length === 0 && narration) {
      const rawLines = narration.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      qaLines = rawLines.filter((l) => l.length <= 56).slice(0, 12);
    }

    let qaTimings = Array.isArray(pack && pack.boardTimings) ? pack.boardTimings : [];
    qaTimings = sanitizeTimings(qaTimings, qaLines.length);

    boardLines = qaLines;
    boardTimings = qaTimings;
    mode = "qa";
    qaElapsedSeconds = 0;
    qaDurationSeconds = estimateSpeechSeconds(narration, getSpeed());
    qaPlayStart = performance.now();
    qaIsSpeaking = true;

    askBtn && (askBtn.disabled = true);
    playBtn && (playBtn.disabled = true);
    exportBtn && (exportBtn.disabled = true);
    understoodBtn && (understoodBtn.hidden = false);
    startLoop();

    if (qaAudio) {
      try { qaAudio.pause(); } catch { /* ignore */ }
      try { qaAudio.currentTime = 0; } catch { /* ignore */ }
      qaAudio = null;
    }

    if (audioUrl && typeof Audio !== "undefined") {
      qaAudio = new Audio(audioUrl);
      qaAudio.preload = "auto";
      qaAudio.playbackRate = getSpeed();
      qaAudio.addEventListener("loadedmetadata", () => {
        if (qaAudio && Number.isFinite(qaAudio.duration) && qaAudio.duration > 0)
          qaDurationSeconds = qaAudio.duration;
      });
      qaAudio.addEventListener("play", () => { qaIsSpeaking = true; });
      qaAudio.addEventListener("pause", () => { qaIsSpeaking = false; });
      qaAudio.addEventListener("ended", () => finishQa({ resumeLessonAfter: true }));

      qaAudio.play().catch(() => {
        // Autoplay can be blocked; fall back to browser TTS if available.
        if (qaAudio) {
          try { qaAudio.pause(); } catch { /* ignore */ }
          qaAudio = null;
        }
        if (!("speechSynthesis" in window) || !narration) {
          window.setTimeout(() => finishQa({ resumeLessonAfter: true }), Math.ceil(qaDurationSeconds * 1000));
          return;
        }

        if (!audio) {
          // In Stub/manual mode we can't reliably pause the lesson TTS, speak QA, then resume mid-utterance.
          resumeAfterQa = false;
          manualIsPlaying = false;
          manualIsPaused = false;
          manualPlayStart = 0;
          manualUtterance = null;
        }

        try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
        qaUtterance = new SpeechSynthesisUtterance(narration);
        qaUtterance.rate = getSpeed();
        qaUtterance.onend = () => finishQa({ resumeLessonAfter: true });
        qaUtterance.onerror = () => finishQa({ resumeLessonAfter: true });
        window.speechSynthesis.speak(qaUtterance);
      });
      return;
    }

    if (!("speechSynthesis" in window) || !narration) {
      window.setTimeout(() => finishQa({ resumeLessonAfter: true }), Math.ceil(qaDurationSeconds * 1000));
      return;
    }

    if (!audio) {
      // In Stub/manual mode we can't reliably pause the lesson TTS, speak QA, then resume mid-utterance.
      resumeAfterQa = false;
      manualIsPlaying = false;
      manualIsPaused = false;
      manualPlayStart = 0;
      manualUtterance = null;
    }

    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    qaUtterance = new SpeechSynthesisUtterance(narration);
    qaUtterance.rate = getSpeed();
    qaUtterance.onend = () => finishQa({ resumeLessonAfter: true });
    qaUtterance.onerror = () => finishQa({ resumeLessonAfter: true });
    window.speechSynthesis.speak(qaUtterance);
  }

  async function submitQa() {
    if (!videoId) return;
    if (!qaQuestion || !qaSubmit) return;

    const question = (qaQuestion.value || "").trim();
    if (!question) return;

    if (qaError) {
      qaError.textContent = "";
      qaError.hidden = true;
    }
    if (qaAnswer) {
      qaAnswer.textContent = "";
      qaAnswer.hidden = true;
    }

    qaSubmit.disabled = true;
    const oldText = qaSubmit.textContent;
    qaSubmit.textContent = "Asking…";

    try {
      const data = await postJson(`/api/videos/${videoId}/question`, {
        question,
        progress: progressFractionNow()
      });

      closeQa({ resume: false });
      startQaSegment(data);
    } catch (e) {
      if (qaError) {
        qaError.textContent = `Error: ${e.message || e}`;
        qaError.hidden = false;
      }
    } finally {
      qaSubmit.textContent = oldText;
      qaSubmit.disabled = false;
    }
  }

  async function uploadVideoBlob(blob) {
    if (!videoId) throw new Error("Missing video id.");
    const form = new FormData();
    form.append("video", blob, `${videoId}.webm`);

    const res = await fetch(`/api/videos/${videoId}/upload`, { method: "POST", body: form });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

    if (!res.ok) {
      const message = (json && (json.message || json.title)) ? (json.message || json.title) : text;
      throw new Error(message || `Upload failed (${res.status})`);
    }

    return json;
  }

  async function exportVideo() {
    if (!audio) {
      alert("Narration audio is required to save a video file.");
      return;
    }
    if (!canvas.captureStream || !window.MediaRecorder) {
      alert("Your browser doesn't support exporting video from the avatar player. Try Chrome.");
      return;
    }

    const audioStream = audio.captureStream ? audio.captureStream() : (audio.mozCaptureStream ? audio.mozCaptureStream() : null);
    if (!audioStream) {
      alert("Audio capture is not supported in this browser. Try Chrome.");
      return;
    }

    const types = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || "";

    exportBtn.disabled = true;
    const oldText = exportBtn.textContent;
    exportBtn.textContent = "Saving…";

    try {
      await ensureAnalyser();
      if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();

      audio.pause();
      audio.currentTime = 0;
      updateSpeedLabel();
      startLoop();

      const canvasStream = canvas.captureStream(30);
      const stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioStream.getAudioTracks()
      ]);

      const chunks = [];
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

      const done = new Promise((resolve, reject) => {
        recorder.onerror = () => reject(new Error("Recording failed."));
        recorder.onstop = () => resolve();
      });

      audio.onended = () => {
        try { recorder.stop(); } catch { /* ignore */ }
      };

      recorder.start(250);
      await audio.play();
      await done;

      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      const result = await uploadVideoBlob(blob);
      if (result && result.watchUrl) window.location.href = result.watchUrl;
      else window.location.reload();
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      exportBtn.textContent = oldText;
      exportBtn.disabled = false;
    }
  }

  if (avatarUrl) img.src = avatarUrl;
  updateSpeedLabel();

  speed && speed.addEventListener("input", updateSpeedLabel);
  playBtn && playBtn.addEventListener("click", play);
  stopBtn && stopBtn.addEventListener("click", stop);
  exportBtn && exportBtn.addEventListener("click", exportVideo);

  askBtn && askBtn.addEventListener("click", openQa);
  understoodBtn && understoodBtn.addEventListener("click", () => finishQa({ resumeLessonAfter: true }));
  qaClose && qaClose.addEventListener("click", () => closeQa({ resume: true }));
  qaContinue && qaContinue.addEventListener("click", () => closeQa({ resume: true }));
  qaSubmit && qaSubmit.addEventListener("click", submitQa);
  qaQuestion && qaQuestion.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitQa();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && qaOverlay && !qaOverlay.hidden) {
      e.preventDefault();
      closeQa({ resume: true });
    }
  });
  qaOverlay && qaOverlay.addEventListener("click", (e) => {
    if (e.target === qaOverlay) closeQa({ resume: true });
  });

  if (audio) {
    audio.addEventListener("play", () => {
      startLoop();
      ensureAnalyser().then(async () => {
        if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
      }).catch(() => { /* ignore */ });
    });
    audio.addEventListener("pause", stopLoop);
    audio.addEventListener("ended", stopLoop);
  } else {
    // No audio element (Stub mode): still render an idle avatar.
    startLoop();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  wireFormLoadingOverlays();
  wireExplainAndVideoButtons();
  wireSpeechPlayer();
  wireAvatarVideoPlayer();
});
