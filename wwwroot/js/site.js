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
  let boardSteps = [];
  let boardHasDraw = false;
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

  function rebuildBoardSteps() {
    const steps = [];
    let hasDraw = false;
    const lines = Array.isArray(boardLines) ? boardLines : [];
    for (const raw of lines) {
      const s = String(raw || "").trim();
      if (!s) continue;
      const m = s.match(/^draw\b\s*[:\-]?\s*(.*)$/i);
      if (m) {
        hasDraw = true;
        steps.push({ kind: "draw", command: String(m[1] || "").trim() });
      } else {
        steps.push({ kind: "text", text: s });
      }
    }
    boardSteps = steps;
    boardHasDraw = hasDraw;
  }

  rebuildBoardSteps();

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
      const steps = Array.isArray(boardSteps) ? boardSteps : [];
      const timings = (Array.isArray(boardTimings) && boardTimings.length === steps.length)
        ? boardTimings
        : evenTimings(steps.length);
      const total = steps.length;
      let activeLine = -1;
      for (let i = 0; i < total; i++) {
        if (progress >= timings[i]) activeLine = i;
      }

      const textPad = 22;
      const inner = {
        x: board.x + textPad,
        y: board.y + textPad,
        w: board.w - textPad * 2,
        h: board.h - textPad * 2
      };

      const gap = 18;
      const textArea = boardHasDraw
        ? { x: inner.x, y: inner.y, w: Math.floor(inner.w * 0.58), h: inner.h }
        : { x: inner.x, y: inner.y, w: inner.w, h: inner.h };
      const diagramArea = boardHasDraw
        ? { x: inner.x + textArea.w + gap, y: inner.y, w: inner.w - textArea.w - gap, h: inner.h }
        : null;

      const x0 = textArea.x;
      let y0 = textArea.y;
      const maxWidth = textArea.w;
      const lineHeight = 30;
      ctx.fillStyle = "#111827";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "22px 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";

      function drawLine(text, isPartial) {
        if (y0 > textArea.y + textArea.h - lineHeight) return;
        ctx.fillText(text, x0, y0, maxWidth);
        if (!isPartial) y0 += lineHeight;
      }

      let penX = null;
      let penY = null;

      function normalizeDrawText(raw) {
        return String(raw || "")
          .replace(/\u00A0/g, " ")
          .replace(/[−–—]/g, "-")
          .replace(/[×]/g, "*");
      }

      function parseNumeric(raw) {
        let s = normalizeDrawText(raw).trim();
        if (!s) return null;
        s = s.replace(/^[=:\s]+/, "").replace(/[,\s;]+$/, "");
        if (!s) return null;
        if (s.endsWith("%")) {
          const v = parseNumeric(s.slice(0, -1));
          return (v === null) ? null : v / 100;
        }
        const slash = s.indexOf("/");
        if (slash > 0 && slash < s.length - 1) {
          const a = parseFloat(s.slice(0, slash));
          const b = parseFloat(s.slice(slash + 1));
          if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b;
        }
        const v = parseFloat(s);
        return Number.isFinite(v) ? v : null;
      }

      function parseRange(raw) {
        const s = normalizeDrawText(raw).trim();
        if (!s) return null;

        const dotdot = s.match(/([^\s]+)\s*\.\.\s*([^\s]+)/);
        if (dotdot) {
          const a = parseNumeric(dotdot[1]);
          const b = parseNumeric(dotdot[2]);
          if (a === null || b === null || a === b) return null;
          return { min: Math.min(a, b), max: Math.max(a, b) };
        }

        const fromTo = s.match(/from\s+([^\s]+)\s+to\s+([^\s]+)/i);
        if (fromTo) {
          const a = parseNumeric(fromTo[1]);
          const b = parseNumeric(fromTo[2]);
          if (a === null || b === null || a === b) return null;
          return { min: Math.min(a, b), max: Math.max(a, b) };
        }

        return null;
      }

      function parsePoint(raw) {
        const s = normalizeDrawText(raw);

        const m = s.match(/\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/);
        if (m) {
          const x = parseNumeric(m[1]);
          const y = parseNumeric(m[2]);
          if (x === null || y === null) return null;
          return { x, y };
        }

        const mx = s.match(/\bx\s*[:=]\s*([^\s,;]+)/i);
        const my = s.match(/\by\s*[:=]\s*([^\s,;]+)/i);
        if (mx && my) {
          const x = parseNumeric(mx[1]);
          const y = parseNumeric(my[1]);
          if (x === null || y === null) return null;
          return { x, y };
        }

        const m2 = s.trim().match(/^([^\s,;]+)[,\s]+([^\s,;]+)/);
        if (m2) {
          const x = parseNumeric(m2[1]);
          const y = parseNumeric(m2[2]);
          if (x === null || y === null) return null;
          return { x, y };
        }

        return null;
      }

      function parseLineExpr(raw) {
        let s0 = normalizeDrawText(raw).trim();
        if (!s0) return null;
        s0 = s0.replace(/\s+/g, "");

        const lower0 = s0.toLowerCase();
        const idxY = lower0.indexOf("y=");
        const idxX = lower0.indexOf("x=");
        if (idxY > 0 && (idxX < 0 || idxY < idxX)) s0 = s0.substring(idxY);
        else if (idxX > 0) s0 = s0.substring(idxX);

        // Strip trailing commentary like "(slope...)" or punctuation.
        s0 = s0.replace(/[^0-9a-zA-Z+\-./=*]/g, "");

        const s = s0.toLowerCase();
        if (!s) return null;

        if (s.startsWith("y=")) {
          const rhs = s.slice(2);
          if (!rhs) return null;
          if (rhs.includes("x")) {
            const parts = rhs.split("x");
            const coefPart = parts[0] || "";
            const constPart = parts.length > 1 ? (parts[1] || "") : "";
            let m = null;
            if (coefPart === "" || coefPart === "+") m = 1;
            else if (coefPart === "-") m = -1;
            else m = parseNumeric(coefPart);
            if (m === null) return null;
            let b = 0;
            if (constPart) {
              const parsedB = parseNumeric(constPart);
              if (parsedB !== null) b = parsedB;
            }
            return { kind: "slopeIntercept", m, b };
          }
          const c = parseNumeric(rhs);
          if (c === null) return null;
          return { kind: "slopeIntercept", m: 0, b: c };
        }
        if (s.startsWith("x=")) {
          const x = parseNumeric(s.slice(2));
          if (x === null) return null;
          return { kind: "vertical", x };
        }

        // Support simple general form like "2x+y=11" or "2x-y=4".
        if (s.includes("=") && s.includes("x") && s.includes("y")) {
          const parts = s.split("=");
          if (parts.length === 2) {
            const parseSide = (expr) => {
              const terms = String(expr || "").match(/[+\-]?[^+\-]+/g) || [];
              let xCoef = 0;
              let yCoef = 0;
              let cst = 0;
              for (const rawTerm of terms) {
                let t = String(rawTerm || "").trim();
                if (!t) continue;
                t = t.replace(/\*/g, "");
                if (t.endsWith("x")) {
                  const coefPart = t.slice(0, -1);
                  let coef = null;
                  if (coefPart === "" || coefPart === "+") coef = 1;
                  else if (coefPart === "-") coef = -1;
                  else coef = parseNumeric(coefPart);
                  if (coef !== null) xCoef += coef;
                } else if (t.endsWith("y")) {
                  const coefPart = t.slice(0, -1);
                  let coef = null;
                  if (coefPart === "" || coefPart === "+") coef = 1;
                  else if (coefPart === "-") coef = -1;
                  else coef = parseNumeric(coefPart);
                  if (coef !== null) yCoef += coef;
                } else {
                  const v = parseNumeric(t);
                  if (v !== null) cst += v;
                }
              }
              return { xCoef, yCoef, cst };
            };

            const left = parseSide(parts[0]);
            const right = parseSide(parts[1]);
            const xCoef = left.xCoef - right.xCoef;
            const yCoef = left.yCoef - right.yCoef;
            const cst = left.cst - right.cst;

            if (Math.abs(yCoef) > 1e-9) {
              return { kind: "slopeIntercept", m: -(xCoef / yCoef), b: -(cst / yCoef) };
            }
            if (Math.abs(xCoef) > 1e-9) {
              return { kind: "vertical", x: -(cst / xCoef) };
            }
          }
        }
        return null;
      }

      function renderCartesianAxes(c, area, axes) {
        const pad = 18;
        const xmin = axes.xmin;
        const xmax = axes.xmax;
        const ymin = axes.ymin;
        const ymax = axes.ymax;
        const iw = Math.max(10, area.w - pad * 2);
        const ih = Math.max(10, area.h - pad * 2);

        const mapX = (x) => area.x + pad + ((x - xmin) / (xmax - xmin)) * iw;
        const mapY = (y) => area.y + area.h - pad - ((y - ymin) / (ymax - ymin)) * ih;

        const niceStep = (span) => {
          const s = Math.abs(span);
          if (s <= 6) return 1;
          if (s <= 12) return 2;
          if (s <= 30) return 5;
          return 10;
        };

        const xStep = niceStep(xmax - xmin);
        const yStep = niceStep(ymax - ymin);

        c.save();
        c.lineWidth = 1;
        c.strokeStyle = "rgba(17,24,39,0.08)";
        c.beginPath();
        for (let x = Math.ceil(xmin / xStep) * xStep; x <= xmax; x += xStep) {
          const px = mapX(x);
          c.moveTo(px, area.y + 10);
          c.lineTo(px, area.y + area.h - 10);
        }
        for (let y = Math.ceil(ymin / yStep) * yStep; y <= ymax; y += yStep) {
          const py = mapY(y);
          c.moveTo(area.x + 10, py);
          c.lineTo(area.x + area.w - 10, py);
        }
        c.stroke();

        const xAxisY = (ymin <= 0 && ymax >= 0) ? mapY(0) : mapY(ymin);
        const yAxisX = (xmin <= 0 && xmax >= 0) ? mapX(0) : mapX(xmin);

        c.lineWidth = 2.5;
        c.strokeStyle = "rgba(17,24,39,0.55)";
        c.beginPath();
        c.moveTo(area.x + 10, xAxisY);
        c.lineTo(area.x + area.w - 10, xAxisY);
        c.moveTo(yAxisX, area.y + 10);
        c.lineTo(yAxisX, area.y + area.h - 10);
        c.stroke();

        c.fillStyle = "rgba(17,24,39,0.70)";
        c.font = "16px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
        c.textAlign = "right";
        c.textBaseline = "top";
        c.fillText("x", area.x + area.w - 12, xAxisY + 6);
        c.textAlign = "left";
        c.textBaseline = "top";
        c.fillText("y", yAxisX + 6, area.y + 12);
        c.restore();

        return { mapX, mapY };
      }

      function renderDiagram(c, area, stepsArr, activeIdx, activeT) {
        if (!area) return { penX: null, penY: null };

        const bgPad = 10;
        const bg = { x: area.x - bgPad, y: area.y - bgPad, w: area.w + bgPad * 2, h: area.h + bgPad * 2 };

        function resetLayer() {
          c.save();
          c.clearRect(bg.x, bg.y, bg.w, bg.h);
          c.fillStyle = "rgba(255,255,255,0.92)";
          roundedRectPath(c, bg.x, bg.y, bg.w, bg.h, 14);
          c.fill();
          c.strokeStyle = "rgba(17,24,39,0.10)";
          c.lineWidth = 2;
          roundedRectPath(c, bg.x, bg.y, bg.w, bg.h, 14);
          c.stroke();
          c.restore();
        }

        resetLayer();

        let mode = "none"; // "none" | "cartesian" | "bar" | "triangle"
        let axes = { xmin: -5, xmax: 5, ymin: -5, ymax: 5 };
        let mapper = null;
        let lastPen = { x: area.x + area.w * 0.5, y: area.y + area.h * 0.45 };
        let barLayout = null;
        let triangleLayout = null;
        let activeFocusUnresolved = false;

        function ensureCartesian() {
          if (mode !== "cartesian") {
            mode = "cartesian";
            resetLayer();
            mapper = renderCartesianAxes(c, area, axes);
          } else if (!mapper) {
            mapper = renderCartesianAxes(c, area, axes);
          }
        }

        function extractAxisRange(cmd, axisChar) {
          const s = normalizeDrawText(cmd);

          const dotdot = s.match(new RegExp(`${axisChar}\\s*[:=]\\s*([^\\s,;]+\\s*\\.\\.\\s*[^\\s,;]+)`, "i"));
          if (dotdot) return parseRange(dotdot[1]);

          const fromTo = s.match(new RegExp(`${axisChar}\\s*[:=]?\\s*from\\s+([^\\s,;]+)\\s+to\\s+([^\\s,;]+)`, "i"));
          if (fromTo) return parseRange(`from ${fromTo[1]} to ${fromTo[2]}`);

          return null;
        }

        function setAxesFromCommand(cmd) {
          const xr = extractAxisRange(cmd, "x");
          if (xr) { axes.xmin = xr.min; axes.xmax = xr.max; }
          const yr = extractAxisRange(cmd, "y");
          if (yr) { axes.ymin = yr.min; axes.ymax = yr.max; }
        }

        function drawLineElement(expr, t) {
          if (!mapper) return;
          c.save();
          c.lineCap = "round";
          c.lineJoin = "round";
          c.strokeStyle = "rgba(124,58,237,0.95)";
          c.lineWidth = 4;
          const clampT = Math.max(0, Math.min(1, t));

          if (expr.kind === "vertical") {
            const x = mapper.mapX(expr.x);
            const y1 = area.y + 14;
            const y2 = area.y + area.h - 14;
            const yy = y1 + (y2 - y1) * clampT;
            c.beginPath();
            c.moveTo(x, y1);
            c.lineTo(x, yy);
            c.stroke();
            lastPen = { x, y: yy };
          } else {
            const x1m = axes.xmin;
            const x2m = axes.xmax;
            const y1m = expr.m * x1m + expr.b;
            const y2m = expr.m * x2m + expr.b;
            const x1 = mapper.mapX(x1m);
            const y1 = mapper.mapY(y1m);
            const x2 = mapper.mapX(x2m);
            const y2 = mapper.mapY(y2m);
            const x = x1 + (x2 - x1) * clampT;
            const y = y1 + (y2 - y1) * clampT;
            c.beginPath();
            c.moveTo(x1, y1);
            c.lineTo(x, y);
            c.stroke();
            lastPen = { x, y };
          }
          c.restore();
        }

        function drawPoint(pt, label, t) {
          if (!mapper) return;
          const clampT = Math.max(0, Math.min(1, t));
          const x = mapper.mapX(pt.x);
          const y = mapper.mapY(pt.y);
          c.save();
          c.globalAlpha = 0.2 + 0.8 * clampT;
          c.fillStyle = "rgba(17,24,39,0.92)";
          c.beginPath();
          c.arc(x, y, 6, 0, Math.PI * 2);
          c.fill();
          c.restore();
          lastPen = { x, y };

          if (label) {
            c.save();
            c.globalAlpha = 0.2 + 0.8 * clampT;
            c.fillStyle = "rgba(17,24,39,0.80)";
            c.font = "16px 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
            c.textAlign = "left";
            c.textBaseline = "bottom";
            c.fillText(label, x + 8, y - 6, area.w - 12);
            c.restore();
          }
        }

        function drawBarChart(bars, t) {
          const clampT = Math.max(0, Math.min(1, t));
          mode = "bar";
          resetLayer();

          const pad = 18;
          const innerW = Math.max(10, area.w - pad * 2);
          const innerH = Math.max(10, area.h - pad * 2);
          const x0 = area.x + pad;
          const y0 = area.y + area.h - pad;
          const maxV = Math.max(1e-6, ...bars.map((b) => Math.abs(b.value)));

          c.save();
          c.strokeStyle = "rgba(17,24,39,0.55)";
          c.lineWidth = 2.5;
          c.beginPath();
          c.moveTo(x0, y0);
          c.lineTo(x0 + innerW, y0);
          c.stroke();

          const n = bars.length;
          const gapPx = Math.max(8, Math.floor(innerW * 0.04));
          const barW = n > 0 ? Math.max(10, Math.floor((innerW - gapPx * (n - 1)) / n)) : innerW;

          barLayout = { bars: [] };
          for (let i = 0; i < n; i++) {
            const b = bars[i];
            const h = (Math.abs(b.value) / maxV) * (innerH - 38) * clampT;
            const x = x0 + i * (barW + gapPx);
            const y = y0 - h;
            barLayout.bars.push({ label: String(b.label || ""), x, y, w: barW, h });
            c.fillStyle = "rgba(124,58,237,0.55)";
            roundedRectPath(c, x, y, barW, h, 10);
            c.fill();
            c.fillStyle = "rgba(17,24,39,0.82)";
            c.font = "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
            c.textAlign = "center";
            c.textBaseline = "top";
            c.fillText(b.label, x + barW / 2, y0 + 8, barW + 8);
            lastPen = { x: x + barW / 2, y };
          }

          c.restore();
        }

        function drawRightTriangle(a, b, labels, t) {
          const clampT = Math.max(0, Math.min(1, t));
          mode = "triangle";
          resetLayer();

          const pad = 22;
          const maxW = area.w - pad * 2;
          const maxH = area.h - pad * 2;
          const scale = Math.max(1e-6, Math.min(maxW / a, maxH / b) * 0.82);
          const x0 = area.x + pad;
          const y0 = area.y + area.h - pad;

          const p0 = { x: x0, y: y0 };
          const p1 = { x: x0 + a * scale, y: y0 };
          const p2 = { x: x0 + a * scale, y: y0 - b * scale };
          triangleLayout = { p0, p1, p2 };

          const seg = (from, to, tt) => {
            const x = from.x + (to.x - from.x) * tt;
            const y = from.y + (to.y - from.y) * tt;
            c.beginPath();
            c.moveTo(from.x, from.y);
            c.lineTo(x, y);
            c.stroke();
            lastPen = { x, y };
          };

          c.save();
          c.strokeStyle = "rgba(124,58,237,0.95)";
          c.lineWidth = 4;
          c.lineCap = "round";
          c.lineJoin = "round";

          if (clampT < 1 / 3) {
            seg(p0, p1, clampT * 3);
          } else if (clampT < 2 / 3) {
            seg(p0, p1, 1);
            seg(p1, p2, (clampT - 1 / 3) * 3);
          } else {
            seg(p0, p1, 1);
            seg(p1, p2, 1);
            seg(p2, p0, (clampT - 2 / 3) * 3);
          }

          c.restore();

          if (clampT > 0.9) {
            const baseLabel = (labels && labels.base) ? String(labels.base) : String(a);
            const heightLabel = (labels && labels.height) ? String(labels.height) : String(b);
            const hypLabel = (labels && labels.hyp) ? String(labels.hyp) : null;
            c.save();
            c.fillStyle = "rgba(17,24,39,0.78)";
            c.font = "16px 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
            c.textAlign = "center";
            c.textBaseline = "middle";
            c.fillText(baseLabel, (p0.x + p1.x) / 2, p0.y + 14, maxW);
            c.fillText(heightLabel, p1.x + 14, (p1.y + p2.y) / 2, maxW);
            if (hypLabel) c.fillText(hypLabel, (p0.x + p2.x) / 2 - 6, (p0.y + p2.y) / 2 - 10, maxW);
            c.restore();
          }
        }

        function drawFocusRing(x, y, strength) {
          const t = Math.max(0, Math.min(1, strength));
          const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 180);
          const r = 12 + 10 * pulse;
          c.save();
          c.globalAlpha = 0.25 + 0.75 * t;
          c.strokeStyle = "rgba(34,197,94,0.95)";
          c.lineWidth = 4;
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.stroke();
          c.fillStyle = "rgba(34,197,94,0.20)";
          c.beginPath();
          c.arc(x, y, Math.max(6, r * 0.45), 0, Math.PI * 2);
          c.fill();
          c.restore();
        }

        function focusBar(label, strength) {
          if (!barLayout || !Array.isArray(barLayout.bars) || barLayout.bars.length === 0) return false;
          const q = String(label || "").trim().toLowerCase();
          if (!q) return false;

          const found = barLayout.bars.find((b) => String(b.label || "").trim().toLowerCase() === q)
            || barLayout.bars.find((b) => String(b.label || "").trim().toLowerCase().includes(q));
          if (!found) return false;

          const cx = found.x + found.w / 2;
          const cy = found.y;
          c.save();
          c.globalAlpha = 0.25 + 0.75 * Math.max(0, Math.min(1, strength));
          c.strokeStyle = "rgba(34,197,94,0.95)";
          c.lineWidth = 4;
          roundedRectPath(c, found.x - 4, found.y - 4, found.w + 8, found.h + 8, 12);
          c.stroke();
          c.restore();
          drawFocusRing(cx, cy, strength);
          lastPen = { x: cx, y: cy };
          return true;
        }

        function focusTriangle(which, strength) {
          if (!triangleLayout) return false;
          const w = String(which || "").trim().toLowerCase();
          const p0 = triangleLayout.p0;
          const p1 = triangleLayout.p1;
          const p2 = triangleLayout.p2;

          if (w.includes("angle") || w.includes("corner") || w.includes("box") || w.includes("square")) {
            const x = p1.x;
            const y = p1.y;

            c.save();
            c.globalAlpha = 0.25 + 0.75 * Math.max(0, Math.min(1, strength));
            c.strokeStyle = "rgba(34,197,94,0.95)";
            c.lineWidth = 4;
            c.beginPath();
            const s = 16;
            c.moveTo(x, y);
            c.lineTo(x - s, y);
            c.lineTo(x - s, y - s);
            c.lineTo(x, y - s);
            c.stroke();
            c.restore();

            drawFocusRing(x, y, strength);
            lastPen = { x, y };
            return true;
          }

          let a = p2;
          let b = p0;
          if (w.includes("base") || w === "a" || w.includes("leg a") || w.includes("leg1")) { a = p0; b = p1; }
          else if (w.includes("height") || w === "b" || w.includes("leg b") || w.includes("leg2")) { a = p1; b = p2; }
          else if (w.includes("hyp") || w === "c" || w.includes("hypotenuse")) { a = p2; b = p0; }

          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;

          c.save();
          c.globalAlpha = 0.25 + 0.75 * Math.max(0, Math.min(1, strength));
          c.strokeStyle = "rgba(34,197,94,0.95)";
          c.lineWidth = 7;
          c.lineCap = "round";
          c.beginPath();
          c.moveTo(a.x, a.y);
          c.lineTo(b.x, b.y);
          c.stroke();
          c.restore();

          drawFocusRing(mx, my, strength);
          lastPen = { x: mx, y: my };
          return true;
        }

        for (let i = 0; i <= activeIdx && i < stepsArr.length; i++) {
          const step = stepsArr[i];
          if (!step || step.kind !== "draw") continue;

          const progressT = (i === activeIdx && step.kind === "draw") ? activeT : 1;
          const cmd = normalizeDrawText(step.command).trim();
          if (!cmd) continue;

          const parts = cmd.split(/\s+/).filter(Boolean);
          const op = (parts.length > 0 ? parts[0] : "").toLowerCase().replace(/[^a-z]/g, "");
          const rest = parts.slice(1).join(" ");

          if (op === "focus" || op === "highlight" || op === "pointat") {
            if (i !== activeIdx) continue;

            const strength = progressT;
            const restNorm = normalizeDrawText(rest).trim();
            const lower = restNorm.toLowerCase();
            let resolved = false;

            if (mode === "bar") {
              const label = lower.startsWith("bar ") ? restNorm.slice(4).trim() : restNorm;
              if (focusBar(label, strength)) { resolved = true; continue; }
            }

            if (mode === "triangle") {
              const which = lower.replace(/^triangle\s+/, "").trim();
              if (focusTriangle(which || "hyp", strength)) { resolved = true; continue; }
            }

            if (mode === "cartesian" && mapper) {
              const cleaned = restNorm.replace(/^point\s+/i, "");
              const pt = parsePoint(cleaned);
              if (pt) {
                // Ensure there's something visible where we're pointing.
                drawPoint(pt, null, Math.max(0.6, Math.min(1, strength)));

                const x = mapper.mapX(pt.x);
                const y = mapper.mapY(pt.y);
                drawFocusRing(x, y, strength);
                lastPen = { x, y };
                resolved = true;
                continue;
              }

              const expr = parseLineExpr(restNorm);
              if (expr && expr.kind === "slopeIntercept") {
                // Draw a little of the line so the focus isn't "empty".
                drawLineElement(expr, Math.max(0.4, Math.min(1, strength)));

                const px = mapper.mapX(0);
                const py = mapper.mapY(expr.b);
                drawFocusRing(px, py, strength);
                lastPen = { x: px, y: py };
                resolved = true;
                continue;
              }
            }

            if (!resolved) {
              // If we can't resolve what to focus, don't point at "nothing".
              activeFocusUnresolved = true;
            }
            continue;
          }

          if (op === "clear" || op === "reset") {
            mode = "none";
            mapper = null;
            axes = { xmin: -5, xmax: 5, ymin: -5, ymax: 5 };
            resetLayer();
            continue;
          }

          if (op === "axes" || op === "axis" || op === "grid" || op === "plane" || op === "coordinate") {
            mode = "cartesian";
            setAxesFromCommand(rest);
            resetLayer();
            mapper = renderCartesianAxes(c, area, axes);
            lastPen = { x: area.x + area.w * 0.5, y: area.y + area.h * 0.5 };
            continue;
          }

          if (op === "line" || op === "graph" || op === "plot" || op === "sketch") {
            ensureCartesian();
            const expr = parseLineExpr(rest);
            if (expr) drawLineElement(expr, progressT);
            continue;
          }

          if (op === "point" || op === "dot") {
            ensureCartesian();
            const pt = parsePoint(rest);
            const labelMatch = normalizeDrawText(rest).match(/label\s*[:=]\s*(.+)$/i);
            const label = labelMatch ? String(labelMatch[1] || "").trim().replace(/^\"|\"$/g, "") : null;
            if (pt) drawPoint(pt, label, progressT);
            continue;
          }

          if (op === "bar" || op === "bars") {
            const tokens = rest.split(/\s+/).filter(Boolean);
            const bars = [];
            for (const t of tokens) {
              const eq = t.includes("=") ? t.indexOf("=") : t.indexOf(":");
              if (eq <= 0) continue;
              const label = t.slice(0, eq).trim();
              const valueRaw = t.slice(eq + 1).trim();
              const value = parseNumeric(valueRaw);
              if (!label || value === null) continue;
              bars.push({ label, value });
            }
            if (bars.length > 0) drawBarChart(bars, progressT);
            continue;
          }

          if (op === "triangle") {
            const cleaned = normalizeDrawText(rest).replace(/[;,]/g, " ").replace(/\s+/g, " ").trim();
            const rawTokens = cleaned.split(" ").filter(Boolean);
            const tokens = rawTokens.filter((t) => {
              const k = t.toLowerCase().replace(/[^a-z]/g, "");
              return k !== "right" && k !== "legs" && k !== "leg" && k !== "hypotenuse" && k !== "hyp" && k !== "and" && k !== "with";
            });

            const aNum = tokens.length > 0 ? parseNumeric(tokens[0]) : null;
            const bNum = tokens.length > 1 ? parseNumeric(tokens[1]) : null;
            const hypToken = tokens.length > 2 ? String(tokens[2]) : "";

            const a = (aNum !== null && aNum > 0) ? aNum : 4;
            const b = (bNum !== null && bNum > 0) ? bNum : 3;
            const labels = {
              base: (aNum !== null ? String(aNum) : (tokens[0] ? String(tokens[0]) : "a")),
              height: (bNum !== null ? String(bNum) : (tokens[1] ? String(tokens[1]) : "b")),
              hyp: hypToken ? hypToken : "c"
            };

            drawRightTriangle(a, b, labels, progressT);
            continue;
          }

          // Fallback: try to infer common draw intents from the text.
          const lowerCmd = cmd.toLowerCase();
          if (lowerCmd.includes("..") && (lowerCmd.includes("x") || lowerCmd.includes("y"))) {
            mode = "cartesian";
            setAxesFromCommand(cmd);
            resetLayer();
            mapper = renderCartesianAxes(c, area, axes);
            lastPen = { x: area.x + area.w * 0.5, y: area.y + area.h * 0.5 };
            continue;
          }

          if (lowerCmd.includes("y=") || lowerCmd.includes("x=") || (lowerCmd.includes("=") && lowerCmd.includes("x") && lowerCmd.includes("y"))) {
            ensureCartesian();
            const expr = parseLineExpr(cmd);
            if (expr) drawLineElement(expr, progressT);
            continue;
          }

          if (lowerCmd.includes("(") && lowerCmd.includes(",") && lowerCmd.includes(")")) {
            ensureCartesian();
            const pt = parsePoint(cmd);
            if (pt) drawPoint(pt, null, progressT);
            continue;
          }
        }

        return activeFocusUnresolved ? { penX: null, penY: null } : { penX: lastPen.x, penY: lastPen.y };
      }

      for (let i = 0; i < activeLine && i < total; i++) {
        const step = steps[i];
        if (!step) continue;
        if (step.kind === "text") drawLine(step.text, false);
      }

      let activeLocal = 0;
      let activeStep = null;
      if (activeLine >= 0 && activeLine < total) {
        const startAt = timings[activeLine];
        const endAt = (activeLine + 1 < total) ? timings[activeLine + 1] : 1.0;
        activeLocal = endAt > startAt ? (progress - startAt) / (endAt - startAt) : 1.0;
        activeLocal = Math.max(0, Math.min(1, activeLocal));
        activeStep = steps[activeLine];
        if (activeStep && activeStep.kind === "text") {
          const line = activeStep.text;
          const count = Math.max(0, Math.min(line.length, Math.floor(line.length * activeLocal)));
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
      }

      // Diagram rendering (supports animated drawing while active)
      if (diagramArea) {
        const diagramPen = renderDiagram(ctx, diagramArea, steps, activeLine, activeLocal);
        if (activeStep && activeStep.kind === "draw") {
          penX = diagramPen.penX;
          penY = diagramPen.penY;
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
    rebuildBoardSteps();
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
    rebuildBoardSteps();
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
