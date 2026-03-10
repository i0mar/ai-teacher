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
  const boardEl = document.getElementById("board-lines");
  const timingsEl = document.getElementById("board-timings");
  const secondsEl = document.getElementById("board-seconds");
  const timingPlanEl = document.getElementById("board-timing-plan");
  let boardLines = [];
  let boardTimings = [];
  let boardTimestampSeconds = [];
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
  if (secondsEl) {
    try {
      const parsed = JSON.parse(secondsEl.textContent || "[]");
      if (Array.isArray(parsed)) {
        boardTimestampSeconds = parsed;
      }
    } catch { /* ignore */ }
  }

  const playBtn = document.getElementById("avatar-play");
  const stopBtn = document.getElementById("avatar-stop");
  const exportBtn = document.getElementById("avatar-export");
  const askBtn = document.getElementById("lesson-ask");
  const fullscreenBtn = document.getElementById("avatar-fullscreen");
  const qualitySelect = document.getElementById("avatar-quality");
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
  const stage = canvas.closest(".avatar-stage");
  const fullscreenShell = document.getElementById("avatar-shell") || stage;

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
  let manualSpeechProgress = 0;
  let manualSpeechCharIndex = 0;
  let manualHasSpeechBoundary = false;
  let resumeAfterQa = false;
  let mode = "lesson"; // "lesson" | "qa"
  let lessonBoardLines = [];
  let lessonBoardTimings = [];
  let lessonBoardTimestampSeconds = [];
  let lessonStepSyncPlan = [];
  let boardSteps = [];
  let boardHasDraw = false;
  let qaPlayStart = 0;
  let qaElapsedSeconds = 0;
  let qaDurationSeconds = 0;
  let qaIsSpeaking = false;
  let qaUtterance = null;
  let qaAudio = null;
  let qaSpeechProgress = 0;
  let qaSpeechCharIndex = 0;
  let qaHasSpeechBoundary = false;
  let qaNarrationText = "";
  let qaStepSyncPlan = [];
  let stepSyncPlan = [];
  let whiteboardOnly = true;
  let qualityMode = "ultra";
  let renderWidth = 960;
  let renderHeight = 540;
  let renderScale = 1;
  let lessonSpeechTimeline = null;
  let qaSpeechTimeline = null;
  let boardTextViewport = null;
  let boardScrollRows = 0;
  let boardScrollMaxRows = 0;
  let boardScrollbarViewport = null;
  let boardScrollbarDrag = null;
  const scriptEl = document.getElementById("lesson-script");
  const scriptText = (scriptEl && scriptEl.textContent ? scriptEl.textContent : "").trim();
  const hasSpeechSynthesis = ("speechSynthesis" in window);

  function useBoundaryLessonNarration() {
    // If server narration audio exists, make it the single source of truth so
    // browser controls and the custom Play button stay in lockstep.
    return hasSpeechSynthesis && !audio && scriptText.length > 0;
  }

  function useBoundaryQaNarration(narrationText) {
    return hasSpeechSynthesis && String(narrationText || "").trim().length > 0;
  }

  function setWhiteboardOnly() {
    whiteboardOnly = true;
  }

  setWhiteboardOnly();

  function clampBoardScrollRows(next) {
    if (!Number.isFinite(next)) return 0;
    const max = Math.max(0, Math.floor(boardScrollMaxRows));
    return Math.max(0, Math.min(max, Math.round(next)));
  }

  function setBoardScrollRows(next) {
    const clamped = clampBoardScrollRows(next);
    if (clamped === boardScrollRows) return false;
    boardScrollRows = clamped;
    return true;
  }

  function resetBoardScroll() {
    boardScrollRows = 0;
    boardScrollMaxRows = 0;
    boardScrollbarViewport = null;
    boardScrollbarDrag = null;
  }

  function pointerToCanvasPoint(clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function isPointerInBoardTextArea(clientX, clientY) {
    if (!boardTextViewport) return false;
    const point = pointerToCanvasPoint(clientX, clientY);
    if (!point) return false;
    const x = point.x;
    const y = point.y;
    return x >= boardTextViewport.x
      && x <= boardTextViewport.x + boardTextViewport.w
      && y >= boardTextViewport.y
      && y <= boardTextViewport.y + boardTextViewport.h;
  }

  function isPointerInBoardScrollbar(clientX, clientY) {
    if (!boardScrollbarViewport) return false;
    const point = pointerToCanvasPoint(clientX, clientY);
    if (!point) return false;
    return point.x >= boardScrollbarViewport.hitX
      && point.x <= boardScrollbarViewport.hitX + boardScrollbarViewport.hitW
      && point.y >= boardScrollbarViewport.hitY
      && point.y <= boardScrollbarViewport.hitY + boardScrollbarViewport.hitH;
  }

  function setBoardScrollFromScrollbarY(canvasY, grabOffset) {
    if (!boardScrollbarViewport || boardScrollMaxRows <= 0) return false;
    if (!Number.isFinite(canvasY)) return false;

    const trackY = boardScrollbarViewport.trackY;
    const travel = Math.max(1, boardScrollbarViewport.travel);
    const offset = Number.isFinite(grabOffset) ? grabOffset : (boardScrollbarViewport.thumbH / 2);
    const minThumbY = trackY;
    const maxThumbY = trackY + travel;

    let thumbY = canvasY - offset;
    if (thumbY < minThumbY) thumbY = minThumbY;
    if (thumbY > maxThumbY) thumbY = maxThumbY;

    const downRatio = travel > 0 ? (thumbY - trackY) / travel : 0;
    const nextRows = boardScrollMaxRows * (1 - downRatio);
    return setBoardScrollRows(nextRows);
  }

  function clearScrollbarDrag(evt) {
    if (!boardScrollbarDrag) return;
    if (evt && Number.isFinite(evt.pointerId) && evt.pointerId !== boardScrollbarDrag.pointerId) return;

    const activePointerId = boardScrollbarDrag.pointerId;
    boardScrollbarDrag = null;

    if (!Number.isFinite(activePointerId)) return;
    try {
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(activePointerId))
        canvas.releasePointerCapture(activePointerId);
    } catch { /* ignore */ }
  }

  function handleBoardCanvasPointerDown(evt) {
    if (!evt) return;
    const inTextArea = isPointerInBoardTextArea(evt.clientX, evt.clientY);
    const inScrollbar = isPointerInBoardScrollbar(evt.clientX, evt.clientY);
    if (!inTextArea && !inScrollbar) return;

    focusCanvasWithoutPageScroll();
    if (!inScrollbar || !boardScrollbarViewport) return;

    const point = pointerToCanvasPoint(evt.clientX, evt.clientY);
    if (!point) return;

    evt.preventDefault();
    evt.stopPropagation();

    const inThumb = point.x >= boardScrollbarViewport.thumbHitX
      && point.x <= boardScrollbarViewport.thumbHitX + boardScrollbarViewport.thumbHitW
      && point.y >= boardScrollbarViewport.thumbY
      && point.y <= boardScrollbarViewport.thumbY + boardScrollbarViewport.thumbH;

    if (inThumb) {
      boardScrollbarDrag = {
        pointerId: evt.pointerId,
        grabOffset: point.y - boardScrollbarViewport.thumbY
      };
      try { canvas.setPointerCapture(evt.pointerId); } catch { /* ignore */ }
      return;
    }

    if (setBoardScrollFromScrollbarY(point.y, boardScrollbarViewport.thumbH / 2))
      refreshBoardFrame();

    boardScrollbarDrag = {
      pointerId: evt.pointerId,
      grabOffset: boardScrollbarViewport.thumbH / 2
    };
    try { canvas.setPointerCapture(evt.pointerId); } catch { /* ignore */ }
  }

  function handleBoardCanvasPointerMove(evt) {
    if (!evt || !boardScrollbarDrag || evt.pointerId !== boardScrollbarDrag.pointerId) return;
    const point = pointerToCanvasPoint(evt.clientX, evt.clientY);
    if (!point) return;

    evt.preventDefault();
    evt.stopPropagation();

    if (setBoardScrollFromScrollbarY(point.y, boardScrollbarDrag.grabOffset))
      refreshBoardFrame();
  }

  function handleBoardCanvasPointerUp(evt) {
    if (!evt || !boardScrollbarDrag || evt.pointerId !== boardScrollbarDrag.pointerId) return;
    evt.preventDefault();
    evt.stopPropagation();
    clearScrollbarDrag(evt);
  }

  function scrollBoardByWheelDelta(deltaY) {
    if (!Number.isFinite(deltaY) || deltaY === 0 || boardScrollMaxRows <= 0) return false;
    const rows = Math.max(1, Math.round(Math.abs(deltaY) / 44));
    const direction = deltaY < 0 ? 1 : -1;
    return setBoardScrollRows(boardScrollRows + direction * rows);
  }

  function handleBoardCanvasWheel(evt) {
    if (!evt || !isPointerInBoardTextArea(evt.clientX, evt.clientY)) return;
    // Keep wheel scrolling inside the whiteboard area from bubbling to page scroll.
    evt.preventDefault();
    evt.stopPropagation();
    if (scrollBoardByWheelDelta(evt.deltaY)) refreshBoardFrame();
  }

  function handleBoardCanvasKeydown(evt) {
    if (!evt || boardScrollMaxRows <= 0) return;

    const pageRows = Math.max(
      3,
      Math.floor(((boardTextViewport && boardTextViewport.h) || 210) / ((boardTextViewport && boardTextViewport.lineHeight) || 30))
    );

    let next = null;
    switch (evt.key) {
      case "ArrowUp":
        next = boardScrollRows + 1;
        break;
      case "ArrowDown":
        next = boardScrollRows - 1;
        break;
      case "PageUp":
        next = boardScrollRows + pageRows;
        break;
      case "PageDown":
        next = boardScrollRows - pageRows;
        break;
      case "Home":
        next = boardScrollMaxRows;
        break;
      case "End":
        next = 0;
        break;
      default:
        return;
    }

    evt.preventDefault();
    if (setBoardScrollRows(next)) refreshBoardFrame();
  }

  function focusCanvasWithoutPageScroll() {
    if (document.activeElement === canvas) return;
    if (typeof canvas.focus !== "function") return;
    try { canvas.focus({ preventScroll: true }); } catch { canvas.focus(); }
  }

  function readQualityFromUrl() {
    return "ultra";
  }

  function setQualityMode(next, options) {
    qualityMode = "ultra";
    if (qualitySelect) qualitySelect.value = qualityMode;

    ensureCanvasResolution(true);
  }

  function computeRenderScale() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    if (qualityMode === "ultra") return Math.min(4, Math.max(2.5, dpr * 1.8));
    if (qualityMode === "hd") return Math.min(3, Math.max(1.8, dpr * 1.35));
    return Math.min(2.4, Math.max(1, dpr));
  }

  function ensureCanvasResolution(force) {
    const host = stage || canvas;
    const rect = host.getBoundingClientRect();
    const cssW = Math.max(320, Math.round(rect.width || 960));
    const cssH = Math.max(180, Math.round(rect.height || (cssW * 9 / 16)));
    const scale = computeRenderScale();
    const pxW = Math.max(1, Math.min(7680, Math.round(cssW * scale)));
    const pxH = Math.max(1, Math.min(4320, Math.round(cssH * scale)));

    renderWidth = cssW;
    renderHeight = cssH;
    renderScale = scale;

    if (!force && canvas.width === pxW && canvas.height === pxH) return;
    canvas.width = pxW;
    canvas.height = pxH;
  }

  function isPlayerFullscreen() {
    return !!(fullscreenShell && document.fullscreenElement === fullscreenShell);
  }

  function updateFullscreenButtonLabel() {
    if (!fullscreenBtn) return;
    fullscreenBtn.textContent = isPlayerFullscreen() ? "Exit fullscreen" : "Fullscreen board";
  }

  async function toggleBoardFullscreen() {
    if (!fullscreenShell || !fullscreenShell.requestFullscreen) return;
    if (isPlayerFullscreen()) {
      await document.exitFullscreen();
      return;
    }
    try {
      await fullscreenShell.requestFullscreen();
    } catch {
      /* ignore */
    }
  }

  setQualityMode(readQualityFromUrl(), { syncUrl: false });

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

  function sanitizeTimestampSeconds(seconds, count) {
    if (!Array.isArray(seconds) || seconds.length !== count) return [];
    const out = [];
    let prev = -1;
    let max = -1;
    let allWhole = true;
    for (const raw of seconds) {
      const v = (typeof raw === "number") ? raw : parseFloat(String(raw));
      if (!Number.isFinite(v)) return [];
      const clamped = Math.max(0, v);
      if (clamped <= prev) return [];
      if (!Number.isInteger(clamped)) allWhole = false;
      if (clamped > max) max = clamped;
      out.push(clamped);
      prev = clamped;
    }
    const looksAbsolute = max > 1 || (out.length >= 2 && out[0] === 0 && out[out.length - 1] === 1 && allWhole);
    return looksAbsolute ? out : [];
  }

  function resolveTimestampSeconds(seconds, count, durationSeconds) {
    const out = sanitizeTimestampSeconds(seconds, count);
    if (out.length !== count) return [];

    const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
    if (duration <= 0) return out;

    const last = out[out.length - 1];
    if (!Number.isFinite(last) || last <= 0) return [];

    // Keep the last board line starting a little before the audio finishes,
    // so short lessons do not run out of narration before the final writing.
    const holdbackSeconds = Math.min(2.2, Math.max(0.8, duration * 0.08));
    const targetLast = Math.max(0.35, duration - holdbackSeconds);
    if (last <= targetLast) return out;

    const scale = targetLast / last;
    if (!Number.isFinite(scale) || scale <= 0) return [];

    const scaled = [];
    let prev = -0.05;
    for (const raw of out) {
      const adjusted = Math.max(prev + 0.05, Math.max(0, raw * scale));
      scaled.push(adjusted);
      prev = adjusted;
    }

    return scaled;
  }

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

  function clamp01(v) {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  function looksEvenlySpaced(values) {
    if (!Array.isArray(values) || values.length < 3) return true;
    const diffs = [];
    for (let i = 1; i < values.length; i++) diffs.push(values[i] - values[i - 1]);
    const avg = diffs.reduce((sum, d) => sum + d, 0) / diffs.length;
    if (!Number.isFinite(avg) || avg <= 0) return true;
    let spread = 0;
    for (const d of diffs) spread += Math.abs(d - avg);
    return (spread / diffs.length) < 0.02;
  }

  function extractKeywords(text) {
    const stop = new Set([
      "the", "and", "then", "this", "that", "with", "from", "into", "your", "you", "our", "for", "are",
      "was", "were", "have", "has", "had", "let", "lets", "write", "draw", "step", "line", "now", "onto",
      "over", "about", "what", "when", "where", "why", "how", "all", "any", "can", "just", "than", "them"
    ]);
    const out = [];
    const matches = String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    for (const token of matches) {
      if (token.length <= 1 || stop.has(token)) continue;
      out.push(token);
      if (out.length >= 6) break;
    }
    return out;
  }

  function tokenizeNarration(text) {
    const tokens = [];
    const src = String(text || "");
    const re = /[A-Za-z0-9]+/g;
    let m = re.exec(src);
    while (m) {
      tokens.push({ word: m[0].toLowerCase(), index: m.index });
      m = re.exec(src);
    }
    return tokens;
  }

  function createSpeechTimeline(text) {
    const src = String(text || "");
    const n = src.length;
    if (n <= 0) {
      return {
        length: 0,
        progressAtCharIndex() { return 0; },
        charIndexAtProgress() { return 0; }
      };
    }

    const cumulative = new Float64Array(n + 1);
    cumulative[0] = 0;
    for (let i = 0; i < n; i++) {
      const ch = src[i];
      let w = 1.0;

      if (ch === "\n") w = 4.0;
      else if (ch === "." || ch === "!" || ch === "?") w = 3.6;
      else if (ch === "," || ch === ";" || ch === ":") w = 2.2;
      else if (/\s/.test(ch)) w = 0.24;
      else if (/[0-9]/.test(ch)) w = 1.12;
      else if (ch === "(" || ch === ")") w = 0.55;

      cumulative[i + 1] = cumulative[i] + w;
    }

    const total = Math.max(1e-9, cumulative[n]);
    return {
      length: n,
      progressAtCharIndex(charIndex) {
        const idx = Math.max(0, Math.min(n, Math.floor(Number.isFinite(charIndex) ? charIndex : 0)));
        return clamp01(cumulative[idx] / total);
      },
      charIndexAtProgress(progress) {
        const p = clamp01(progress);
        const target = total * p;
        let lo = 0;
        let hi = n;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (cumulative[mid] < target) lo = mid + 1;
          else hi = mid;
        }
        return Math.max(0, Math.min(n, lo));
      }
    };
  }

  function timelineProgressAtChar(timeline, charIndex) {
    if (timeline && typeof timeline.progressAtCharIndex === "function") {
      return timeline.progressAtCharIndex(charIndex);
    }
    const n = (timeline && Number.isFinite(timeline.length) && timeline.length > 0) ? timeline.length : 1;
    return clamp01(charIndex / n);
  }

  function timelineCharAtProgress(timeline, progress) {
    if (timeline && typeof timeline.charIndexAtProgress === "function") {
      return Math.max(0, Math.floor(timeline.charIndexAtProgress(progress)));
    }
    const n = (timeline && Number.isFinite(timeline.length) && timeline.length > 0) ? timeline.length : 1;
    return Math.max(0, Math.min(n, Math.floor(clamp01(progress) * n)));
  }

  function normalizeForSearch(text) {
    const src = String(text || "");
    let normalized = "";
    const sourceMap = [];
    let pendingSpace = false;
    let hasAny = false;

    for (let i = 0; i < src.length; i++) {
      const ch = src[i].toLowerCase();
      if (/[a-z0-9]/.test(ch)) {
        if (pendingSpace && hasAny) {
          normalized += " ";
          sourceMap.push(i);
        }
        normalized += ch;
        sourceMap.push(i);
        pendingSpace = false;
        hasAny = true;
      } else if (hasAny) {
        pendingSpace = true;
      }
    }

    return { normalized, sourceMap };
  }

  function extractSyncKeywords(text) {
    const stop = new Set([
      "the", "and", "then", "this", "that", "with", "from", "into", "your", "you", "our", "for", "are",
      "was", "were", "have", "has", "had", "let", "lets", "write", "draw", "step", "line", "now", "onto",
      "over", "about", "what", "when", "where", "why", "how", "all", "any", "can", "just", "than", "them",
      "to", "of", "in", "on", "at", "by", "be", "as", "is", "it", "we", "us"
    ]);
    const keepSingles = new Set(["x", "y", "a", "b", "c", "m", "n"]);
    const out = [];
    const seen = new Set();
    const matches = String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    for (const token of matches) {
      const isNumber = /[0-9]/.test(token);
      if (!isNumber && token.length <= 1 && !keepSingles.has(token)) continue;
      if (stop.has(token)) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
      if (out.length >= 8) break;
    }
    return out;
  }

  function findTokenIndexFrom(tokens, keyword, from) {
    for (let i = Math.max(0, from || 0); i < tokens.length; i++) {
      if (tokens[i].word === keyword) return i;
    }
    return -1;
  }

  function findKeywordWindow(tokens, keywords, fromTokenIndex) {
    if (!Array.isArray(tokens) || tokens.length === 0) return null;
    if (!Array.isArray(keywords) || keywords.length === 0) return null;

    let first = -1;
    let last = -1;
    let cursor = Math.max(0, fromTokenIndex || 0);
    let foundCount = 0;

    for (const keyword of keywords) {
      const idx = findTokenIndexFrom(tokens, keyword, cursor);
      if (idx < 0) continue;
      if (first < 0) first = idx;
      last = idx;
      cursor = idx + 1;
      foundCount++;
    }

    if (first < 0 || last < 0 || foundCount <= 0) return null;
    const minRequired = keywords.length >= 3 ? 2 : 1;
    if (foundCount < minRequired) return null;

    const start = tokens[first].index;
    const end = tokens[last].index + tokens[last].word.length;
    return {
      startChar: start,
      endChar: end,
      nextTokenCursor: cursor
    };
  }

  function isWriteCueToken(token) {
    const t = String(token || "").toLowerCase();
    return t === "write"
      || t === "writing"
      || t === "board"
      || t === "draw"
      || t === "drawing"
      || t === "graph"
      || t === "plot"
      || t === "sketch";
  }

  function findCueBeforeChar(tokens, targetChar, maxDistanceChars) {
    if (!Array.isArray(tokens) || tokens.length === 0) return -1;
    const target = Math.max(0, Math.floor(Number.isFinite(targetChar) ? targetChar : 0));
    const maxDist = Math.max(12, Math.floor(Number.isFinite(maxDistanceChars) ? maxDistanceChars : 140));
    let best = -1;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok || !Number.isFinite(tok.index)) continue;
      if (tok.index >= target) break;
      if (!isWriteCueToken(tok.word)) continue;
      if ((target - tok.index) > maxDist) continue;
      best = tok.index;
    }
    return best;
  }

  function buildStepSyncPlan(narration, steps, timings, timeline) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    const safeTimings = sanitizeTimings(timings, safeSteps.length);
    if (safeSteps.length === 0) return [];

    const text = String(narration || "");
    const hasNarration = text.trim().length > 0;
    const speechTimeline = timeline || createSpeechTimeline(text);
    const maxChars = Math.max(1, (speechTimeline && Number.isFinite(speechTimeline.length)) ? speechTimeline.length : text.length);
    const tokens = tokenizeNarration(text);
    const normalizedNarration = normalizeForSearch(text);

    let normCursor = 0;
    let tokenCursor = 0;
    let prevStart = 0;
    const drawMinSpanChars = Math.max(10, Math.floor(maxChars * 0.007));
    const drawMaxSpanChars = Math.max(drawMinSpanChars + 2, Math.floor(maxChars * 0.028));
    const plan = [];

    for (let i = 0; i < safeSteps.length; i++) {
      const step = safeSteps[i] || {};
      const startAt = safeTimings[i];
      const endAt = (i + 1 < safeTimings.length) ? safeTimings[i + 1] : 1.0;

      const timingStartChar = timelineCharAtProgress(speechTimeline, startAt);
      const timingEndChar = timelineCharAtProgress(speechTimeline, endAt);
      let startChar = timingStartChar;
      let endChar = timingEndChar;
      let shouldWrite = true;
      let matched = false;

      if (step.kind === "text") {
        const textLine = String(step.text || "").trim();
        if (hasNarration && textLine) {
          const normalizedStep = normalizeForSearch(textLine).normalized;
          if (normalizedStep.length >= 4 && normalizedNarration.normalized.length > 0) {
            const idx = normalizedNarration.normalized.indexOf(normalizedStep, normCursor);
            if (idx >= 0) {
              const startMap = normalizedNarration.sourceMap[idx];
              const endMapIdx = Math.min(normalizedNarration.sourceMap.length - 1, idx + normalizedStep.length - 1);
              const endMap = normalizedNarration.sourceMap[endMapIdx];
              if (Number.isFinite(startMap) && Number.isFinite(endMap)) {
                startChar = startMap;
                endChar = endMap + 1;
                matched = true;
                normCursor = idx + normalizedStep.length;
                while (tokenCursor < tokens.length && tokens[tokenCursor].index < startChar) tokenCursor++;
              }
            }
          }

          if (!matched) {
            const keywords = extractSyncKeywords(textLine);
            const window = findKeywordWindow(tokens, keywords, tokenCursor);
            if (window) {
              startChar = window.startChar;
              endChar = Math.max(window.endChar, startChar + 1);
              tokenCursor = window.nextTokenCursor;
              matched = true;
            }
          }

          if (matched) {
            const cueChar = findCueBeforeChar(tokens, startChar, 180);
            if (cueChar >= 0) startChar = Math.min(startChar, cueChar);
          }
          // Keep essential text steps even when exact phrase matching fails.
          // In that case we fall back to timing-based alignment instead of dropping the line.
          if (!matched) {
            const cueNearTiming = findCueBeforeChar(tokens, startChar, 120);
            if (cueNearTiming >= 0) startChar = cueNearTiming;
          }
        }
      } else if (step.kind === "draw" && hasNarration) {
        const drawKeywords = extractSyncKeywords(step.command);
        const drawWindow = findKeywordWindow(tokens, drawKeywords, tokenCursor);
        if (drawWindow) {
          const cueNearDraw = findCueBeforeChar(tokens, drawWindow.startChar, 42);
          startChar = cueNearDraw >= 0 ? cueNearDraw : drawWindow.startChar;
          endChar = Math.max(drawWindow.endChar, startChar + 1);
          tokenCursor = drawWindow.nextTokenCursor;
          matched = true;
        } else {
          // If we can't match draw details exactly, align to cue words near its planned timing.
          const cueNearTiming = findCueBeforeChar(tokens, startChar, 120);
          if (cueNearTiming >= 0) startChar = cueNearTiming;
        }
      }

      if (!shouldWrite) {
        plan.push({
          startChar: prevStart,
          endChar: prevStart,
          startProgress: timelineProgressAtChar(speechTimeline, prevStart),
          endProgress: timelineProgressAtChar(speechTimeline, prevStart),
          shouldWrite: false,
          matched
        });
        continue;
      }

      startChar = Math.max(0, Math.min(maxChars, Math.floor(startChar)));
      endChar = Math.max(0, Math.min(maxChars, Math.ceil(endChar)));

      // Keep cue/match adjustments near the model-provided timing window.
      const startWindowBefore = step.kind === "draw" ? 18 : 30;
      const startWindowAfter = step.kind === "draw" ? 52 : 72;
      const minStartWindow = Math.max(0, timingStartChar - startWindowBefore);
      const maxStartWindow = Math.min(maxChars, timingStartChar + startWindowAfter);
      if (maxStartWindow >= minStartWindow)
        startChar = Math.max(minStartWindow, Math.min(maxStartWindow, startChar));

      if (startChar <= prevStart) startChar = Math.min(maxChars, prevStart + 1);

      const textLen = step.kind === "text" ? Math.max(1, String(step.text || "").length) : 0;
      const dynamicTextMinSpanChars = Math.max(4, Math.min(22, Math.floor(textLen * 0.45)));
      const dynamicTextMaxSpanChars = Math.max(dynamicTextMinSpanChars + 4, Math.min(54, Math.floor(textLen * 1.8)));
      const minSpan = step.kind === "draw" ? drawMinSpanChars : dynamicTextMinSpanChars;
      if (endChar < startChar + minSpan)
        endChar = startChar + minSpan;

      const endWindowBefore = step.kind === "draw" ? 10 : 16;
      const endWindowAfter = step.kind === "draw" ? 58 : 96;
      const minEndWindow = Math.max(startChar + 1, timingEndChar - endWindowBefore);
      const maxEndWindow = Math.min(maxChars, timingEndChar + endWindowAfter);
      if (maxEndWindow >= minEndWindow)
        endChar = Math.max(minEndWindow, Math.min(maxEndWindow, endChar));

      if (step.kind === "draw" && endChar > startChar + drawMaxSpanChars)
        endChar = startChar + drawMaxSpanChars;
      if (step.kind === "text" && endChar > startChar + dynamicTextMaxSpanChars)
        endChar = startChar + dynamicTextMaxSpanChars;

      if (endChar > maxChars) endChar = maxChars;
      if (endChar <= startChar) endChar = Math.min(maxChars, startChar + 1);
      if (endChar <= startChar) startChar = Math.max(0, endChar - 1);

      prevStart = Math.max(prevStart, startChar);

      plan.push({
        startChar,
        endChar,
        startProgress: timelineProgressAtChar(speechTimeline, startChar),
        endProgress: timelineProgressAtChar(speechTimeline, endChar),
        shouldWrite,
        matched
      });
    }

    return plan;
  }

  function inferTimingsFromNarration(narration, steps, fallbackTimings, timeline) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    if (safeSteps.length === 0) return [];

    const text = String(narration || "");
    if (!text.trim()) return sanitizeTimings(fallbackTimings, safeSteps.length);
    const tokens = tokenizeNarration(text);
    if (tokens.length === 0) return sanitizeTimings(fallbackTimings, safeSteps.length);
    const speechTimeline = timeline || createSpeechTimeline(text);

    const totalChars = Math.max(1, text.length);
    const positions = [];
    let searchStart = 0;
    let fallbackChar = Math.floor(totalChars * 0.07);
    const fallbackGap = Math.max(1, Math.floor((totalChars * 0.88) / Math.max(1, safeSteps.length)));

    const findTokenIndex = (keyword, from) => {
      for (let i = Math.max(0, from); i < tokens.length; i++) {
        if (tokens[i].word === keyword) return i;
      }
      return -1;
    };

    for (let i = 0; i < safeSteps.length; i++) {
      const step = safeSteps[i];
      const raw = step && step.kind === "text" ? step.text : (step && step.command ? step.command : "");
      const keywords = extractKeywords(raw);
      let foundToken = -1;
      for (const keyword of keywords) {
        const idx = findTokenIndex(keyword, searchStart);
        if (idx >= 0) {
          foundToken = idx;
          break;
        }
      }

      let charPos = -1;
      if (foundToken >= 0) {
        charPos = tokens[foundToken].index;
        searchStart = foundToken + 1;
      } else {
        charPos = fallbackChar;
      }

      if (positions.length > 0) {
        const minNext = positions[positions.length - 1] + Math.max(1, Math.floor(totalChars * 0.012));
        if (charPos <= minNext) charPos = minNext;
      }

      fallbackChar = charPos + fallbackGap;
      positions.push(Math.min(totalChars - 1, charPos));
    }

    let inferred = positions.map((p) => timelineProgressAtChar(speechTimeline, p));
    inferred = sanitizeTimings(inferred, safeSteps.length);

    const base = sanitizeTimings(fallbackTimings, safeSteps.length);
    if (base.length !== inferred.length) return inferred;

    const baseIsGeneric = looksEvenlySpaced(base);
    // Keep intentionally authored timings (for example, timestamp-based plans)
    // instead of blending them away with heuristic inference.
    if (!baseIsGeneric) return base;

    const weight = 0.12;
    const blended = inferred.map((v, i) => clamp01(v * (1 - weight) + base[i] * weight));
    return sanitizeTimings(blended, safeSteps.length);
  }

  function buildSpeechSyncedTimings(narration, steps, fallbackTimings, timeline) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    if (safeSteps.length === 0) return [];
    return inferTimingsFromNarration(narration, safeSteps, fallbackTimings, timeline || createSpeechTimeline(narration));
  }

  rebuildBoardSteps();
  lessonSpeechTimeline = createSpeechTimeline(scriptText);
  boardTimings = sanitizeTimings(boardTimings, boardSteps.length);
  boardTimings = buildSpeechSyncedTimings(scriptText, boardSteps, boardTimings, lessonSpeechTimeline);
  const initialLessonTimestampSeconds = resolveTimestampSeconds(boardTimestampSeconds, boardSteps.length, estimateDurationSeconds());
  const hasLessonTimestampSeconds = initialLessonTimestampSeconds.length === boardSteps.length && boardSteps.length > 0;
  lessonStepSyncPlan = hasLessonTimestampSeconds
    ? []
    : buildStepSyncPlan(scriptText, boardSteps, boardTimings, lessonSpeechTimeline);
  stepSyncPlan = lessonStepSyncPlan.slice();
  lessonBoardLines = Array.isArray(boardLines) ? boardLines.slice() : [];
  lessonBoardTimings = Array.isArray(boardTimings) ? boardTimings.slice() : [];
  lessonBoardTimestampSeconds = Array.isArray(boardTimestampSeconds) ? boardTimestampSeconds.slice() : [];
  renderBoardTimingPlan();

  function estimateDurationSeconds() {
    // Rough estimate for spoken narration when audio duration isn't available.
    const chars = scriptText.length;
    const seconds = chars > 0 ? chars / 13 : 90;
    return Math.max(45, Math.min(300, seconds));
  }

  function formatClockTimestamp(totalSeconds) {
    const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = safe % 60;
    if (hours > 0)
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function renderBoardTimingPlan() {
    if (!timingPlanEl) return;

    timingPlanEl.replaceChildren();
    const steps = Array.isArray(boardSteps) ? boardSteps : [];
    if (steps.length === 0) return;

    const timings = sanitizeTimings(boardTimings, steps.length);
    const activeAudio = mode === "qa" ? qaAudio : audio;
    const fallbackDuration = mode === "qa"
      ? (qaDurationSeconds > 0 ? qaDurationSeconds : 30)
      : estimateDurationSeconds();
    const sourceDuration = (activeAudio && Number.isFinite(activeAudio.duration) && activeAudio.duration > 0)
      ? activeAudio.duration
      : fallbackDuration;
    const timestampSeconds = resolveTimestampSeconds(boardTimestampSeconds, steps.length, sourceDuration);
    const hasAbsoluteTimestamps = timestampSeconds.length === steps.length;
    const speedRate = Math.max(0.1, getSpeed());

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) continue;

      const when = hasAbsoluteTimestamps
        ? (timestampSeconds[i] / speedRate)
        : (timings[i] * sourceDuration / speedRate);
      const lineText = step.kind === "draw"
        ? `DRAW: ${String(step.command || "").trim()}`
        : String(step.text || "").trim();

      const li = document.createElement("li");
      const stamp = document.createElement("span");
      stamp.className = "board-timing-stamp";
      stamp.textContent = formatClockTimestamp(when);
      li.appendChild(stamp);

      const lineCode = document.createElement("code");
      lineCode.textContent = lineText;
      li.appendChild(lineCode);

      timingPlanEl.appendChild(li);
    }
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
    const iw = image.naturalWidth || image.videoWidth || image.width;
    const ih = image.naturalHeight || image.videoHeight || image.height;
    if (!iw || !ih) return;
    const crop = getCoverSourceRect(iw, ih, w, h);
    if (!crop) return;
    c.drawImage(image, crop.x, crop.y, crop.w, crop.h, x, y, w, h);
  }

  function getCoverSourceRect(sourceW, sourceH, targetW, targetH) {
    if (!sourceW || !sourceH || !targetW || !targetH) return null;
    const scale = Math.max(targetW / sourceW, targetH / sourceH);
    const cropW = targetW / scale;
    const cropH = targetH / scale;
    return {
      x: (sourceW - cropW) / 2,
      y: (sourceH - cropH) / 2,
      w: cropW,
      h: cropH
    };
  }

  function drawImageCoverRegion(c, image, sx, sy, sw, sh, x, y, w, h) {
    if (!sw || !sh) return;
    const crop = getCoverSourceRect(sw, sh, w, h);
    if (!crop) return;
    c.drawImage(image, sx + crop.x, sy + crop.y, crop.w, crop.h, x, y, w, h);
  }

  function estimateSpeechLevelFromText(text, charIndex) {
    const src = String(text || "");
    if (!src) return 0;

    const idx = Math.max(0, Math.min(src.length - 1, Math.floor(Number.isFinite(charIndex) ? charIndex : 0)));
    const start = Math.max(0, idx - 2);
    const end = Math.min(src.length, idx + 8);
    const windowText = src.slice(start, end).toLowerCase();
    if (!windowText) return 0;

    let level = 0.14;
    for (const ch of windowText) {
      if ("aeiouy".includes(ch)) level += 0.12;
      else if ("fvszjxcrltnh".includes(ch)) level += 0.06;
      else if ("bmp".includes(ch)) level -= 0.03;
      else if (" \t\r\n".includes(ch)) level -= 0.08;
      else if (".,;:!?".includes(ch)) level -= 0.12;
    }

    const current = src[idx];
    if (current && ".,;:!?".includes(current)) level *= 0.45;
    return clamp01(level);
  }

  function estimateLessonSpeechLevel(nowMs) {
    const timeline = lessonSpeechTimeline || createSpeechTimeline(scriptText);
    if (audio && !useBoundaryLessonNarration() && !audio.paused && !audio.ended) {
      const dur = (Number.isFinite(audio.duration) && audio.duration > 0)
        ? audio.duration
        : estimateDurationSeconds();
      const cur = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const progress = dur > 0 ? clamp01(cur / dur) : 0;
      const charIdx = timelineCharAtProgress(timeline, progress);
      return estimateSpeechLevelFromText(scriptText, charIdx);
    }

    if (!manualIsPlaying || manualIsPaused) return 0;
    const est = estimateDurationSeconds();
    const seconds = manualElapsedSeconds + (manualPlayStart > 0 ? (nowMs - manualPlayStart) / 1000 : 0);
    const fallback = est > 0 ? clamp01(seconds / est) : 0;
    const fallbackChar = timelineCharAtProgress(timeline, fallback);
    const charIdx = manualHasSpeechBoundary ? Math.max(manualSpeechCharIndex, fallbackChar) : fallbackChar;
    return estimateSpeechLevelFromText(scriptText, charIdx);
  }

  function estimateQaSpeechLevel(nowMs) {
    if (!qaIsSpeaking) return 0;
    const text = String(qaNarrationText || "").trim();
    if (!text) return 0;

    const timeline = qaSpeechTimeline || createSpeechTimeline(text);
    let charIdx = qaSpeechCharIndex;

    if (qaAudio && Number.isFinite(qaAudio.duration) && qaAudio.duration > 0) {
      const cur = Number.isFinite(qaAudio.currentTime) ? qaAudio.currentTime : 0;
      const audioProgress = clamp01(cur / qaAudio.duration);
      const audioChar = timelineCharAtProgress(timeline, audioProgress);
      charIdx = qaHasSpeechBoundary ? Math.max(charIdx, audioChar) : audioChar;
    } else {
      const seconds = qaElapsedSeconds + (qaPlayStart > 0 ? (nowMs - qaPlayStart) / 1000 : 0);
      const dur = qaDurationSeconds > 0 ? qaDurationSeconds : estimateSpeechSeconds(text, getSpeed());
      const fallbackProgress = dur > 0 ? clamp01(seconds / dur) : 0;
      const fallbackChar = timelineCharAtProgress(timeline, fallbackProgress);
      charIdx = qaHasSpeechBoundary ? Math.max(charIdx, fallbackChar) : fallbackChar;
    }

    return estimateSpeechLevelFromText(text, charIdx);
  }

  function getNarrationClockSeconds(nowMs) {
    const speedRate = Math.max(0.1, getSpeed());
    if (mode === "qa") {
      if (qaAudio && Number.isFinite(qaAudio.currentTime))
        return Math.max(0, qaAudio.currentTime);
      const qaSeconds = qaElapsedSeconds + (qaPlayStart > 0 ? (nowMs - qaPlayStart) / 1000 : 0);
      return Math.max(0, qaSeconds * speedRate);
    }

    if (audio && !useBoundaryLessonNarration() && Number.isFinite(audio.currentTime))
      return Math.max(0, audio.currentTime);

    const lessonSeconds = manualElapsedSeconds + (manualPlayStart > 0 ? (nowMs - manualPlayStart) / 1000 : 0);
    return Math.max(0, lessonSeconds * speedRate);
  }

  function isNarrationCurrentlySpeaking() {
    if (mode === "qa") {
      if (qaAudio) return !qaAudio.paused && !qaAudio.ended;
      return qaIsSpeaking;
    }

    if (audio && !useBoundaryLessonNarration())
      return !audio.paused && !audio.ended;
    return manualIsPlaying && !manualIsPaused;
  }

  function getSpeed() {
    const r = parseFloat(speed && speed.value ? speed.value : "1.0");
    return Number.isFinite(r) ? r : 1.0;
  }

  function updateSpeedLabel() {
    if (speedValue) speedValue.textContent = `${getSpeed().toFixed(1)}×`;
    if (audio) audio.playbackRate = getSpeed();
    if (qaAudio) qaAudio.playbackRate = getSpeed();
    renderBoardTimingPlan();
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

      // When live audio amplitude isn't available, estimate speaking shape from narration position.
      level = Math.max(level, estimateQaSpeechLevel(t));
      level = Math.max(level, estimateLessonSpeechLevel(t));

      // Smooth transitions so the mouth doesn't jitter.
      lastLevel = lastLevel * 0.85 + level * 0.15;

      ensureCanvasResolution(false);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);

      const w = renderWidth;
      const h = renderHeight;

      // Background
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "rgba(124, 58, 237, 0.22)");
      grad.addColorStop(1, "rgba(34, 197, 94, 0.14)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const padding = 18;
      const board = {
        x: padding,
        y: padding,
        w: w - padding * 2,
        h: h - padding * 2
      };

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

      // Writing progress (driven by spoken position, not just wall-clock).
      const est = estimateDurationSeconds();
      const activeTimeline = mode === "qa" ? qaSpeechTimeline : lessonSpeechTimeline;
      const useLessonBoundarySync = mode !== "qa" && useBoundaryLessonNarration();
      let progress = 0;
      let spokenCharIndex = 0;
      let narrationSeconds = 0;
      const speedRate = Math.max(0.1, getSpeed());
      if (mode === "qa") {
        if (qaAudio && Number.isFinite(qaAudio.duration) && qaAudio.duration > 0) {
          const cur = Number.isFinite(qaAudio.currentTime) ? qaAudio.currentTime : 0;
          const dur = qaAudio.duration;
          progress = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
          spokenCharIndex = timelineCharAtProgress(activeTimeline, progress);
          narrationSeconds = Math.max(0, cur);
        } else {
          const seconds = qaElapsedSeconds + (qaPlayStart > 0 ? (t - qaPlayStart) / 1000 : 0);
          const dur = qaDurationSeconds > 0 ? qaDurationSeconds : 30;
          const fallback = dur > 0 ? Math.min(1, Math.max(0, seconds / dur)) : 0;
          const fallbackChar = timelineCharAtProgress(activeTimeline, fallback);
          spokenCharIndex = qaHasSpeechBoundary ? Math.max(qaSpeechCharIndex, fallbackChar) : fallbackChar;
          progress = timelineProgressAtChar(activeTimeline, spokenCharIndex);
          narrationSeconds = Math.max(0, seconds * speedRate);
        }
      } else if (audio && !useLessonBoundarySync) {
        const cur = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const dur = (Number.isFinite(audio.duration) && audio.duration > 0) ? audio.duration : est;
        progress = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
        spokenCharIndex = timelineCharAtProgress(activeTimeline, progress);
        narrationSeconds = Math.max(0, cur);
      } else {
        const seconds = manualElapsedSeconds + (manualPlayStart > 0 ? (t - manualPlayStart) / 1000 : 0);
        const fallback = est > 0 ? Math.min(1, Math.max(0, seconds / est)) : 0;
        const fallbackChar = timelineCharAtProgress(activeTimeline, fallback);
        spokenCharIndex = manualHasSpeechBoundary ? Math.max(manualSpeechCharIndex, fallbackChar) : fallbackChar;
        progress = timelineProgressAtChar(activeTimeline, spokenCharIndex);
        narrationSeconds = Math.max(0, seconds * speedRate);
      }

      const steps = Array.isArray(boardSteps) ? boardSteps : [];
      const timings = (Array.isArray(boardTimings) && boardTimings.length === steps.length)
        ? boardTimings
        : evenTimings(steps.length);
      const playbackDuration = mode === "qa"
        ? ((qaAudio && Number.isFinite(qaAudio.duration) && qaAudio.duration > 0)
          ? qaAudio.duration
          : (qaDurationSeconds > 0 ? qaDurationSeconds : 30))
        : ((audio && Number.isFinite(audio.duration) && audio.duration > 0)
          ? audio.duration
          : estimateDurationSeconds());
      const timestampSecondsRaw = resolveTimestampSeconds(boardTimestampSeconds, steps.length, playbackDuration);
      const timestampSeconds = timestampSecondsRaw.length === steps.length ? timestampSecondsRaw : null;
      const syncPlan = (Array.isArray(stepSyncPlan) && stepSyncPlan.length === steps.length) ? stepSyncPlan : null;
      const shouldRenderStep = (idx, step) => {
        if (!step) return false;
        if (step.kind === "draw") return true;
        if (!syncPlan || !syncPlan[idx]) return true;
        return !!syncPlan[idx].shouldWrite;
      };
      const total = steps.length;
      let activeLine = -1;
      for (let i = 0; i < total; i++) {
        const step = steps[i];
        if (!shouldRenderStep(i, step)) continue;
        if (timestampSeconds && Number.isFinite(timestampSeconds[i])) {
          if (narrationSeconds >= timestampSeconds[i]) activeLine = i;
          continue;
        }
        if (syncPlan && syncPlan[i]) {
          const startChar = Number.isFinite(syncPlan[i].startChar)
            ? syncPlan[i].startChar
            : timelineCharAtProgress(activeTimeline, timings[i]);
          if (spokenCharIndex >= startChar) activeLine = i;
        } else if (progress >= timings[i]) {
          activeLine = i;
        }
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
      let maxWidth = textArea.w;
      const lineHeight = 30;
      boardTextViewport = {
        x: textArea.x,
        y: textArea.y,
        w: textArea.w,
        h: textArea.h,
        lineHeight
      };
      ctx.fillStyle = "#111827";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "22px 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";

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

        class WhiteboardShape {
          constructor(id, kind) {
            this.id = id;
            this.kind = kind;
            this.progress = 1;
          }
          setProgress(t) {
            this.progress = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 1));
            return this;
          }
          setPosition(x, y) {
            if (Number.isFinite(x)) this.x = x;
            if (Number.isFinite(y)) this.y = y;
            return this;
          }
          moveBy(dx, dy) {
            if (Number.isFinite(dx) && Number.isFinite(this.x)) this.x += dx;
            if (Number.isFinite(dy) && Number.isFinite(this.y)) this.y += dy;
            return this;
          }
          draw() { /* override */ }
          getAnchor() { return null; }
        }

        class AxesShape extends WhiteboardShape {
          constructor(id, range) {
            super(id, "axes");
            this.setRange(range);
            this.mapper = null;
          }
          setRange(range) {
            const next = range || {};
            this.xmin = Number.isFinite(next.xmin) ? next.xmin : -5;
            this.xmax = Number.isFinite(next.xmax) ? next.xmax : 5;
            this.ymin = Number.isFinite(next.ymin) ? next.ymin : -5;
            this.ymax = Number.isFinite(next.ymax) ? next.ymax : 5;
            if (this.xmax === this.xmin) this.xmax = this.xmin + 1;
            if (this.ymax === this.ymin) this.ymax = this.ymin + 1;
            return this;
          }
          draw(c2) {
            this.mapper = renderCartesianAxes(c2, area, {
              xmin: this.xmin, xmax: this.xmax, ymin: this.ymin, ymax: this.ymax
            });
          }
          getAnchor() {
            if (!this.mapper) return null;
            return { x: this.mapper.mapX(0), y: this.mapper.mapY(0) };
          }
        }

        class LineShape extends WhiteboardShape {
          constructor(id, expr, axesId) {
            super(id, "line");
            this.expr = expr;
            this.axesId = axesId;
            this.anchor = null;
          }
          setEquation(expr) {
            this.expr = expr;
            return this;
          }
          setAxes(axesId) {
            this.axesId = axesId;
            return this;
          }
          draw(c2, getMapper, axesRange) {
            const m = getMapper(this.axesId);
            if (!m || !this.expr) return;
            const t = this.progress;
            c2.save();
            c2.lineCap = "round";
            c2.lineJoin = "round";
            c2.strokeStyle = "rgba(124,58,237,0.95)";
            c2.lineWidth = 4;
            if (this.expr.kind === "vertical") {
              const x = m.mapX(this.expr.x);
              const y1 = area.y + 14;
              const y2 = area.y + area.h - 14;
              const yy = y1 + (y2 - y1) * t;
              c2.beginPath();
              c2.moveTo(x, y1);
              c2.lineTo(x, yy);
              c2.stroke();
              this.anchor = { x, y: yy };
            } else {
              const x1m = axesRange.xmin;
              const x2m = axesRange.xmax;
              const y1m = this.expr.m * x1m + this.expr.b;
              const y2m = this.expr.m * x2m + this.expr.b;
              const x1 = m.mapX(x1m);
              const y1 = m.mapY(y1m);
              const x2 = m.mapX(x2m);
              const y2 = m.mapY(y2m);
              const x = x1 + (x2 - x1) * t;
              const y = y1 + (y2 - y1) * t;
              c2.beginPath();
              c2.moveTo(x1, y1);
              c2.lineTo(x, y);
              c2.stroke();
              this.anchor = { x, y };
            }
            c2.restore();
          }
          getAnchor() { return this.anchor; }
        }

        class PointShape extends WhiteboardShape {
          constructor(id, pt, label, axesId) {
            super(id, "point");
            this.x = pt.x;
            this.y = pt.y;
            this.label = label || null;
            this.axesId = axesId;
            this.anchor = null;
          }
          setPoint(pt) {
            this.x = pt.x;
            this.y = pt.y;
            return this;
          }
          setLabel(label) {
            this.label = label || null;
            return this;
          }
          setAxes(axesId) {
            this.axesId = axesId;
            return this;
          }
          draw(c2, getMapper) {
            const m = getMapper(this.axesId);
            if (!m) return;
            const x = m.mapX(this.x);
            const y = m.mapY(this.y);
            c2.save();
            c2.globalAlpha = 0.2 + 0.8 * this.progress;
            c2.fillStyle = "rgba(17,24,39,0.92)";
            c2.beginPath();
            c2.arc(x, y, 6, 0, Math.PI * 2);
            c2.fill();
            c2.restore();
            if (this.label) {
              c2.save();
              c2.globalAlpha = 0.2 + 0.8 * this.progress;
              c2.fillStyle = "rgba(17,24,39,0.80)";
              c2.font = "16px 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
              c2.textAlign = "left";
              c2.textBaseline = "bottom";
              c2.fillText(this.label, x + 8, y - 6, area.w - 12);
              c2.restore();
            }
            this.anchor = { x, y };
          }
          getAnchor() { return this.anchor; }
        }

        class CircleShape extends WhiteboardShape {
          constructor(id, axesId) {
            super(id, "circle");
            this.axesId = axesId;
            this.x = 0;
            this.y = 0;
            this.radius = 2;
            this.startDeg = 0;
            this.endDeg = 360;
            this.anchor = null;
          }
          setCenter(x, y) { this.setPosition(x, y); return this; }
          setRadius(radius) {
            if (Number.isFinite(radius) && radius > 0) this.radius = radius;
            return this;
          }
          setAngles(startDeg, endDeg) {
            if (Number.isFinite(startDeg)) this.startDeg = startDeg;
            if (Number.isFinite(endDeg)) this.endDeg = endDeg;
            return this;
          }
          setAxes(axesId) {
            this.axesId = axesId;
            return this;
          }
          draw(c2, getMapper) {
            const m = getMapper(this.axesId);
            if (!m) return;
            const cx = m.mapX(this.x);
            const cy = m.mapY(this.y);
            const r = Math.max(4, Math.abs(m.mapX(this.x + this.radius) - cx));
            const start = (this.startDeg * Math.PI) / 180;
            const end = (this.endDeg * Math.PI) / 180;
            const now = start + (end - start) * this.progress;
            c2.save();
            c2.strokeStyle = "rgba(124,58,237,0.95)";
            c2.lineWidth = 4;
            c2.beginPath();
            c2.arc(cx, cy, r, start, now, false);
            c2.stroke();
            c2.restore();
            this.anchor = { x: cx + Math.cos(now) * r, y: cy + Math.sin(now) * r };
          }
          getAnchor() { return this.anchor; }
        }

        class SquareShape extends WhiteboardShape {
          constructor(id, axesId) {
            super(id, "square");
            this.axesId = axesId;
            this.x = 0;
            this.y = 0;
            this.size = 2;
            this.rotationDeg = 0;
            this.anchor = null;
          }
          setCenter(x, y) { this.setPosition(x, y); return this; }
          setSize(size) {
            if (Number.isFinite(size) && size > 0) this.size = size;
            return this;
          }
          setRotation(deg) {
            if (Number.isFinite(deg)) this.rotationDeg = deg;
            return this;
          }
          setAxes(axesId) {
            this.axesId = axesId;
            return this;
          }
          draw(c2, getMapper) {
            const m = getMapper(this.axesId);
            if (!m) return;
            const cx = m.mapX(this.x);
            const cy = m.mapY(this.y);
            const half = Math.max(8, Math.abs(m.mapX(this.x + this.size / 2) - cx));
            const rot = (this.rotationDeg * Math.PI) / 180;
            const base = [
              { x: -half, y: -half },
              { x: half, y: -half },
              { x: half, y: half },
              { x: -half, y: half }
            ];
            const pts = base.map((p) => ({
              x: cx + (p.x * Math.cos(rot) - p.y * Math.sin(rot)),
              y: cy + (p.x * Math.sin(rot) + p.y * Math.cos(rot))
            }));
            const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
            const segProgress = Math.max(0, Math.min(1, this.progress)) * edges.length;

            c2.save();
            c2.strokeStyle = "rgba(124,58,237,0.95)";
            c2.lineWidth = 4;
            c2.lineCap = "round";
            for (let i = 0; i < edges.length; i++) {
              const remain = segProgress - i;
              if (remain <= 0) break;
              const [a, b] = edges[i];
              const p1 = pts[a];
              const p2 = pts[b];
              const t = Math.min(1, remain);
              const x = p1.x + (p2.x - p1.x) * t;
              const y = p1.y + (p2.y - p1.y) * t;
              c2.beginPath();
              c2.moveTo(p1.x, p1.y);
              c2.lineTo(x, y);
              c2.stroke();
              this.anchor = { x, y };
            }
            c2.restore();
            if (!this.anchor) this.anchor = { x: cx, y: cy };
          }
          getAnchor() { return this.anchor; }
        }

        class TriangleShape extends WhiteboardShape {
          constructor(id) {
            super(id, "triangle");
            this.a = 4;
            this.b = 3;
            this.labels = { base: "a", height: "b", hyp: "c" };
            this.angles = null;
            this.layout = null;
            this.anchor = null;
          }
          setSides(a, b, labels) {
            if (Number.isFinite(a) && a > 0) this.a = a;
            if (Number.isFinite(b) && b > 0) this.b = b;
            if (labels) this.labels = {
              base: labels.base || this.labels.base,
              height: labels.height || this.labels.height,
              hyp: labels.hyp || this.labels.hyp
            };
            return this;
          }
          setAngles(aDeg, bDeg, cDeg) {
            const a = Number.isFinite(aDeg) ? Math.max(1, Math.min(178, aDeg)) : null;
            const b = Number.isFinite(bDeg) ? Math.max(1, Math.min(178, bDeg)) : null;
            let c = Number.isFinite(cDeg) ? Math.max(1, Math.min(178, cDeg)) : null;
            if (a !== null && b !== null && c === null) c = 180 - a - b;
            if (a === null || b === null || c === null) return this;
            if (a + b + c < 179 || a + b + c > 181) return this;
            this.angles = { a, b, c };
            return this;
          }
          draw(c2) {
            const pad = 22;
            const maxW = area.w - pad * 2;
            const maxH = area.h - pad * 2;

            let base = this.a;
            let height = this.b;
            if (this.angles) {
              const aRad = (this.angles.a * Math.PI) / 180;
              const bRad = (this.angles.b * Math.PI) / 180;
              const cRad = (this.angles.c * Math.PI) / 180;
              const sinC = Math.sin(cRad);
              if (Math.abs(sinC) > 1e-6) {
                const sideA = base * Math.sin(aRad) / sinC;
                const sideB = base * Math.sin(bRad) / sinC;
                const x = (sideB * sideB + base * base - sideA * sideA) / (2 * base);
                const y = Math.sqrt(Math.max(0, sideB * sideB - x * x));
                height = Math.max(0.5, y);
              }
            }

            const scale = Math.max(1e-6, Math.min(maxW / base, maxH / height) * 0.82);
            const x0 = area.x + pad;
            const y0 = area.y + area.h - pad;
            const p0 = { x: x0, y: y0 };
            const p1 = { x: x0 + base * scale, y: y0 };
            const p2 = { x: x0 + base * scale, y: y0 - height * scale };
            this.layout = { p0, p1, p2 };

            const seg = (from, to, tt) => {
              const x = from.x + (to.x - from.x) * tt;
              const y = from.y + (to.y - from.y) * tt;
              c2.beginPath();
              c2.moveTo(from.x, from.y);
              c2.lineTo(x, y);
              c2.stroke();
              this.anchor = { x, y };
            };

            c2.save();
            c2.strokeStyle = "rgba(124,58,237,0.95)";
            c2.lineWidth = 4;
            c2.lineCap = "round";
            c2.lineJoin = "round";

            if (this.progress < 1 / 3) {
              seg(p0, p1, this.progress * 3);
            } else if (this.progress < 2 / 3) {
              seg(p0, p1, 1);
              seg(p1, p2, (this.progress - 1 / 3) * 3);
            } else {
              seg(p0, p1, 1);
              seg(p1, p2, 1);
              seg(p2, p0, (this.progress - 2 / 3) * 3);
            }
            c2.restore();

            if (this.progress > 0.9) {
              c2.save();
              c2.fillStyle = "rgba(17,24,39,0.78)";
              c2.font = "16px 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
              c2.textAlign = "center";
              c2.textBaseline = "middle";
              c2.fillText(String(this.labels.base || "a"), (p0.x + p1.x) / 2, p0.y + 14, maxW);
              c2.fillText(String(this.labels.height || "b"), p1.x + 14, (p1.y + p2.y) / 2, maxW);
              if (this.labels.hyp) c2.fillText(String(this.labels.hyp), (p0.x + p2.x) / 2 - 6, (p0.y + p2.y) / 2 - 10, maxW);
              c2.restore();
            }
          }
          focus(c2, strength, which) {
            if (!this.layout) return false;
            const q = String(which || "").toLowerCase().trim();
            const p0 = this.layout.p0;
            const p1 = this.layout.p1;
            const p2 = this.layout.p2;

            if (q.includes("angle") || q.includes("corner") || q.includes("box") || q.includes("square")) {
              c2.save();
              c2.globalAlpha = 0.25 + 0.75 * strength;
              c2.strokeStyle = "rgba(34,197,94,0.95)";
              c2.lineWidth = 4;
              c2.beginPath();
              c2.moveTo(p1.x, p1.y);
              c2.lineTo(p1.x - 16, p1.y);
              c2.lineTo(p1.x - 16, p1.y - 16);
              c2.lineTo(p1.x, p1.y - 16);
              c2.stroke();
              c2.restore();
              return { x: p1.x, y: p1.y };
            }

            let a = p2;
            let b = p0;
            if (q.includes("base") || q === "a" || q.includes("leg a") || q.includes("leg1")) { a = p0; b = p1; }
            else if (q.includes("height") || q === "b" || q.includes("leg b") || q.includes("leg2")) { a = p1; b = p2; }
            else if (q.includes("hyp") || q === "c" || q.includes("hypotenuse")) { a = p2; b = p0; }

            c2.save();
            c2.globalAlpha = 0.25 + 0.75 * strength;
            c2.strokeStyle = "rgba(34,197,94,0.95)";
            c2.lineWidth = 7;
            c2.lineCap = "round";
            c2.beginPath();
            c2.moveTo(a.x, a.y);
            c2.lineTo(b.x, b.y);
            c2.stroke();
            c2.restore();
            return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          }
          getAnchor() { return this.anchor; }
        }

        class BarShape extends WhiteboardShape {
          constructor(id) {
            super(id, "bar");
            this.bars = [];
            this.layout = [];
            this.anchor = null;
          }
          setBars(bars) {
            this.bars = Array.isArray(bars) ? bars.slice() : [];
            return this;
          }
          draw(c2) {
            const bars = this.bars;
            if (!Array.isArray(bars) || bars.length === 0) return;

            const pad = 18;
            const innerW = Math.max(10, area.w - pad * 2);
            const innerH = Math.max(10, area.h - pad * 2);
            const x0 = area.x + pad;
            const y0 = area.y + area.h - pad;
            const maxV = Math.max(1e-6, ...bars.map((b) => Math.abs(b.value)));
            const n = bars.length;
            const gapPx = Math.max(8, Math.floor(innerW * 0.04));
            const barW = n > 0 ? Math.max(10, Math.floor((innerW - gapPx * (n - 1)) / n)) : innerW;
            this.layout = [];

            c2.save();
            c2.strokeStyle = "rgba(17,24,39,0.55)";
            c2.lineWidth = 2.5;
            c2.beginPath();
            c2.moveTo(x0, y0);
            c2.lineTo(x0 + innerW, y0);
            c2.stroke();

            for (let i = 0; i < n; i++) {
              const bar = bars[i];
              const h = (Math.abs(bar.value) / maxV) * (innerH - 38) * this.progress;
              const x = x0 + i * (barW + gapPx);
              const y = y0 - h;
              this.layout.push({ label: String(bar.label || ""), x, y, w: barW, h });
              c2.fillStyle = "rgba(124,58,237,0.55)";
              roundedRectPath(c2, x, y, barW, h, 10);
              c2.fill();
              c2.fillStyle = "rgba(17,24,39,0.82)";
              c2.font = "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
              c2.textAlign = "center";
              c2.textBaseline = "top";
              c2.fillText(bar.label, x + barW / 2, y0 + 8, barW + 8);
              this.anchor = { x: x + barW / 2, y };
            }
            c2.restore();
          }
          focus(c2, strength, labelText) {
            const q = String(labelText || "").trim().toLowerCase();
            if (!q || !Array.isArray(this.layout) || this.layout.length === 0) return false;
            const found = this.layout.find((b) => String(b.label || "").trim().toLowerCase() === q)
              || this.layout.find((b) => String(b.label || "").trim().toLowerCase().includes(q));
            if (!found) return false;
            c2.save();
            c2.globalAlpha = 0.25 + 0.75 * strength;
            c2.strokeStyle = "rgba(34,197,94,0.95)";
            c2.lineWidth = 4;
            roundedRectPath(c2, found.x - 4, found.y - 4, found.w + 8, found.h + 8, 12);
            c2.stroke();
            c2.restore();
            return { x: found.x + found.w / 2, y: found.y };
          }
          getAnchor() { return this.anchor; }
        }

        let mode = "none";
        let axesRange = { xmin: -5, xmax: 5, ymin: -5, ymax: 5 };
        let lastPen = { x: area.x + area.w * 0.5, y: area.y + area.h * 0.45 };
        let activeFocusUnresolved = false;
        let focusCommand = null;

        const shapesById = new Map();
        const drawOrder = [];
        let defaultAxesId = null;
        let currentMapper = null;

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
          if (xr) { axesRange.xmin = xr.min; axesRange.xmax = xr.max; }
          const yr = extractAxisRange(cmd, "y");
          if (yr) { axesRange.ymin = yr.min; axesRange.ymax = yr.max; }
        }

        function readNamed(raw, key) {
          const re = new RegExp(`\\b${key}\\s*[:=]\\s*([^\\s,;]+)`, "i");
          const m = normalizeDrawText(raw).match(re);
          return m ? parseNumeric(m[1]) : null;
        }

        function parseShapeId(raw, fallback) {
          const text = normalizeDrawText(raw);
          const byKey = text.match(/\bid\s*[:=]\s*([a-z0-9_-]+)/i);
          if (byKey) return byKey[1];
          const head = text.match(/^([a-z0-9_-]{2,})\s+/i);
          if (head && !/^(right|line|point|bar|bars|triangle|circle|square|axes|axis|focus)$/i.test(head[1])) return head[1];
          return fallback;
        }

        function registerShape(shape) {
          if (!shape || !shape.id) return shape;
          if (!shapesById.has(shape.id)) drawOrder.push(shape.id);
          shapesById.set(shape.id, shape);
          return shape;
        }

        function getShape(id) {
          return id ? (shapesById.get(id) || null) : null;
        }

        function findLastShape(kind) {
          for (let i = drawOrder.length - 1; i >= 0; i--) {
            const shape = shapesById.get(drawOrder[i]);
            if (shape && shape.kind === kind) return shape;
          }
          return null;
        }

        function ensureAxesShape(idHint) {
          const id = idHint || defaultAxesId || "axes-main";
          let shape = getShape(id);
          if (!(shape instanceof AxesShape)) {
            shape = registerShape(new AxesShape(id, axesRange));
          } else {
            shape.setRange(axesRange);
          }
          defaultAxesId = shape.id;
          mode = "cartesian";
          return shape;
        }

        function ensureCartesian() {
          return ensureAxesShape(defaultAxesId || "axes-main");
        }

        function readMapper(axesId) {
          if (axesId) {
            const shape = getShape(axesId);
            if (shape instanceof AxesShape && shape.mapper) return shape.mapper;
          }
          if (defaultAxesId) {
            const shape = getShape(defaultAxesId);
            if (shape instanceof AxesShape && shape.mapper) return shape.mapper;
          }
          return currentMapper;
        }

        function readBarsFromText(text) {
          const tokens = String(text || "").split(/\s+/).filter(Boolean);
          const out = [];
          for (const token of tokens) {
            const idx = token.includes("=") ? token.indexOf("=") : token.indexOf(":");
            if (idx <= 0) continue;
            const label = token.slice(0, idx).trim();
            const value = parseNumeric(token.slice(idx + 1).trim());
            if (!label || value === null) continue;
            out.push({ label, value });
          }
          return out;
        }

        function renderScene() {
          resetLayer();
          currentMapper = null;
          for (const id of drawOrder) {
            const shape = shapesById.get(id);
            if (!shape) continue;

            if (shape instanceof AxesShape) {
              mode = "cartesian";
              shape.draw(c);
              currentMapper = shape.mapper;
              const a = shape.getAnchor();
              if (a) lastPen = a;
              continue;
            }

            if (shape instanceof LineShape) {
              mode = "cartesian";
              shape.draw(c, readMapper, axesRange);
            } else if (shape instanceof PointShape) {
              mode = "cartesian";
              shape.draw(c, readMapper);
            } else if (shape instanceof CircleShape) {
              mode = "cartesian";
              shape.draw(c, readMapper);
            } else if (shape instanceof SquareShape) {
              mode = "cartesian";
              shape.draw(c, readMapper);
            } else if (shape instanceof BarShape) {
              mode = "bar";
              shape.draw(c);
            } else if (shape instanceof TriangleShape) {
              mode = "triangle";
              shape.draw(c);
            } else {
              shape.draw(c, readMapper, axesRange);
            }

            const anchor = shape.getAnchor ? shape.getAnchor() : null;
            if (anchor) lastPen = anchor;
          }
        }

        function resolveFocus(queryText, strength) {
          const query = String(queryText || "").trim();
          if (!query) return false;
          const lower = query.toLowerCase();

          const focusByShape = (shape, detail) => {
            if (!shape) return false;
            if (shape instanceof BarShape) {
              const p = shape.focus(c, strength, detail || query);
              if (!p) return false;
              drawFocusRing(p.x, p.y, strength);
              lastPen = { x: p.x, y: p.y };
              return true;
            }
            if (shape instanceof TriangleShape) {
              const p = shape.focus(c, strength, detail || query);
              if (!p) return false;
              drawFocusRing(p.x, p.y, strength);
              lastPen = { x: p.x, y: p.y };
              return true;
            }
            const anchor = shape.getAnchor ? shape.getAnchor() : null;
            if (!anchor) return false;
            drawFocusRing(anchor.x, anchor.y, strength);
            lastPen = { x: anchor.x, y: anchor.y };
            return true;
          };

          const idMatch = lower.match(/\bid\s*[:=]\s*([a-z0-9_-]+)/i);
          if (idMatch) {
            const byId = getShape(idMatch[1]);
            if (focusByShape(byId, query)) return true;
          }

          if (lower.startsWith("bar ")) {
            const bar = findLastShape("bar");
            if (focusByShape(bar, query.slice(4).trim())) return true;
          }
          if (lower.startsWith("triangle ")) {
            const tri = findLastShape("triangle");
            if (focusByShape(tri, query.slice(9).trim())) return true;
          }

          if (lower.includes("circle")) {
            if (focusByShape(findLastShape("circle"), query)) return true;
          }
          if (lower.includes("square")) {
            if (focusByShape(findLastShape("square"), query)) return true;
          }
          if (lower.includes("line")) {
            if (focusByShape(findLastShape("line"), query)) return true;
          }
          if (lower.includes("point")) {
            if (focusByShape(findLastShape("point"), query)) return true;
          }

          const point = parsePoint(query.replace(/^point\s+/i, ""));
          if (point) {
            const m = readMapper(defaultAxesId);
            if (!m) return false;
            const x = m.mapX(point.x);
            const y = m.mapY(point.y);
            drawFocusRing(x, y, strength);
            lastPen = { x, y };
            return true;
          }

          const expr = parseLineExpr(query);
          if (expr) {
            const line = new LineShape("focus-line", expr, defaultAxesId).setProgress(Math.max(0.4, strength));
            line.draw(c, readMapper, axesRange);
            const a = line.getAnchor();
            if (!a) return false;
            drawFocusRing(a.x, a.y, strength);
            lastPen = { x: a.x, y: a.y };
            return true;
          }

          return false;
        }

        for (let i = 0; i <= activeIdx && i < stepsArr.length; i++) {
          const step = stepsArr[i];
          if (!step || step.kind !== "draw") continue;

          const progressT = (i === activeIdx) ? activeT : 1;
          const cmd = normalizeDrawText(step.command).trim();
          if (!cmd) continue;
          const parts = cmd.split(/\s+/).filter(Boolean);
          const op = (parts[0] || "").toLowerCase().replace(/[^a-z]/g, "");
          const rest = parts.slice(1).join(" ");

          if (op === "focus" || op === "highlight" || op === "pointat") {
            if (i === activeIdx) focusCommand = { query: rest, strength: progressT };
            continue;
          }

          if (op === "clear" || op === "reset") {
            mode = "none";
            axesRange = { xmin: -5, xmax: 5, ymin: -5, ymax: 5 };
            currentMapper = null;
            defaultAxesId = null;
            drawOrder.length = 0;
            shapesById.clear();
            continue;
          }

          if (op === "axes" || op === "axis" || op === "grid" || op === "plane" || op === "coordinate") {
            setAxesFromCommand(rest);
            const id = parseShapeId(rest, `axes-${i + 1}`);
            const shape = ensureAxesShape(id).setRange(axesRange).setProgress(progressT);
            registerShape(shape);
            continue;
          }

          if (op === "line" || op === "graph" || op === "plot" || op === "sketch") {
            ensureCartesian();
            const expr = parseLineExpr(rest);
            if (!expr) continue;
            const id = parseShapeId(rest, `line-${i + 1}`);
            let shape = getShape(id);
            if (!(shape instanceof LineShape)) shape = registerShape(new LineShape(id, expr, defaultAxesId));
            shape.setAxes(defaultAxesId).setEquation(expr).setProgress(progressT);
            continue;
          }

          if (op === "point" || op === "dot") {
            ensureCartesian();
            const pt = parsePoint(rest);
            if (!pt) continue;
            const labelMatch = normalizeDrawText(rest).match(/label\s*[:=]\s*(.+)$/i);
            const label = labelMatch ? String(labelMatch[1] || "").trim().replace(/^\"|\"$/g, "") : null;
            const id = parseShapeId(rest, `point-${i + 1}`);
            let shape = getShape(id);
            if (!(shape instanceof PointShape)) shape = registerShape(new PointShape(id, pt, label, defaultAxesId));
            shape.setAxes(defaultAxesId).setPoint(pt).setLabel(label).setProgress(progressT);
            continue;
          }

          if (op === "circle") {
            ensureCartesian();
            const id = parseShapeId(rest, `circle-${i + 1}`);
            let shape = getShape(id);
            if (!(shape instanceof CircleShape)) shape = registerShape(new CircleShape(id, defaultAxesId));
            const center = parsePoint(rest);
            if (center) shape.setCenter(center.x, center.y);
            const r = readNamed(rest, "r") ?? readNamed(rest, "radius");
            if (r !== null) shape.setRadius(Math.abs(r));
            const startDeg = readNamed(rest, "start") ?? readNamed(rest, "from");
            const endDeg = readNamed(rest, "end") ?? readNamed(rest, "to");
            if (startDeg !== null || endDeg !== null) shape.setAngles(startDeg, endDeg);
            shape.setAxes(defaultAxesId).setProgress(progressT);
            continue;
          }

          if (op === "square") {
            ensureCartesian();
            const id = parseShapeId(rest, `square-${i + 1}`);
            let shape = getShape(id);
            if (!(shape instanceof SquareShape)) shape = registerShape(new SquareShape(id, defaultAxesId));
            const center = parsePoint(rest);
            if (center) shape.setCenter(center.x, center.y);
            const size = readNamed(rest, "size") ?? readNamed(rest, "side") ?? readNamed(rest, "s");
            if (size !== null) shape.setSize(Math.abs(size));
            const rot = readNamed(rest, "angle") ?? readNamed(rest, "rotation") ?? readNamed(rest, "rot");
            if (rot !== null) shape.setRotation(rot);
            shape.setAxes(defaultAxesId).setProgress(progressT);
            continue;
          }

          if (op === "bar" || op === "bars") {
            const bars = readBarsFromText(rest);
            if (bars.length === 0) continue;
            const id = parseShapeId(rest, `bar-${i + 1}`);
            let shape = getShape(id);
            if (!(shape instanceof BarShape)) shape = registerShape(new BarShape(id));
            shape.setBars(bars).setProgress(progressT);
            mode = "bar";
            continue;
          }

          if (op === "triangle") {
            const id = parseShapeId(rest, `triangle-${i + 1}`);
            let shape = getShape(id);
            if (!(shape instanceof TriangleShape)) shape = registerShape(new TriangleShape(id));

            const cleaned = normalizeDrawText(rest).replace(/[;,]/g, " ").replace(/\s+/g, " ").trim();
            const numbers = (cleaned.match(/-?\d+(?:\.\d+)?/g) || [])
              .map((n) => parseNumeric(n))
              .filter((v) => v !== null);

            const lower = cleaned.toLowerCase();
            if (lower.includes("angle")) {
              const a1 = numbers.length > 0 ? numbers[0] : null;
              const a2 = numbers.length > 1 ? numbers[1] : null;
              const a3 = numbers.length > 2 ? numbers[2] : null;
              shape.setAngles(a1, a2, a3);
            } else {
              const a = (numbers.length > 0 && numbers[0] > 0) ? numbers[0] : 4;
              const b = (numbers.length > 1 && numbers[1] > 0) ? numbers[1] : 3;
              const labels = {
                base: numbers.length > 0 ? String(numbers[0]) : "a",
                height: numbers.length > 1 ? String(numbers[1]) : "b",
                hyp: numbers.length > 2 ? String(numbers[2]) : "c"
              };
              shape.setSides(a, b, labels);
            }
            shape.setProgress(progressT);
            mode = "triangle";
            continue;
          }

          if (op === "move" || op === "shift") {
            const id = parseShapeId(rest, "");
            const shape = getShape(id);
            if (!shape) continue;
            const pt = parsePoint(rest);
            if (pt) {
              shape.setPosition(pt.x, pt.y);
            } else {
              const dx = readNamed(rest, "dx");
              const dy = readNamed(rest, "dy");
              shape.moveBy(dx || 0, dy || 0);
            }
            shape.setProgress(progressT);
            continue;
          }

          const lowerCmd = cmd.toLowerCase();
          if (lowerCmd.includes("..") && (lowerCmd.includes("x") || lowerCmd.includes("y"))) {
            setAxesFromCommand(cmd);
            ensureAxesShape(`axes-${i + 1}`).setRange(axesRange).setProgress(progressT);
            continue;
          }
          if (lowerCmd.includes("y=") || lowerCmd.includes("x=") || (lowerCmd.includes("=") && lowerCmd.includes("x") && lowerCmd.includes("y"))) {
            ensureCartesian();
            const expr = parseLineExpr(cmd);
            if (!expr) continue;
            const id = `line-${i + 1}`;
            const shape = registerShape(new LineShape(id, expr, defaultAxesId).setProgress(progressT));
            shape.setAxes(defaultAxesId).setEquation(expr);
            continue;
          }
          if (lowerCmd.includes("(") && lowerCmd.includes(",") && lowerCmd.includes(")")) {
            ensureCartesian();
            const pt = parsePoint(cmd);
            if (!pt) continue;
            registerShape(new PointShape(`point-${i + 1}`, pt, null, defaultAxesId).setProgress(progressT));
            continue;
          }
        }

        renderScene();

        if (focusCommand) {
          const focused = resolveFocus(focusCommand.query, focusCommand.strength);
          if (!focused) activeFocusUnresolved = true;
        }

        return activeFocusUnresolved ? { penX: null, penY: null } : { penX: lastPen.x, penY: lastPen.y };
      }

      const textRows = [];
      for (let i = 0; i < activeLine && i < total; i++) {
        const step = steps[i];
        if (!step || !shouldRenderStep(i, step)) continue;
        if (step.kind === "text") textRows.push({ text: step.text, isActive: false });
      }

      let activeLocal = 0;
      let activeStep = null;
      if (activeLine >= 0 && activeLine < total) {
        activeStep = steps[activeLine];
        if (timestampSeconds && Number.isFinite(timestampSeconds[activeLine])) {
          const startSeconds = timestampSeconds[activeLine];
          let endSeconds = null;
          for (let i = activeLine + 1; i < total; i++) {
            if (Number.isFinite(timestampSeconds[i])) {
              endSeconds = timestampSeconds[i];
              break;
            }
          }

          if (!Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
            const activeAudio = mode === "qa" ? qaAudio : audio;
            const fallbackDuration = mode === "qa"
              ? (qaDurationSeconds > 0 ? qaDurationSeconds : (startSeconds + 1.0))
              : estimateDurationSeconds();
            const durationSeconds = (activeAudio && Number.isFinite(activeAudio.duration) && activeAudio.duration > 0)
              ? activeAudio.duration
              : fallbackDuration;
            endSeconds = Math.max(startSeconds + 0.8, durationSeconds);
          }

          const spanSeconds = Math.max(0.18, endSeconds - startSeconds);
          activeLocal = clamp01((narrationSeconds - startSeconds) / spanSeconds);
        } else {
          const sync = (syncPlan && syncPlan[activeLine]) ? syncPlan[activeLine] : null;
          if (sync) {
            const span = Math.max(1, sync.endChar - sync.startChar);
            activeLocal = clamp01((spokenCharIndex - sync.startChar) / span);
            if (activeStep && activeStep.kind === "text" && !sync.matched)
              activeLocal = 1;
          } else {
            const startAt = timings[activeLine];
            const endAt = (activeLine + 1 < total) ? timings[activeLine + 1] : 1.0;
            activeLocal = endAt > startAt ? (progress - startAt) / (endAt - startAt) : 1.0;
            activeLocal = clamp01(activeLocal);
          }
        }

        // Heuristic sync still benefits from slightly faster diagram completion.
        if ((!timestampSeconds || !Number.isFinite(timestampSeconds[activeLine])) && activeStep && activeStep.kind === "draw")
          activeLocal = clamp01(activeLocal * 1.25);

        if (activeStep && activeStep.kind === "text" && shouldRenderStep(activeLine, activeStep)) {
          const line = activeStep.text;
          const count = Math.max(0, Math.min(line.length, Math.floor(line.length * activeLocal)));
          const partialText = count > 0 ? line.substring(0, count) : "";
          textRows.push({ text: partialText, isActive: true });
        }
      }

      const maxRowsVisible = Math.max(1, Math.floor(textArea.h / lineHeight) - 1);
      boardScrollMaxRows = Math.max(0, textRows.length - maxRowsVisible);
      if (boardScrollRows > boardScrollMaxRows) boardScrollRows = boardScrollMaxRows;
      if (boardScrollRows < 0) boardScrollRows = 0;
      if (boardScrollMaxRows > 0) maxWidth = Math.max(80, maxWidth - 12);

      const firstVisibleRow = Math.max(0, textRows.length - maxRowsVisible - boardScrollRows);
      const visibleRows = textRows.slice(firstVisibleRow, firstVisibleRow + maxRowsVisible);
      for (const row of visibleRows) {
        if (y0 > textArea.y + textArea.h - lineHeight) break;
        const rowText = String(row && row.text ? row.text : "");
        ctx.fillText(rowText, x0, y0, maxWidth);
        if (row && row.isActive) {
          const metrics = ctx.measureText(rowText);
          const cx = x0 + Math.min(metrics.width, maxWidth - 4);
          const cy = y0;
          ctx.fillStyle = "rgba(124,58,237,0.9)";
          ctx.fillRect(cx, cy + 4, 6, 22);
          ctx.fillStyle = "#111827";
          penX = cx;
          penY = cy + 16;
        }
        y0 += lineHeight;
      }

      if (boardScrollMaxRows > 0) {
        const trackW = 5;
        const trackPad = 4;
        const trackX = textArea.x + textArea.w - trackW - 2;
        const trackY = textArea.y + trackPad;
        const trackH = Math.max(24, textArea.h - trackPad * 2);
        const thumbH = Math.max(26, Math.round((maxRowsVisible / Math.max(1, textRows.length)) * trackH));
        const travel = Math.max(1, trackH - thumbH);
        const ratio = boardScrollMaxRows > 0 ? (boardScrollRows / boardScrollMaxRows) : 0;
        const thumbY = trackY + Math.round((1 - ratio) * travel);
        const hitPadX = 8;

        boardScrollbarViewport = {
          trackX,
          trackY,
          trackW,
          trackH,
          travel,
          thumbY,
          thumbH,
          hitX: trackX - hitPadX,
          hitY: trackY,
          hitW: trackW + hitPadX * 2,
          hitH: trackH,
          thumbHitX: trackX - hitPadX,
          thumbHitW: trackW + hitPadX * 2
        };

        ctx.fillStyle = "rgba(17,24,39,0.10)";
        ctx.fillRect(trackX, trackY, trackW, trackH);
        ctx.fillStyle = "rgba(17,24,39,0.40)";
        ctx.fillRect(trackX, thumbY, trackW, thumbH);
      } else {
        boardScrollbarViewport = null;
        clearScrollbarDrag();
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

      // Watermark (AI-generated)
      ctx.fillStyle = "rgba(255,255,255,0.70)";
      ctx.font = "13px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("AI-generated whiteboard", 16, h - 16);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    raf = requestAnimationFrame(draw);
  }

  function stopLoop() {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function refreshBoardFrame() {
    const alreadyRunning = !!raf;
    startLoop();
    if (alreadyRunning) return;

    window.setTimeout(() => {
      if (raf && mode === "qa" && !qaIsSpeaking && !qaAudio) {
        stopLoop();
        return;
      }
      if (raf && mode === "lesson" && !lessonIsPlaying()) {
        stopLoop();
      }
    }, 90);
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

    const boundaryLesson = useBoundaryLessonNarration();
    if (audio && !boundaryLesson) {
      if (hasSpeechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      }
      manualIsPlaying = false;
      manualIsPaused = false;
      manualPlayStart = 0;
      manualElapsedSeconds = 0;
      manualUtterance = null;
      manualSpeechProgress = 0;
      manualSpeechCharIndex = 0;
      manualHasSpeechBoundary = false;
      await ensureAnalyser();
      if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
      await audio.play();
      return;
    }
    if (audio && boundaryLesson) {
      try { audio.pause(); } catch { /* ignore */ }
      try { audio.currentTime = 0; } catch { /* ignore */ }
    }

    if (!hasSpeechSynthesis) return;
    const text = scriptText || "";
    if (!text) return;

    if (manualIsPlaying && !manualIsPaused) return;
    if (manualIsPlaying && manualIsPaused) {
      manualPlayStart = performance.now();
      manualIsPaused = false;
      try { window.speechSynthesis.resume(); } catch { /* ignore */ }
      return;
    }

    window.speechSynthesis.cancel();
    manualElapsedSeconds = 0;
    manualPlayStart = performance.now();
    manualIsPaused = false;
    manualIsPlaying = true;
    manualSpeechProgress = 0;
    manualSpeechCharIndex = 0;
    manualHasSpeechBoundary = false;
    manualUtterance = new SpeechSynthesisUtterance(text);
    manualUtterance.rate = getSpeed();
    manualUtterance.onboundary = (evt) => {
      if (!evt || !Number.isFinite(evt.charIndex) || text.length <= 0) return;
      manualHasSpeechBoundary = true;
      manualSpeechCharIndex = Math.max(manualSpeechCharIndex, Math.floor(evt.charIndex));
      manualSpeechProgress = Math.max(manualSpeechProgress, timelineProgressAtChar(lessonSpeechTimeline, manualSpeechCharIndex));
    };
    manualUtterance.onend = () => {
      manualElapsedSeconds = estimateDurationSeconds();
      manualIsPlaying = false;
      manualIsPaused = false;
      manualPlayStart = 0;
      manualSpeechCharIndex = text.length;
      manualSpeechProgress = 1;
      manualHasSpeechBoundary = true;
    };
    window.speechSynthesis.speak(manualUtterance);
  }

  function stop() {
    if (mode === "qa" || qaIsSpeaking) {
      resumeAfterQa = false;
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      finishQa({ resumeLessonAfter: false });
    }

    const boundaryLesson = useBoundaryLessonNarration();
    if (audio && !boundaryLesson) {
      audio.pause();
      audio.currentTime = 0;
    } else if (audio && boundaryLesson) {
      try { audio.pause(); } catch { /* ignore */ }
      try { audio.currentTime = 0; } catch { /* ignore */ }
    }

    if (hasSpeechSynthesis && (!audio || boundaryLesson)) {
      window.speechSynthesis.cancel();
      manualIsPlaying = false;
      manualPlayStart = 0;
      manualElapsedSeconds = 0;
      manualIsPaused = false;
      manualUtterance = null;
      manualSpeechProgress = 0;
      manualSpeechCharIndex = 0;
      manualHasSpeechBoundary = false;
    }
    stopLoop();
  }

  function progressFractionNow() {
    const est = estimateDurationSeconds();
    const boundaryLesson = useBoundaryLessonNarration();
    if (audio && !boundaryLesson) {
      const cur = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const dur = (Number.isFinite(audio.duration) && audio.duration > 0) ? audio.duration : est;
      return dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
    }

    const seconds = manualElapsedSeconds + (manualPlayStart > 0 ? (performance.now() - manualPlayStart) / 1000 : 0);
    const fallback = est > 0 ? Math.min(1, Math.max(0, seconds / est)) : 0;
    const fallbackChar = timelineCharAtProgress(lessonSpeechTimeline, fallback);
    const charIdx = manualHasSpeechBoundary ? Math.max(manualSpeechCharIndex, fallbackChar) : fallbackChar;
    return timelineProgressAtChar(lessonSpeechTimeline, charIdx);
  }

  function lessonIsPlaying() {
    if (audio && !useBoundaryLessonNarration()) return !audio.paused && !audio.ended;
    return manualIsPlaying && !manualIsPaused;
  }

  function pauseLesson() {
    if (audio && !useBoundaryLessonNarration()) {
      if (!audio.paused) audio.pause();
      return;
    }

    if (hasSpeechSynthesis) {
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
    if (audio && !useBoundaryLessonNarration()) {
      if (audio.paused && !audio.ended) {
        try { await audio.play(); } catch { /* ignore */ }
      }
      return;
    }

    if (hasSpeechSynthesis) {
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
    boardTimestampSeconds = lessonBoardTimestampSeconds.slice();
    resetBoardScroll();
    rebuildBoardSteps();
    if (!lessonSpeechTimeline) lessonSpeechTimeline = createSpeechTimeline(scriptText);
    boardTimings = buildSpeechSyncedTimings(scriptText, boardSteps, boardTimings, lessonSpeechTimeline);
    const restoredLessonTimestampSeconds = resolveTimestampSeconds(boardTimestampSeconds, boardSteps.length, estimateDurationSeconds());
    const hasLessonTimestampSeconds = restoredLessonTimestampSeconds.length === boardSteps.length && boardSteps.length > 0;
    lessonStepSyncPlan = hasLessonTimestampSeconds
      ? []
      : buildStepSyncPlan(scriptText, boardSteps, boardTimings, lessonSpeechTimeline);
    stepSyncPlan = lessonStepSyncPlan.slice();
    renderBoardTimingPlan();
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
    qaSpeechTimeline = null;
    qaSpeechProgress = 0;
    qaSpeechCharIndex = 0;
    qaHasSpeechBoundary = false;
    qaNarrationText = "";
    qaStepSyncPlan = [];
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

  function speakQaNarration(narration) {
    const text = String(narration || "").trim();
    if (!text || !hasSpeechSynthesis) return;
    qaSpeechProgress = 0;
    qaSpeechCharIndex = 0;
    qaHasSpeechBoundary = false;
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    qaUtterance = new SpeechSynthesisUtterance(text);
    qaUtterance.rate = getSpeed();
    qaUtterance.onboundary = (evt) => {
      if (!evt || !Number.isFinite(evt.charIndex) || text.length <= 0) return;
      qaHasSpeechBoundary = true;
      qaSpeechCharIndex = Math.max(qaSpeechCharIndex, Math.floor(evt.charIndex));
      qaSpeechProgress = Math.max(qaSpeechProgress, timelineProgressAtChar(qaSpeechTimeline, qaSpeechCharIndex));
    };
    qaUtterance.onend = () => {
      qaSpeechCharIndex = text.length;
      qaSpeechProgress = 1;
      qaHasSpeechBoundary = true;
      finishQa({ resumeLessonAfter: true });
    };
    qaUtterance.onerror = () => finishQa({ resumeLessonAfter: true });
    window.speechSynthesis.speak(qaUtterance);
  }

  function startQaSegment(pack) {
    const narration = (pack && pack.narration) ? String(pack.narration || "").trim() : "";
    qaNarrationText = narration;
    const audioUrl = (pack && pack.audioUrl) ? String(pack.audioUrl || "").trim() : "";
    let qaLines = Array.isArray(pack && pack.boardLines) ? pack.boardLines : [];
    qaLines = qaLines.map((s) => String(s || "").trim()).filter((s) => s.length > 0);

    let qaTimings = Array.isArray(pack && pack.boardTimings) ? pack.boardTimings : [];
    qaTimings = sanitizeTimings(qaTimings, qaLines.length);
    const qaFallbackDurationSeconds = estimateSpeechSeconds(narration, getSpeed());
    let qaTimestampSeconds = Array.isArray(pack && pack.boardTimestampSeconds) ? pack.boardTimestampSeconds : [];
    const resolvedQaTimestampSeconds = resolveTimestampSeconds(qaTimestampSeconds, qaLines.length, qaFallbackDurationSeconds);

    boardLines = qaLines;
    boardTimings = qaTimings;
    boardTimestampSeconds = qaTimestampSeconds;
    resetBoardScroll();
    rebuildBoardSteps();
    qaSpeechTimeline = createSpeechTimeline(narration);
    boardTimings = buildSpeechSyncedTimings(narration, boardSteps, boardTimings, qaSpeechTimeline);
    const hasQaTimestampSeconds = resolvedQaTimestampSeconds.length === boardSteps.length && boardSteps.length > 0;
    qaStepSyncPlan = hasQaTimestampSeconds
      ? []
      : buildStepSyncPlan(narration, boardSteps, boardTimings, qaSpeechTimeline);
    stepSyncPlan = qaStepSyncPlan.slice();
    mode = "qa";
    qaElapsedSeconds = 0;
    qaDurationSeconds = qaFallbackDurationSeconds;
    renderBoardTimingPlan();
    qaPlayStart = performance.now();
    qaIsSpeaking = true;
    qaSpeechProgress = 0;
    qaSpeechCharIndex = 0;
    qaHasSpeechBoundary = false;

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

    if (useBoundaryQaNarration(narration)) {
      speakQaNarration(narration);
      return;
    }

    if (audioUrl && typeof Audio !== "undefined") {
      qaAudio = new Audio(audioUrl);
      qaAudio.preload = "auto";
      qaAudio.playbackRate = getSpeed();
      qaAudio.addEventListener("loadedmetadata", () => {
        if (qaAudio && Number.isFinite(qaAudio.duration) && qaAudio.duration > 0)
          qaDurationSeconds = qaAudio.duration;
        renderBoardTimingPlan();
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
        if (!hasSpeechSynthesis || !narration) {
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
          manualSpeechProgress = 0;
          manualSpeechCharIndex = 0;
          manualHasSpeechBoundary = false;
        }

        speakQaNarration(narration);
      });
      return;
    }

    if (!hasSpeechSynthesis || !narration) {
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
      manualSpeechProgress = 0;
      manualSpeechCharIndex = 0;
      manualHasSpeechBoundary = false;
    }

    speakQaNarration(narration);
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

  updateFullscreenButtonLabel();
  ensureCanvasResolution(true);
  updateSpeedLabel();

  speed && speed.addEventListener("input", updateSpeedLabel);
  canvas.addEventListener("wheel", handleBoardCanvasWheel, { passive: false });
  canvas.addEventListener("pointerdown", handleBoardCanvasPointerDown);
  canvas.addEventListener("pointermove", handleBoardCanvasPointerMove);
  canvas.addEventListener("pointerup", handleBoardCanvasPointerUp);
  canvas.addEventListener("pointercancel", handleBoardCanvasPointerUp);
  canvas.addEventListener("lostpointercapture", clearScrollbarDrag);
  canvas.addEventListener("keydown", handleBoardCanvasKeydown);
  playBtn && playBtn.addEventListener("click", play);
  stopBtn && stopBtn.addEventListener("click", stop);
  exportBtn && exportBtn.addEventListener("click", exportVideo);
  fullscreenBtn && fullscreenBtn.addEventListener("click", toggleBoardFullscreen);

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
  window.addEventListener("resize", () => ensureCanvasResolution(true));
  document.addEventListener("fullscreenchange", () => {
    updateFullscreenButtonLabel();
    ensureCanvasResolution(true);
  });

  if (audio) {
    audio.addEventListener("loadedmetadata", () => {
      renderBoardTimingPlan();
    });
    audio.addEventListener("play", () => {
      if (useBoundaryLessonNarration()) return;
      if (hasSpeechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      }
      manualIsPlaying = false;
      manualIsPaused = false;
      manualPlayStart = 0;
      manualElapsedSeconds = 0;
      manualUtterance = null;
      manualSpeechProgress = 0;
      manualSpeechCharIndex = 0;
      manualHasSpeechBoundary = false;
      startLoop();
      ensureAnalyser().then(async () => {
        if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
      }).catch(() => { /* ignore */ });
    });
    audio.addEventListener("pause", () => {
      if (useBoundaryLessonNarration()) return;
      stopLoop();
    });
    audio.addEventListener("ended", () => {
      if (useBoundaryLessonNarration()) return;
      stopLoop();
    });
  } else {
    // No audio element (Stub mode): still render an idle scene.
    startLoop();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  wireFormLoadingOverlays();
  wireExplainAndVideoButtons();
  wireSpeechPlayer();
  wireAvatarVideoPlayer();
});
