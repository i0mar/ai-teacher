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
  const narrationSegmentsEl = document.getElementById("narration-segments");
  const timingPlanEl = document.getElementById("board-timing-plan");
  let boardLines = [];
  let boardTimings = [];
  let boardTimestampSeconds = [];
  let narrationSegments = [];
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
  if (narrationSegmentsEl) {
    try {
      const parsed = JSON.parse(narrationSegmentsEl.textContent || "[]");
      if (Array.isArray(parsed)) {
        narrationSegments = parsed.map((s) => String(s || "").trim()).filter((s) => s.length > 0);
      }
    } catch { /* ignore */ }
  }

  const playBtn = document.getElementById("avatar-play");
  const stopBtn = document.getElementById("avatar-stop");
  const exportBtn = document.getElementById("avatar-export");
  const askBoardBtn = document.getElementById("lesson-ask-board");
  const askQuickBtn = document.getElementById("lesson-ask-quick");
  const fullscreenBtn = document.getElementById("avatar-fullscreen");
  const qualitySelect = document.getElementById("avatar-quality");
  const understoodBtn = document.getElementById("qa-understood");
  const speed = document.getElementById("avatar-speed");
  const speedValue = document.getElementById("avatar-speed-value");

  const audio = document.getElementById("narration-audio");
  const qaAudioControl = document.getElementById("qa-narration-audio");

  const qaOverlay = document.getElementById("qa-overlay");
  const qaClose = document.getElementById("qa-close");
  const qaContinue = document.getElementById("qa-continue");
  const qaQuestion = document.getElementById("qa-question");
  const qaSubmit = document.getElementById("qa-submit");
  const qaAnswer = document.getElementById("qa-answer");
  const qaError = document.getElementById("qa-error");
  const qaBoardOverlay = document.getElementById("qa-board-overlay");
  const qaBoardClose = document.getElementById("qa-board-close");
  const qaBoardSubmit = document.getElementById("qa-board-submit");
  const qaBoardError = document.getElementById("qa-board-error");
  const questionBoardRoot = document.querySelector("[data-question-board-root]");
  const askButtons = [askBoardBtn, askQuickBtn].filter(Boolean);
  const questionBoard = questionBoardRoot && typeof window.createLessonQuestionBoardComposer === "function"
    ? window.createLessonQuestionBoardComposer({ root: questionBoardRoot })
    : null;

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
  let drawFrame = null;
  let loopStartMs = 0;
  let lastPaintAt = 0;
  let paintFallbackTimer = 0;
  let lessonSpeechTimeline = null;
  let qaSpeechTimeline = null;
  let boardTextViewport = null;
  let boardScrollRows = 0;
  let boardScrollMaxRows = 0;
  let boardScrollbarViewport = null;
  let boardScrollbarDrag = null;
  const graphUi = typeof window.createWhiteboardGraphUi === "function"
    ? window.createWhiteboardGraphUi({ canvas, stage, requestRender: refreshBoardFrame })
    : null;
  const scriptEl = document.getElementById("lesson-script");
  const scriptText = (scriptEl && scriptEl.textContent ? scriptEl.textContent : "").trim();
  const hasSpeechSynthesis = ("speechSynthesis" in window);

  function useBoundaryLessonNarration() {
    // If server narration audio exists, make it the single source of truth so
    // browser controls and the custom Play button stay in lockstep.
    return hasSpeechSynthesis && !audio && scriptText.length > 0;
  }

  function useBoundaryQaNarration(narrationText, audioUrl) {
    return hasSpeechSynthesis
      && !String(audioUrl || "").trim()
      && String(narrationText || "").trim().length > 0;
  }

  function setWhiteboardOnly() {
    whiteboardOnly = true;
  }

  setWhiteboardOnly();

  function setQaAudioControlsVisible(visible) {
    if (qaAudioControl) qaAudioControl.hidden = !visible;
    if (audio) audio.hidden = !!visible;
  }

  setQaAudioControlsVisible(false);

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
    if (graphUi && graphUi.handlePointerDown(evt)) {
      focusCanvasWithoutPageScroll();
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }

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
    if (!evt) return;
    if (boardScrollbarDrag && evt.pointerId === boardScrollbarDrag.pointerId) {
      const point = pointerToCanvasPoint(evt.clientX, evt.clientY);
      if (!point) return;

      evt.preventDefault();
      evt.stopPropagation();

      if (setBoardScrollFromScrollbarY(point.y, boardScrollbarDrag.grabOffset))
        refreshBoardFrame();
      return;
    }

    if (graphUi) graphUi.handlePointerMove(evt);
  }

  function handleBoardCanvasPointerUp(evt) {
    if (!evt || !boardScrollbarDrag || evt.pointerId !== boardScrollbarDrag.pointerId) return;
    evt.preventDefault();
    evt.stopPropagation();
    clearScrollbarDrag(evt);
  }

  function handleBoardCanvasPointerLeave() {
    if (graphUi) graphUi.handlePointerLeave();
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
    try {
      const params = new URLSearchParams(window.location.search);
      const requested = String(params.get("quality") || "").trim().toLowerCase();
      if (requested === "ultra" || requested === "hd" || requested === "standard") return requested;
    } catch { /* ignore */ }
    return "hd";
  }

  function setQualityMode(next, options) {
    const requested = String(next || "").trim().toLowerCase();
    qualityMode = (requested === "ultra" || requested === "hd" || requested === "standard")
      ? requested
      : "hd";
    if (qualitySelect) qualitySelect.value = qualityMode;

    ensureCanvasResolution(true);
  }

  function computeRenderScale() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    if (qualityMode === "ultra") return Math.min(2.4, Math.max(1.5, dpr * 1.15));
    if (qualityMode === "hd") return Math.min(2.0, Math.max(1.25, dpr));
    return Math.min(1.6, Math.max(1, dpr * 0.85));
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
    const first = out[0];
    const gaps = [];
    for (let i = 1; i < out.length; i++) {
      const gap = out[i] - out[i - 1];
      if (Number.isFinite(gap) && gap > 0.02) gaps.push(gap);
    }
    const averageGap = gaps.length > 0
      ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length
      : 0;
    const lateStartThreshold = Math.max(3.5, averageGap * 1.6, duration * 0.08);
    if (first > lateStartThreshold) {
      const span = last - first;
      if (span > 0.25) {
        const normalized = [];
        const scale = targetLast / span;
        let prev = -0.05;
        for (const raw of out) {
          const adjusted = Math.max(prev + 0.05, Math.max(0, (raw - first) * scale));
          normalized.push(adjusted);
          prev = adjusted;
        }
        return normalized;
      }
    }

    if (last <= targetLast) return out;

    const span = last - first;
    if (span <= 0) return [];

    const scale = targetLast / span;
    if (!Number.isFinite(scale) || scale <= 0) return [];

    const scaled = [];
    let prev = -0.05;
    for (const raw of out) {
      const adjusted = Math.max(prev + 0.05, Math.max(0, (raw - first) * scale));
      scaled.push(adjusted);
      prev = adjusted;
    }

    return scaled;
  }

  function resolveReliableTimestampSeconds(seconds, count, durationSeconds) {
    const out = resolveTimestampSeconds(seconds, count, durationSeconds);
    if (out.length !== count) return [];
    if (count <= 2) return out;

    const gaps = [];
    for (let i = 1; i < out.length; i++) {
      const gap = out[i] - out[i - 1];
      if (Number.isFinite(gap) && gap > 0.02) gaps.push(gap);
    }
    if (gaps.length === 0) return [];

    const sorted = gaps.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const average = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
    const maxGap = sorted[sorted.length - 1];
    const firstGap = gaps[0];
    const lastGap = gaps[gaps.length - 1];
    const duration = Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : out[out.length - 1];
    const expectedGap = duration > 0 ? duration / Math.max(1, count - 1) : average;
    const softMax = Math.max(22, average * 2.9, median * 3.2, expectedGap * 3.0);
    const boundaryMax = Math.max(18, average * 2.5, median * 2.8, expectedGap * 2.7);

    if (maxGap > softMax) return [];
    if (firstGap > boundaryMax) return [];
    if (lastGap > boundaryMax) return [];
    return out;
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

  function normalizeSyncToken(token) {
    const raw = String(token || "").toLowerCase();
    switch (raw) {
      case "sin": return "sine";
      case "cos": return "cosine";
      case "tan": return "tangent";
      case "opp": return "opposite";
      case "adj": return "adjacent";
      case "hyp": return "hypotenuse";
      case "deg": return "degree";
      default: return raw;
    }
  }

  function extractKeywords(text) {
    const stop = new Set([
      "the", "and", "then", "this", "that", "with", "from", "into", "your", "you", "our", "for", "are",
      "was", "were", "have", "has", "had", "let", "lets", "write", "draw", "step", "line", "now", "onto",
      "over", "about", "what", "when", "where", "why", "how", "all", "any", "can", "just", "than", "them"
    ]);
    const out = [];
    const seen = new Set();
    const matches = String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    for (const token of matches) {
      const normalized = normalizeSyncToken(token);
      if (normalized.length <= 1 || stop.has(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
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
      tokens.push({ word: normalizeSyncToken(m[0]), index: m.index });
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
      const normalized = normalizeSyncToken(token);
      const isNumber = /[0-9]/.test(normalized);
      if (!isNumber && normalized.length <= 1 && !keepSingles.has(normalized)) continue;
      if (stop.has(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
      if (out.length >= 8) break;
    }
    return out;
  }

  function boardLineMatchesNarrationSegment(line, segment) {
    const boardLine = String(line || "").trim();
    const narration = String(segment || "").trim();
    if (!boardLine || !narration) return false;

    const lineKeywords = extractSyncKeywords(boardLine);
    if (lineKeywords.length === 0) return false;

    const narrationKeywords = new Set(extractSyncKeywords(narration));
    let overlap = 0;
    for (const keyword of lineKeywords) {
      if (narrationKeywords.has(keyword)) overlap++;
    }

    if (/^draw\b/i.test(boardLine)) {
      const focusMatchers = [];
      if (/\bfocus\b/i.test(boardLine)) {
        if (/(?:theta|θ)\b/i.test(boardLine)) focusMatchers.push(/\b(?:theta|θ|angle)\b/i);
        if (/\bright angle\b/i.test(boardLine)) focusMatchers.push(/\b(?:right angle|90(?:-degree)?|ninety-degree)\b/i);
        if (/\bhyp(?:otenuse)?\b/i.test(boardLine)) focusMatchers.push(/\b(?:hyp|hypotenuse|longest side)\b/i);
        if (/\bopp(?:osite)?\b/i.test(boardLine)) focusMatchers.push(/\b(?:opp|opposite)\b/i);
        if (/\badj(?:acent)?\b/i.test(boardLine)) focusMatchers.push(/\b(?:adj|adjacent)\b/i);
      }

      if (focusMatchers.length > 0) {
        return focusMatchers.some((matcher) => matcher.test(narration));
      }

      return overlap >= 1 || /(triangle|graph|axes|bar|circle|diagram|picture|plot)/i.test(narration);
    }

    const requiredOverlap = lineKeywords.length >= 4 ? 2 : 1;
    return overlap >= requiredOverlap;
  }

  function hasWeakBoardNarrationAlignment(lines, segments) {
    if (!Array.isArray(lines) || !Array.isArray(segments) || lines.length === 0 || lines.length !== segments.length)
      return false;

    let aligned = 0;
    let introAligned = 0;
    const introWindow = Math.min(10, lines.length);
    for (let i = 0; i < lines.length; i++) {
      if (boardLineMatchesNarrationSegment(lines[i], segments[i])) {
        aligned++;
        if (i < introWindow) introAligned++;
      }
    }

    const alignedRatio = aligned / lines.length;
    const introRatio = introAligned / introWindow;
    return alignedRatio < 0.72 || introRatio < 0.6;
  }

  function summarizeSegmentToBoardLine(segment, index) {
    let text = String(segment || "").replace(/\s+/g, " ").trim();
    if (!text) return `Step ${index + 1}`;

    if (/right triangles are one of the fastest ways/i.test(text))
      return "Right triangles -> clean algebra";
    if (/right triangles.*pythagorean theorem/i.test(text))
      return "Right triangles + Pythagorean theorem";
    if (/pythagorean theorem connects the three side lengths/i.test(text))
      return "Pythagorean theorem: a^2 + b^2 = c^2";
    if (/draw a right triangle|right triangle.*label the legs/i.test(text))
      return "DRAW: triangle right; legs a,b; hypotenuse c";
    if (/point to the hypotenuse|focus .*hypotenuse|keep .*diagram/i.test(text))
      return "DRAW: focus hyp";
    if (/(coordinate graph|draw the axes|on the graph)/i.test(text))
      return "DRAW: axes x=-5..5 y=-5..5";
    if (/(bar chart|bar graph)/i.test(text))
      return "DRAW: bar A=2 B=5 C=3";
    if (/focus .*bar/i.test(text))
      return "DRAW: focus bar B";
    if (/(circle).*radius/i.test(text))
      return "DRAW: circle id=c1 center=(0,0) r=3";

    const exampleStart = text.search(/example\s+\d+/i);
    if (exampleStart > 0) text = text.slice(exampleStart);

    text = text.replace(/^today we(?:'re|’re| are) focusing on\s+/i, "");
    text = text.replace(/^before we move on,?\s*/i, "");
    text = text.replace(/^let['’]?s [^:]{0,30}:\s*/i, "");
    text = text.replace(/^now,?\s*/i, "");
    text = text.replace(/^notice\s+/i, "");
    text = text.replace(/^remember\s+/i, "");
    text = text.replace(/^the big idea is(?: simple)?[: ]+/i, "");
    text = text.replace(/^step\s+\d+\s*(?:is|:)?\s*/i, "");
    text = text.replace(/^to compute\s*:\s*/i, "");
    text = text.replace(/^a quick reasonableness check\s*:\s*/i, "Check: ");
    text = text.replace(/^take the square root\s*:\s*/i, "sqrt -> ");
    text = text.replace(/\bexample\s+(\d+)\b/ig, "Ex$1");
    text = text.replace(/\b([A-Za-z0-9]+)\s+squared\b/gi, "$1^2");
    text = text.replace(/\bplus\b/gi, "+");
    text = text.replace(/\bminus\b/gi, "-");
    text = text.replace(/\bequals\b/gi, "=");
    text = text.replace(/\bgreater than\b/gi, ">");
    text = text.replace(/\bless than\b/gi, "<");
    text = text.replace(/\bright angle\b/gi, "90 deg");
    text = text.replace(/\s*([=+\-<>:,;])\s*/g, " $1 ");
    text = text.replace(/\bsqrt\s*-\s*>\s*/i, "sqrt -> ");
    text = text.replace(/\s+/g, " ").trim();

    let line = text.split(/[.!?]/).map((part) => part.trim()).find(Boolean) || text;
    line = line.replace(/\bEx(\d+)\s*:/g, "Ex$1:");
    line = line.replace(/\bCheck\s*:/g, "Check:");
    return line || `Step ${index + 1}`;
  }

  function deriveBoardLinesFromNarrationSegments(segments) {
    if (!Array.isArray(segments)) return [];
    return segments
      .map((segment, index) => summarizeSegmentToBoardLine(segment, index))
      .map((line) => String(line || "").trim())
      .filter((line) => line.length > 0);
  }

  function mergeBoardLinesPreservingDraws(originalLines, repairedLines) {
    if (!Array.isArray(repairedLines) || repairedLines.length === 0) return [];

    const original = Array.isArray(originalLines) ? originalLines : [];
    const merged = [];
    for (let i = 0; i < repairedLines.length; i++) {
      const current = String(original[i] || "").trim();
      const repaired = String(repairedLines[i] || "").trim();
      if (/^draw\b/i.test(current)) {
        merged.push(current);
        continue;
      }
      merged.push(repaired || current || `Step ${i + 1}`);
    }

    return merged;
  }

  function repairStoredLessonBoardFromNarration(lines, segments) {
    const originalLines = Array.isArray(lines) ? lines : [];
    const safeSegments = Array.isArray(segments) ? segments : [];
    if (originalLines.length === 0 || safeSegments.length !== originalLines.length) return originalLines;
    if (!hasWeakBoardNarrationAlignment(originalLines, safeSegments)) return originalLines;

    const derived = deriveBoardLinesFromNarrationSegments(safeSegments);
    if (derived.length !== originalLines.length) return originalLines;

    const repaired = mergeBoardLinesPreservingDraws(originalLines, derived);
    if (repaired.length !== originalLines.length) return originalLines;
    return hasWeakBoardNarrationAlignment(repaired, safeSegments) ? originalLines : repaired;
  }

  function findNarrationBoundaryNear(text, targetIndex) {
    const src = String(text || "");
    const safeTarget = Math.max(0, Math.min(src.length, Math.floor(Number.isFinite(targetIndex) ? targetIndex : 0)));
    if (safeTarget <= 0 || safeTarget >= src.length) return safeTarget;

    const window = Math.max(24, Math.min(180, Math.floor(src.length / 8)));
    const start = Math.max(1, safeTarget - window);
    const end = Math.min(src.length - 1, safeTarget + window);
    const span = src.slice(start, end);
    const delimiters = ["\n\n", ". ", "? ", "! ", "; ", ": ", "\n", ", ", " "];
    for (const delimiter of delimiters) {
      const pivot = Math.max(0, Math.min(span.length - 1, safeTarget - start - 1));
      const beforeIdx = span.lastIndexOf(delimiter, pivot);
      if (beforeIdx >= 0)
        return start + beforeIdx + delimiter.length;
    }

    return safeTarget;
  }

  function splitNarrationEvenlyByWordsWithBounds(narration, segmentCount) {
    if (segmentCount <= 0) return [];

    const text = String(narration || "").trim();
    if (!text) return [];

    const words = [...text.matchAll(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?/g)];
    if (words.length === 0) return [];
    if (segmentCount === 1) {
      return [{
        text,
        startChar: 0,
        endChar: text.length
      }];
    }

    const boundaries = [0];
    let cursor = 0;
    for (let i = 0; i < segmentCount - 1; i++) {
      const remainingSegments = segmentCount - i;
      const remainingWords = words.length - cursor;
      const take = Math.ceil(remainingWords / Math.max(1, remainingSegments));
      cursor = Math.min(words.length - 1, cursor + take);

      const nextWordIndex = words[cursor].index;
      let boundary = findNarrationBoundaryNear(text, nextWordIndex);
      if (boundary <= boundaries[boundaries.length - 1])
        boundary = nextWordIndex;
      boundaries.push(boundary);
    }
    boundaries.push(text.length);

    const segments = [];
    for (let i = 0; i < segmentCount; i++) {
      const startChar = boundaries[i];
      let endChar = boundaries[i + 1];
      if (endChar <= startChar)
        endChar = Math.min(text.length, Math.max(startChar + 1, startChar + Math.floor(text.length / Math.max(1, segmentCount))));

      const segmentText = text.slice(startChar, Math.min(text.length, endChar)).trim();
      if (!segmentText) return [];

      segments.push({
        text: segmentText,
        startChar,
        endChar: Math.min(text.length, Math.max(startChar + 1, endChar))
      });
    }

    return segments;
  }

  function buildSegmentBoundarySyncPlan(segments, timeline) {
    if (!Array.isArray(segments) || segments.length === 0) return [];

    const speechTimeline = timeline || createSpeechTimeline("");
    const maxChars = Math.max(1, Number.isFinite(speechTimeline.length) ? speechTimeline.length : 0);

    return segments.map((segment) => {
      const startChar = Math.max(0, Math.min(maxChars, Math.floor(Number.isFinite(segment && segment.startChar) ? segment.startChar : 0)));
      let endChar = Math.max(startChar + 1, Math.min(maxChars, Math.ceil(Number.isFinite(segment && segment.endChar) ? segment.endChar : startChar + 1)));
      if (endChar <= startChar) endChar = Math.min(maxChars, startChar + 1);

      return {
        startChar,
        endChar,
        startProgress: timelineProgressAtChar(speechTimeline, startChar),
        endProgress: timelineProgressAtChar(speechTimeline, endChar),
        shouldWrite: true,
        matched: true
      };
    });
  }

  function buildSectionAnchoredSyncPlan(narration, steps, timeline) {
    const text = String(narration || "");
    const safeSteps = Array.isArray(steps) ? steps : [];
    if (!text.trim() || safeSteps.length === 0) return [];

    const anchors = [];
    let lastChar = -1;
    for (let i = 0; i < safeSteps.length; i++) {
      const step = safeSteps[i];
      if (!step || step.kind !== "text") continue;

      const raw = String(step.text || "").trim();
      const isSectionAnchor =
        /^ex(?:ample)?\s*[:#-]?\s*\d+\b/i.test(raw) ||
        /^ex\d+\b/i.test(raw) ||
        /^qc\s*[:#-]?\s*\d+\b/i.test(raw) ||
        /^qc\d+\b/i.test(raw) ||
        /^quick\s+check\s*[:#-]?\s*\d+\b/i.test(raw);
      if (!isSectionAnchor) continue;

      const anchorChar = findExplicitStepAnchorChar(text, raw);
      if (!Number.isFinite(anchorChar) || anchorChar < 0 || anchorChar <= lastChar) continue;
      anchors.push({ stepIndex: i, charIndex: anchorChar });
      lastChar = anchorChar;
    }

    if (anchors.length === 0) return [];

    const sections = [];
    if (anchors[0].stepIndex > 0 && anchors[0].charIndex > 0) {
      sections.push({
        stepStart: 0,
        stepEnd: anchors[0].stepIndex,
        charStart: 0,
        charEnd: anchors[0].charIndex
      });
    }

    for (let i = 0; i < anchors.length; i++) {
      const current = anchors[i];
      const next = anchors[i + 1];
      sections.push({
        stepStart: current.stepIndex,
        stepEnd: next ? next.stepIndex : safeSteps.length,
        charStart: current.charIndex,
        charEnd: next ? next.charIndex : text.length
      });
    }

    const segments = [];
    for (const section of sections) {
      const stepCount = Math.max(0, section.stepEnd - section.stepStart);
      const start = Math.max(0, Math.min(text.length, Math.floor(section.charStart)));
      const end = Math.max(start + 1, Math.min(text.length, Math.floor(section.charEnd)));
      if (stepCount <= 0 || end <= start) return [];

      const localSegments = splitNarrationEvenlyByWordsWithBounds(text.slice(start, end), stepCount);
      if (localSegments.length !== stepCount) return [];

      for (const local of localSegments) {
        segments.push({
          text: local.text,
          startChar: start + local.startChar,
          endChar: start + local.endChar
        });
      }
    }

    if (segments.length !== safeSteps.length) return [];
    return buildSegmentBoundarySyncPlan(segments, timeline || createSpeechTimeline(text));
  }

  function buildStoredNarrationSegmentPlan(narration, segments, timeline) {
    const safeSegments = Array.isArray(segments) ? segments : [];
    if (safeSegments.length === 0) return [];

    const src = String(narration || "");
    if (!src.trim()) return [];

    const speechTimeline = timeline || createSpeechTimeline(src);
    const normalizedNarration = normalizeForSearch(src);
    if (!normalizedNarration.normalized) return [];

    let normCursor = 0;
    const plan = [];
    for (const rawSegment of safeSegments) {
      const segmentText = String(rawSegment || "").trim();
      if (!segmentText) return [];

      const normalizedSegment = normalizeForSearch(segmentText).normalized;
      if (!normalizedSegment) return [];

      const idx = normalizedNarration.normalized.indexOf(normalizedSegment, normCursor);
      if (idx < 0) return [];

      const startMap = normalizedNarration.sourceMap[idx];
      const endMapIdx = Math.min(normalizedNarration.sourceMap.length - 1, idx + normalizedSegment.length - 1);
      const endMap = normalizedNarration.sourceMap[endMapIdx];
      if (!Number.isFinite(startMap) || !Number.isFinite(endMap)) return [];

      const startChar = Math.max(0, Math.floor(startMap));
      const endChar = Math.max(startChar + 1, Math.ceil(endMap + 1));
      plan.push({
        text: segmentText,
        startChar,
        endChar,
        startProgress: timelineProgressAtChar(speechTimeline, startChar),
        endProgress: timelineProgressAtChar(speechTimeline, endChar),
        shouldWrite: true,
        matched: true
      });

      normCursor = idx + normalizedSegment.length;
    }

    return plan;
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
    const minRequired = keywords.length >= 3 ? 2 : 1;
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

    if (first < 0 || last < 0 || foundCount < minRequired) return null;

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

  function findTokenCursorAtOrAfterChar(tokens, charIndex) {
    if (!Array.isArray(tokens) || tokens.length === 0) return 0;
    const target = Math.max(0, Math.floor(Number.isFinite(charIndex) ? charIndex : 0));
    for (let i = 0; i < tokens.length; i++) {
      if (Number.isFinite(tokens[i].index) && tokens[i].index >= target)
        return i;
    }
    return tokens.length;
  }

  function findExplicitStepAnchorChar(narration, stepText) {
    const text = String(narration || "");
    const raw = String(stepText || "").trim();
    if (!text || !raw) return -1;

    const findFirst = (patterns) => {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && Number.isFinite(match.index))
          return match.index;
      }
      return -1;
    };

    const exampleMatch =
      raw.match(/^ex(?:ample)?\s*[:#-]?\s*(\d+)\b/i) ||
      raw.match(/^ex(\d+)\b/i);
    if (exampleMatch) {
      const number = exampleMatch[1];
      return findFirst([
        new RegExp(`\\bworked\\s+example\\s+${number}\\b`, "i"),
        new RegExp(`\\bexample\\s+${number}\\b`, "i")
      ]);
    }

    const quickCheckMatch =
      raw.match(/^qc\s*[:#-]?\s*(\d+)\b/i) ||
      raw.match(/^qc(\d+)\b/i) ||
      raw.match(/^quick\s+check\s*[:#-]?\s*(\d+)\b/i);
    if (quickCheckMatch) {
      const number = quickCheckMatch[1];
      return findFirst([
        new RegExp(`\\bquick\\s+check\\s+${number}\\b`, "i"),
        new RegExp(`\\bcheck\\s+${number}\\b`, "i")
      ]);
    }

    return -1;
  }

  function isLightweightDrawCommand(command) {
    const text = String(command || "").trim().toLowerCase();
    if (!text) return false;
    if (/^focus\b/.test(text)) return true;
    if (/^(label|labels)\b/.test(text)) return true;
    if (/^(point|dot)\b/.test(text) && /\blabel\s*[:=]\s*(theta|θ)\b/i.test(text)) return true;
    return false;
  }

  function findNearbyNarrationPhrase(narration, fromChar, maxLookahead, phrases) {
    const src = String(narration || "");
    if (!src) return -1;

    const start = Math.max(0, Math.min(src.length, Math.floor(Number.isFinite(fromChar) ? fromChar : 0)));
    const end = Math.max(start, Math.min(src.length, start + Math.max(24, Math.floor(Number.isFinite(maxLookahead) ? maxLookahead : 240))));
    const span = src.slice(start, end).toLowerCase();
    if (!span) return -1;

    let best = -1;
    for (const raw of Array.isArray(phrases) ? phrases : []) {
      const phrase = String(raw || "").trim().toLowerCase();
      if (!phrase) continue;
      const idx = span.indexOf(phrase);
      if (idx < 0) continue;
      const absolute = start + idx;
      if (best < 0 || absolute < best) best = absolute;
    }

    return best;
  }

  function buildStepSyncPlan(narration, steps, timings, timeline) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    const safeTimings = sanitizeTimings(timings, safeSteps.length);
    if (safeSteps.length === 0) return [];
    const timingsLookGeneric = looksEvenlySpaced(safeTimings);

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
      const isLightweightDraw = step.kind === "draw" && isLightweightDrawCommand(step.command);
      const startAt = safeTimings[i];
      const endAt = (i + 1 < safeTimings.length) ? safeTimings[i + 1] : 1.0;

      const timingStartChar = timelineCharAtProgress(speechTimeline, startAt);
      const timingEndChar = timelineCharAtProgress(speechTimeline, endAt);
      let startChar = timingStartChar;
      let endChar = timingEndChar;
      let shouldWrite = true;
      let matched = false;
      let matchedCursor = tokenCursor;

      if (step.kind === "text") {
        const textLine = String(step.text || "").trim();
        if (hasNarration && textLine) {
          const explicitAnchorChar = findExplicitStepAnchorChar(text, textLine);
          const explicitAnchorCursor = explicitAnchorChar >= 0
            ? findTokenCursorAtOrAfterChar(tokens, explicitAnchorChar)
            : tokenCursor;
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
                matchedCursor = findTokenCursorAtOrAfterChar(tokens, endChar);
              }
            }
          }

          if (!matched) {
            const keywords = extractSyncKeywords(textLine);
            const window = findKeywordWindow(tokens, keywords, explicitAnchorCursor);
            if (window) {
              startChar = explicitAnchorChar >= 0
                ? Math.min(explicitAnchorChar, window.startChar)
                : window.startChar;
              endChar = Math.max(window.endChar, startChar + 1);
              matchedCursor = Math.max(tokenCursor, window.nextTokenCursor, explicitAnchorCursor);
              matched = true;
            }
          }

          if (!matched && explicitAnchorChar >= 0) {
            startChar = explicitAnchorChar;
            endChar = Math.max(startChar + 1, Math.min(maxChars, startChar + Math.max(18, Math.floor(textLine.length * 0.8))));
            matchedCursor = Math.max(tokenCursor, explicitAnchorCursor);
            matched = true;
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
        if (isLightweightDraw) {
          const lowerCommand = String(step.command || "").toLowerCase();
          const phrases = [];
          if (/(theta|θ)/.test(lowerCommand)) phrases.push("theta", "θ");
          if (lowerCommand.includes("right angle")) phrases.push("right angle");
          if (lowerCommand.includes("hypotenuse") || /\bhyp\b/.test(lowerCommand)) phrases.push("hypotenuse");
          if (/(opposite|\bopp\b)/.test(lowerCommand)) phrases.push("opposite");
          if (/(adjacent|\badj\b)/.test(lowerCommand)) phrases.push("adjacent");

          const localChar = findNearbyNarrationPhrase(text, prevStart, 320, phrases);
          const lightweightGap = Math.max(8, Math.floor(maxChars * 0.003));
          startChar = localChar >= 0
            ? localChar
            : Math.min(maxChars - 1, prevStart + lightweightGap);
          endChar = Math.max(startChar + 1, Math.min(maxChars, startChar + 16));
          matchedCursor = localChar >= 0
            ? findTokenCursorAtOrAfterChar(tokens, startChar + 1)
            : tokenCursor;
          matched = localChar >= 0;
        } else {
          const drawKeywords = extractSyncKeywords(step.command);
          const drawWindow = findKeywordWindow(tokens, drawKeywords, tokenCursor);
          if (drawWindow) {
            const cueNearDraw = findCueBeforeChar(tokens, drawWindow.startChar, 42);
            startChar = cueNearDraw >= 0 ? cueNearDraw : drawWindow.startChar;
            endChar = Math.max(drawWindow.endChar, startChar + 1);
            matchedCursor = drawWindow.nextTokenCursor;
            matched = true;
          } else {
            // If we can't match draw details exactly, align to cue words near its planned timing.
            const cueNearTiming = findCueBeforeChar(tokens, startChar, 120);
            if (cueNearTiming >= 0) startChar = cueNearTiming;
          }
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

      // When timings are generic/evenly spaced, let text matching lead.
      if (!timingsLookGeneric) {
        const startWindowBefore = step.kind === "draw" ? 18 : 30;
        const startWindowAfter = step.kind === "draw" ? 52 : 72;
        const minStartWindow = Math.max(0, timingStartChar - startWindowBefore);
        const maxStartWindow = Math.min(maxChars, timingStartChar + startWindowAfter);
        if (maxStartWindow >= minStartWindow)
          startChar = Math.max(minStartWindow, Math.min(maxStartWindow, startChar));
      }

      if (startChar <= prevStart) startChar = Math.min(maxChars, prevStart + 1);

      const textLen = step.kind === "text" ? Math.max(1, String(step.text || "").length) : 0;
      const dynamicTextMinSpanChars = Math.max(4, Math.min(22, Math.floor(textLen * 0.45)));
      const dynamicTextMaxSpanChars = Math.max(dynamicTextMinSpanChars + 4, Math.min(54, Math.floor(textLen * 1.8)));
      const minSpan = step.kind === "draw" ? drawMinSpanChars : dynamicTextMinSpanChars;
      if (endChar < startChar + minSpan)
        endChar = startChar + minSpan;

      if (!timingsLookGeneric) {
        const endWindowBefore = step.kind === "draw" ? 10 : 16;
        const endWindowAfter = step.kind === "draw" ? 58 : 96;
        const minEndWindow = Math.max(startChar + 1, timingEndChar - endWindowBefore);
        const maxEndWindow = Math.min(maxChars, timingEndChar + endWindowAfter);
        if (maxEndWindow >= minEndWindow)
          endChar = Math.max(minEndWindow, Math.min(maxEndWindow, endChar));
      }

      if (step.kind === "draw" && endChar > startChar + drawMaxSpanChars)
        endChar = startChar + drawMaxSpanChars;
      if (isLightweightDraw && endChar > startChar + 18)
        endChar = startChar + 18;
      if (step.kind === "text" && endChar > startChar + dynamicTextMaxSpanChars)
        endChar = startChar + dynamicTextMaxSpanChars;

      if (endChar > maxChars) endChar = maxChars;
      if (endChar <= startChar) endChar = Math.min(maxChars, startChar + 1);
      if (endChar <= startChar) startChar = Math.max(0, endChar - 1);

      prevStart = Math.max(prevStart, startChar);
      if (matched) {
        const endCursor = findTokenCursorAtOrAfterChar(tokens, endChar);
        tokenCursor = isLightweightDraw
          ? Math.max(tokenCursor, matchedCursor)
          : Math.max(tokenCursor, matchedCursor, endCursor);
      }

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
      const explicitAnchorChar = findExplicitStepAnchorChar(text, raw);
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
      if (explicitAnchorChar >= 0) {
        charPos = explicitAnchorChar;
        searchStart = Math.max(searchStart + 1, findTokenCursorAtOrAfterChar(tokens, explicitAnchorChar));
      } else if (foundToken >= 0) {
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

  function resolveEffectiveTimestampSeconds(rawSeconds, steps, durationSeconds, syncPlan) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    const count = safeSteps.length;
    const timestampSeconds = resolveReliableTimestampSeconds(rawSeconds, count, durationSeconds);
    if (timestampSeconds.length !== count) return [];

    const plan = (Array.isArray(syncPlan) && syncPlan.length === count) ? syncPlan : null;
    if (!plan || count < 8) return timestampSeconds;
    if (looksEvenlySpaced(timestampSeconds)) return [];

    const comparisons = [];
    let matchedCount = 0;
    for (let i = 0; i < count; i++) {
      const step = safeSteps[i];
      const sync = plan[i];
      if (!step || !sync || step.kind !== "text") continue;
      if (!sync.matched || !Number.isFinite(sync.startProgress)) continue;
      matchedCount++;

      const timestampProgress = durationSeconds > 0
        ? clamp01(timestampSeconds[i] / durationSeconds)
        : 0;
      comparisons.push(Math.abs(timestampProgress - clamp01(sync.startProgress)));
    }

    const requiredMatches = Math.max(5, Math.floor(count * 0.2));
    if (matchedCount < requiredMatches || comparisons.length < requiredMatches)
      return timestampSeconds;

    const sorted = comparisons.slice().sort((a, b) => a - b);
    const average = comparisons.reduce((sum, value) => sum + value, 0) / comparisons.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)] || sorted[sorted.length - 1];

    // If the stored timestamps disagree with strong text matches, trust the text plan.
    if (average > 0.07 || median > 0.06 || p90 > 0.16)
      return [];

    return timestampSeconds;
  }

  lessonSpeechTimeline = createSpeechTimeline(scriptText);
  boardLines = repairStoredLessonBoardFromNarration(boardLines, narrationSegments);
  const hasStoredNarrationAlignmentIssue =
    narrationSegments.length === boardLines.length &&
    hasWeakBoardNarrationAlignment(boardLines, narrationSegments);
  const usableNarrationSegments = hasStoredNarrationAlignmentIssue ? [] : narrationSegments;

  if (hasStoredNarrationAlignmentIssue)
    boardTimestampSeconds = [];

  rebuildBoardSteps();
  boardTimings = sanitizeTimings(boardTimings, boardSteps.length);
  const storedLessonSegmentPlan =
    usableNarrationSegments.length === boardSteps.length && scriptText.length > 0
      ? buildStoredNarrationSegmentPlan(scriptText, usableNarrationSegments, lessonSpeechTimeline)
      : [];
  const sectionAnchoredLessonPlan =
    usableNarrationSegments.length === 0 && scriptText.length > 0
      ? buildSectionAnchoredSyncPlan(scriptText, boardSteps, lessonSpeechTimeline)
      : [];
  if (storedLessonSegmentPlan.length === boardSteps.length) {
    boardTimings = storedLessonSegmentPlan.map((segment) => clamp01(segment.startProgress));
    lessonStepSyncPlan = storedLessonSegmentPlan.slice();
  } else {
    const seedLessonTimings = sectionAnchoredLessonPlan.length === boardSteps.length
      ? sectionAnchoredLessonPlan.map((segment) => clamp01(segment.startProgress))
      : boardTimings;
    boardTimings = buildSpeechSyncedTimings(scriptText, boardSteps, seedLessonTimings, lessonSpeechTimeline);
    lessonStepSyncPlan = buildStepSyncPlan(scriptText, boardSteps, boardTimings, lessonSpeechTimeline);
  }
  stepSyncPlan = lessonStepSyncPlan.slice();
  lessonBoardLines = Array.isArray(boardLines) ? boardLines.slice() : [];
  lessonBoardTimings = Array.isArray(boardTimings) ? boardTimings.slice() : [];
  lessonBoardTimestampSeconds = Array.isArray(boardTimestampSeconds) ? boardTimestampSeconds.slice() : [];
  renderBoardTimingPlan();

  function estimateDurationSeconds() {
    const text = String(scriptText || "").trim();
    if (!text) return 90;

    const wordCount = (text.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?/g) || []).length;
    const byWords = wordCount > 0 ? wordCount / (145 / 60) : 0;
    const byChars = text.length / 13;
    const pauseCount = (text.match(/[.!?;:]/g) || []).length;
    const estimate = Math.max(byWords, byChars * 0.9) + (pauseCount * 0.18);
    return Math.max(45, Math.min(1200, estimate));
  }

  function smoothActiveReveal(rawProgress, step) {
    const progress = clamp01(rawProgress);
    if (!step) return progress;

    const isText = step.kind === "text";
    const textLength = isText ? String(step.text || "").trim().length : 0;
    const longTextFactor = isText ? clamp01((textLength - 52) / 140) : 0;
    const completionWindow = isText
      ? (0.82 - (longTextFactor * 0.24))
      : 0.86;
    const accelerated = clamp01(progress / completionWindow);
    const eased = 1 - Math.pow(1 - accelerated, isText ? (1.18 + (longTextFactor * 0.28)) : 1.14);
    return clamp01(eased);
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

  function splitBoardTokenToFit(context, token, maxWidth) {
    const text = String(token || "");
    if (!text) return [""];

    const safeWidth = Math.max(40, Number.isFinite(maxWidth) ? maxWidth : 120);
    const pieces = [];
    let remaining = text;
    while (remaining.length > 0) {
      let end = remaining.length;
      while (end > 1 && context.measureText(remaining.slice(0, end)).width > safeWidth)
        end--;
      pieces.push(remaining.slice(0, Math.max(1, end)));
      remaining = remaining.slice(Math.max(1, end));
    }

    return pieces.length > 0 ? pieces : [text];
  }

  function wrapBoardTextRows(context, text, maxWidth) {
    const src = String(text || "").replace(/\s+/g, " ").trim();
    if (!src) return [""];

    const safeWidth = Math.max(40, Number.isFinite(maxWidth) ? maxWidth : 120);
    const words = src.split(" ");
    const rows = [];
    let current = "";

    const pushCurrent = () => {
      if (current.trim()) {
        rows.push(current.trim());
        current = "";
      }
    };

    for (const word of words) {
      if (!word) continue;
      const candidate = current ? `${current} ${word}` : word;
      if (context.measureText(candidate).width <= safeWidth) {
        current = candidate;
        continue;
      }

      if (current) pushCurrent();

      if (context.measureText(word).width <= safeWidth) {
        current = word;
        continue;
      }

      const pieces = splitBoardTokenToFit(context, word, safeWidth);
      for (let i = 0; i < pieces.length - 1; i++) {
        if (pieces[i]) rows.push(pieces[i]);
      }
      current = pieces[pieces.length - 1] || "";
    }

    pushCurrent();
    return rows.length > 0 ? rows : [src];
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
    const timestampSeconds = resolveEffectiveTimestampSeconds(boardTimestampSeconds, steps, sourceDuration, stepSyncPlan);
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
    loopStartMs = start;

    const draw = (t) => {
      drawFrame = draw;
      raf = requestAnimationFrame(draw);
      const elapsed = (t - start) / 1000;
      const frameNow = Number.isFinite(t) ? t : performance.now();
      lastPaintAt = frameNow;

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
      const syncPlan = (Array.isArray(stepSyncPlan) && stepSyncPlan.length === steps.length) ? stepSyncPlan : null;
      const timestampSecondsRaw = resolveEffectiveTimestampSeconds(boardTimestampSeconds, steps, playbackDuration, syncPlan);
      const timestampSeconds = timestampSecondsRaw.length === steps.length ? timestampSecondsRaw : null;
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

      function canonicalizeDrawCommand(raw) {
        const text = normalizeDrawText(raw).trim();
        if (!text) return "";

        const looksLikeTrigTriangle = (value) => /\b(?:theta|acute angle|opp(?:osite)?|adj(?:acent)?|hyp(?:otenuse)?)\b|θ/i.test(value);
        const hasExplicitTriangleLabels = (value) =>
          /\blegs?\s*[:=]?\s*[^\s,;/]+\s*[,/]\s*[^\s,;/]+/i.test(value)
          || /\bhyp(?:otenuse)?\s*[:=]?\s*[^\s,;]+/i.test(value);
        const hasCircleGeometry = (value) =>
          /\b(?:center|radius|r|start|end|from|to)\s*[:=]/i.test(value)
          || /\(\s*[^,]+\s*,\s*[^)]+\s*\)/.test(value);
        const canonicalTrigTriangle = (value, fallback) => {
          if (looksLikeTrigTriangle(value) && !hasExplicitTriangleLabels(value))
            return "triangle right; legs opp,adj; hypotenuse hyp; angle θ";
          return fallback;
        };
        const canonicalTrigFocus = (value) => {
          if (!looksLikeTrigTriangle(value)) return "";
          if (/\bright\s+angle\b/i.test(value)) return "focus triangle right angle";
          if (/\bhyp(?:otenuse)?\b/i.test(value)) return "focus triangle hyp";
          if (/\bopp(?:osite)?\b/i.test(value)) return "focus triangle opp";
          if (/\badj(?:acent)?\b/i.test(value)) return "focus triangle adj";
          if (/\btheta\b|θ/i.test(value)) return "focus triangle theta";
          return "";
        };

        const lower = text.toLowerCase();
        const rightTriangle = text.match(/^right\s+triangle\b(.*)$/i);
        if (rightTriangle) {
          const suffix = String(rightTriangle[1] || "").trim().replace(/^[:;\-]\s*/, "");
          return canonicalTrigTriangle(
            text,
            suffix
              ? `triangle right; ${suffix}`
              : "triangle right; legs a,b; hypotenuse c"
          );
        }

        const triangleRight = text.match(/^triangle\s+right\b(.*)$/i);
        if (triangleRight) {
          const suffix = String(triangleRight[1] || "").trim().replace(/^[:;\-]\s*/, "");
          return canonicalTrigTriangle(
            text,
            suffix
              ? `triangle right; ${suffix}`
              : "triangle right; legs a,b; hypotenuse c"
          );
        }

        if (/^(triangle)\s*$/i.test(text))
          return "triangle right; legs a,b; hypotenuse c";
        if (/^(graph|coordinate graph|coordinate plane|plane|grid|axes)\s*$/i.test(text))
          return "axes x=-5..5 y=-5..5";
        if (/^(bar chart|bar graph)\s*$/i.test(text))
          return "bar A=2 B=5 C=3";
        if (/^focus\s+hyp(?:otenuse)?\s*$/i.test(text))
          return "focus triangle hyp";
        if (/^focus\s+right\s+angle\s*$/i.test(text))
          return "focus triangle right angle";
        if (/^focus\s+right\s+angle(?:\s+box)?\s*$/i.test(text))
          return "focus triangle right angle";
        if (/^focus\s+opp(?:osite)?\s*$/i.test(text))
          return "focus triangle opp";
        if (/^focus\s+adj(?:acent)?\s*$/i.test(text))
          return "focus triangle adj";
        if (/^(?:highlight|circle)\b.*\bhyp(?:otenuse)?\b/i.test(text))
          return "focus triangle hyp";
        if (/^highlight\b.*\bright\s+angle\b/i.test(text))
          return "focus triangle right angle";
        if (/^label\s+sides?\s+relative\s+to\s+theta\b/i.test(text))
          return "triangle right; legs opp,adj; hypotenuse hyp; angle θ";
        if (/^circle\b/i.test(text) && !hasCircleGeometry(text)) {
          const trigFocus = canonicalTrigFocus(text);
          if (trigFocus) return trigFocus;
        }

        return lower === "right triangle"
          ? "triangle right; legs a,b; hypotenuse c"
          : text;
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

        const formatAxisValue = (value) => {
          const safe = Math.abs(value) < 1e-9 ? 0 : value;
          if (Math.abs(safe - Math.round(safe)) < 1e-9) return String(Math.round(safe));
          if (Math.abs(safe * 10 - Math.round(safe * 10)) < 1e-9) return String(Math.round(safe * 10) / 10);
          return String(Math.round(safe * 100) / 100);
        };
        const xLabelsBelow = xAxisY <= area.y + area.h - 38;
        const yLabelsLeft = yAxisX >= area.x + 38;
        const xTickLabelY = xLabelsBelow ? xAxisY + 8 : xAxisY - 8;
        const yTickLabelX = yLabelsLeft ? yAxisX - 8 : yAxisX + 8;

        c.save();
        c.strokeStyle = "rgba(17,24,39,0.42)";
        c.lineWidth = 1.25;
        c.beginPath();
        for (let x = Math.ceil(xmin / xStep) * xStep; x <= xmax; x += xStep) {
          const px = mapX(x);
          c.moveTo(px, xAxisY - 5);
          c.lineTo(px, xAxisY + 5);
        }
        for (let y = Math.ceil(ymin / yStep) * yStep; y <= ymax; y += yStep) {
          const py = mapY(y);
          c.moveTo(yAxisX - 5, py);
          c.lineTo(yAxisX + 5, py);
        }
        c.stroke();

        c.fillStyle = "rgba(17,24,39,0.72)";
        c.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
        c.textAlign = "center";
        c.textBaseline = xLabelsBelow ? "top" : "bottom";
        for (let x = Math.ceil(xmin / xStep) * xStep; x <= xmax; x += xStep) {
          const px = mapX(x);
          c.fillText(formatAxisValue(x), px, xTickLabelY);
        }

        c.textAlign = yLabelsLeft ? "right" : "left";
        c.textBaseline = "middle";
        for (let y = Math.ceil(ymin / yStep) * yStep; y <= ymax; y += yStep) {
          if (Math.abs(y) < 1e-9 && ymin <= 0 && ymax >= 0) continue;
          const py = mapY(y);
          c.fillText(formatAxisValue(y), yTickLabelX, py);
        }
        c.restore();

        c.fillStyle = "rgba(17,24,39,0.70)";
        c.font = "16px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
        c.textAlign = "right";
        c.textBaseline = xLabelsBelow ? "bottom" : "top";
        c.fillText("x", area.x + area.w - 12, xLabelsBelow ? xAxisY - 8 : xAxisY + 8);
        c.textAlign = yLabelsLeft ? "left" : "right";
        c.textBaseline = "top";
        c.fillText("y", yLabelsLeft ? yAxisX + 8 : yAxisX - 8, area.y + 12);
        c.restore();

        return { mapX, mapY };
      }

      function renderDiagram(c, area, stepsArr, activeIdx, activeT, now) {
        if (!area) return { penX: null, penY: null, scene: null };

        const bgPad = 10;
        const bg = { x: area.x - bgPad, y: area.y - bgPad, w: area.w + bgPad * 2, h: area.h + bgPad * 2 };
        const sceneItems = [];
        const sceneCounts = { axes: 0, line: 0, point: 0, circle: 0, square: 0, triangle: 0, bar: 0 };

        function formatSceneNumber(value) {
          if (!Number.isFinite(value)) return "0";
          const rounded = Math.round(value * 10) / 10;
          return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
        }

        function formatLineTitle(expr) {
          if (!expr) return "Line";
          if (expr.kind === "vertical") return `x = ${formatSceneNumber(expr.x)}`;
          const slope = formatSceneNumber(expr.m);
          const intercept = formatSceneNumber(Math.abs(expr.b));
          const sign = expr.b >= 0 ? "+" : "-";
          return `y = ${slope}x ${sign} ${intercept}`;
        }

        function formatLineDetail(expr) {
          if (!expr) return "Interactive line";
          if (expr.kind === "vertical") return `Vertical line through x = ${formatSceneNumber(expr.x)}`;
          return `Slope ${formatSceneNumber(expr.m)} and intercept ${formatSceneNumber(expr.b)}`;
        }

        function registerSceneItem(item) {
          if (!item || !item.id || !item.hit) return;
          sceneItems.push(item);
        }

        function resetLayer() {
          const pulse = 0.5 + (0.5 * Math.sin((Number.isFinite(now) ? now : performance.now()) / 880));
          c.save();
          c.clearRect(bg.x, bg.y, bg.w, bg.h);
          c.fillStyle = "rgba(255,255,255,0.92)";
          roundedRectPath(c, bg.x, bg.y, bg.w, bg.h, 14);
          c.fill();
          const wash = c.createLinearGradient(area.x, area.y, area.x + area.w, area.y + area.h);
          wash.addColorStop(0, `rgba(124,58,237,${0.06 + (pulse * 0.04)})`);
          wash.addColorStop(1, `rgba(34,197,94,${0.04 + ((1 - pulse) * 0.04)})`);
          c.fillStyle = wash;
          roundedRectPath(c, bg.x, bg.y, bg.w, bg.h, 14);
          c.fill();
          c.strokeStyle = "rgba(17,24,39,0.10)";
          c.lineWidth = 2;
          roundedRectPath(c, bg.x, bg.y, bg.w, bg.h, 14);
          c.stroke();
          c.restore();
        }

        function clipSegmentToBounds(x1, y1, x2, y2, bounds) {
          const dx = x2 - x1;
          const dy = y2 - y1;
          let t0 = 0;
          let t1 = 1;

          const edges = [
            { p: -dx, q: x1 - bounds.left },
            { p: dx, q: bounds.right - x1 },
            { p: -dy, q: y1 - bounds.top },
            { p: dy, q: bounds.bottom - y1 }
          ];

          for (const edge of edges) {
            if (Math.abs(edge.p) < 1e-6) {
              if (edge.q < 0) return null;
              continue;
            }

            const ratio = edge.q / edge.p;
            if (edge.p < 0) {
              if (ratio > t1) return null;
              if (ratio > t0) t0 = ratio;
            } else {
              if (ratio < t0) return null;
              if (ratio < t1) t1 = ratio;
            }
          }

          return {
            x1: x1 + dx * t0,
            y1: y1 + dy * t0,
            x2: x1 + dx * t1,
            y2: y1 + dy * t1
          };
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
            this.viewport = {
              x: area.x + 10,
              y: area.y + 10,
              w: Math.max(10, area.w - 20),
              h: Math.max(10, area.h - 20)
            };
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
            this.segment = null;
            this.anchor = null;
            const m = getMapper(this.axesId);
            if (!m || !this.expr) return;
            const t = this.progress;
            const bounds = {
              left: area.x + 14,
              right: area.x + area.w - 14,
              top: area.y + 14,
              bottom: area.y + area.h - 14
            };
            c2.save();
            c2.lineCap = "round";
            c2.lineJoin = "round";
            c2.strokeStyle = "rgba(124,58,237,0.95)";
            c2.lineWidth = 4;
            if (this.expr.kind === "vertical") {
              const x = m.mapX(this.expr.x);
              if (x < bounds.left || x > bounds.right) {
                c2.restore();
                return;
              }
              const y1 = bounds.top;
              const y2 = bounds.bottom;
              const yy = y1 + (y2 - y1) * t;
              c2.beginPath();
              c2.moveTo(x, y1);
              c2.lineTo(x, yy);
              c2.stroke();
              this.anchor = { x, y: yy };
              this.segment = { x1: x, y1, x2: x, y2: yy };
            } else {
              const x1m = axesRange.xmin;
              const x2m = axesRange.xmax;
              const y1m = this.expr.m * x1m + this.expr.b;
              const y2m = this.expr.m * x2m + this.expr.b;
              const clipped = clipSegmentToBounds(
                m.mapX(x1m),
                m.mapY(y1m),
                m.mapX(x2m),
                m.mapY(y2m),
                bounds
              );
              if (!clipped) {
                c2.restore();
                return;
              }
              const x = clipped.x1 + (clipped.x2 - clipped.x1) * t;
              const y = clipped.y1 + (clipped.y2 - clipped.y1) * t;
              c2.beginPath();
              c2.moveTo(clipped.x1, clipped.y1);
              c2.lineTo(x, y);
              c2.stroke();
              this.anchor = { x, y };
              this.segment = { x1: clipped.x1, y1: clipped.y1, x2: x, y2: y };
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
            this.pixelPoint = null;
            this.anchor = null;
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
            this.pixelPoint = { x, y, radius: 12 };
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
            this.pixelCircle = null;
            this.anchor = null;
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
            this.pixelCircle = { x: cx, y: cy, radius: r };
          }
          focus(c2, strength, which) {
            if (!this.pixelCircle) return false;
            const q = String(which || "").toLowerCase().trim();
            const circle = this.pixelCircle;
            if (q.includes("center")) return { x: circle.x, y: circle.y };
            if (q.includes("radius") || q.includes("edge") || q.includes("rim")) {
              return { x: circle.x + circle.radius, y: circle.y };
            }
            return { x: circle.x, y: circle.y };
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
            this.pixelPolygon = null;
            this.anchor = null;
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
            this.pixelPolygon = pts;
          }
          focus(c2, strength, which) {
            if (!Array.isArray(this.pixelPolygon) || this.pixelPolygon.length !== 4) return false;
            const q = String(which || "").toLowerCase().trim();
            const pts = this.pixelPolygon;
            const center = pts.reduce((acc, pt) => ({ x: acc.x + pt.x / pts.length, y: acc.y + pt.y / pts.length }), { x: 0, y: 0 });
            const edgeMidpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

            const pickCorner = () => {
              if (q.includes("top") && q.includes("left")) return pts.reduce((best, pt) => (pt.x + pt.y < best.x + best.y ? pt : best), pts[0]);
              if (q.includes("top") && q.includes("right")) return pts.reduce((best, pt) => (pt.x - pt.y > best.x - best.y ? pt : best), pts[0]);
              if (q.includes("bottom") && q.includes("right")) return pts.reduce((best, pt) => (pt.x + pt.y > best.x + best.y ? pt : best), pts[0]);
              if (q.includes("bottom") && q.includes("left")) return pts.reduce((best, pt) => (pt.y - pt.x > best.y - best.x ? pt : best), pts[0]);
              return pts.reduce((best, pt) => (pt.x - pt.y > best.x - best.y ? pt : best), pts[0]);
            };

            const pickEdge = () => {
              const top = edgeMidpoint(pts[0], pts[1]);
              const right = edgeMidpoint(pts[1], pts[2]);
              const bottom = edgeMidpoint(pts[2], pts[3]);
              const left = edgeMidpoint(pts[3], pts[0]);
              if (q.includes("top")) return top;
              if (q.includes("right")) return right;
              if (q.includes("bottom")) return bottom;
              if (q.includes("left")) return left;
              return right;
            };

            if (q.includes("center")) return center;
            if (q.includes("corner") || q.includes("vertex")) return pickCorner();
            if (q.includes("side") || q.includes("edge")) return pickEdge();

            return center;
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
            this.angleLabel = null;
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
          setAngleLabel(label) {
            const next = String(label || "").trim();
            this.angleLabel = next || null;
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
            this.layout = null;
            this.pixelPolygon = null;
            this.anchor = null;
            const pad = 22;
            const maxW = area.w - pad * 2;
            const maxH = area.h - pad * 2;

            let base = this.a;
            let height = this.b;
            let apexX = base;
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
                apexX = Math.max(0.2, Math.min(base - 0.2, x));
                height = Math.max(0.5, y);
              }
            }

            const scale = Math.max(1e-6, Math.min(maxW / base, maxH / height) * 0.82);
            const x0 = area.x + pad;
            const y0 = area.y + area.h - pad;
            const p0 = { x: x0, y: y0 };
            const p1 = { x: x0 + base * scale, y: y0 };
            const p2 = { x: x0 + apexX * scale, y: y0 - height * scale };
            const centroid = {
              x: (p0.x + p1.x + p2.x) / 3,
              y: (p0.y + p1.y + p2.y) / 3
            };
            const clampLabelPoint = (point, margin = 22) => ({
              x: Math.max(area.x + margin, Math.min(area.x + area.w - margin, point.x)),
              y: Math.max(area.y + margin, Math.min(area.y + area.h - margin, point.y))
            });
            const placeSegmentLabel = (from, to, distance, preferOutside, along = 0.5) => {
              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const len = Math.max(1e-6, Math.hypot(dx, dy));
              let nx = -dy / len;
              let ny = dx / len;
              const t = Math.max(0.2, Math.min(0.8, along));
              const mx = from.x + dx * t;
              const my = from.y + dy * t;
              const centroidDot = (centroid.x - mx) * nx + (centroid.y - my) * ny;
              if ((preferOutside && centroidDot > 0) || (!preferOutside && centroidDot < 0)) {
                nx *= -1;
                ny *= -1;
              }

              const point = clampLabelPoint({
                x: mx + nx * distance,
                y: my + ny * distance
              });
              return { x: point.x, y: point.y, nx, ny };
            };
            const placeAngleLabel = (vertex, armA, armB, distance, preferOutside = false) => {
              const v1x = armA.x - vertex.x;
              const v1y = armA.y - vertex.y;
              const v2x = armB.x - vertex.x;
              const v2y = armB.y - vertex.y;
              const l1 = Math.max(1e-6, Math.hypot(v1x, v1y));
              const l2 = Math.max(1e-6, Math.hypot(v2x, v2y));
              let bx = (v1x / l1) + (v2x / l2);
              let by = (v1y / l1) + (v2y / l2);
              const bl = Math.hypot(bx, by);
              if (bl < 1e-6) {
                bx = 1;
                by = -1;
              } else {
                bx /= bl;
                by /= bl;
              }

              const centroidDot = (centroid.x - vertex.x) * bx + (centroid.y - vertex.y) * by;
              if ((preferOutside && centroidDot > 0) || (!preferOutside && centroidDot < 0)) {
                bx *= -1;
                by *= -1;
              }

              const point = clampLabelPoint({
                x: vertex.x + bx * distance,
                y: vertex.y + by * distance
              }, 28);
              return { x: point.x, y: point.y, nx: bx, ny: by };
            };
            const drawLabel = (text, anchor) => {
              if (!text || !anchor) return;
              let align = anchor.align || "center";
              let baseline = anchor.baseline || "middle";
              if (!anchor.align) {
                if (anchor.nx > 0.18) align = "left";
                else if (anchor.nx < -0.18) align = "right";
              }
              if (!anchor.baseline) {
                if (anchor.ny > 0.18) baseline = "top";
                else if (anchor.ny < -0.18) baseline = "bottom";
              }
              c2.textAlign = align;
              c2.textBaseline = baseline;
              c2.fillText(String(text), anchor.x, anchor.y, maxW);
            };
            const labelScale = Math.min(base * scale, height * scale);
            const baseLabelDistance = Math.max(12, Math.min(18, labelScale * 0.07));
            const heightLabelDistance = Math.max(16, Math.min(24, labelScale * 0.08));
            const hypLabelDistance = Math.max(16, Math.min(22, labelScale * 0.08));
            const angleLabelDistance = Math.max(34, Math.min(48, labelScale * 0.22));
            const labelAnchors = {
              base: { ...placeSegmentLabel(p0, p1, baseLabelDistance, true, 0.56), align: "center", baseline: "top" },
              height: { ...placeSegmentLabel(p1, p2, heightLabelDistance, true, 0.5), align: "left", baseline: "middle" },
              hyp: { ...placeSegmentLabel(p2, p0, hypLabelDistance, true, 0.5), align: "center", baseline: "middle" },
              angle: { ...placeAngleLabel(p0, p1, p2, angleLabelDistance, false), align: "center", baseline: "middle" }
            };
            this.layout = { p0, p1, p2, labelAnchors };
            this.pixelPolygon = [p0, p1, p2];

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
              drawLabel(this.labels.base || "a", labelAnchors.base);
              drawLabel(this.labels.height || "b", labelAnchors.height);
              if (this.labels.hyp) drawLabel(this.labels.hyp, labelAnchors.hyp);
              if (this.angleLabel) drawLabel(this.angleLabel, labelAnchors.angle);
              c2.restore();
            }
          }
          focus(c2, strength, which) {
            if (!this.layout) return false;
            const q = String(which || "").toLowerCase().trim();
            const p0 = this.layout.p0;
            const p1 = this.layout.p1;
            const p2 = this.layout.p2;
            const angleAnchor = (this.layout.labelAnchors && this.layout.labelAnchors.angle)
              ? this.layout.labelAnchors.angle
              : { x: p0.x + 22, y: p0.y - 22 };

            if (/(theta|θ)/.test(q)) {
              return { x: angleAnchor.x, y: angleAnchor.y };
            }

            if (q.includes("right") || q.includes("90") || q.includes("box") || q.includes("square")) {
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

            if (q.includes("angle") || q.includes("corner") || q.includes("vertex")) {
              return { x: angleAnchor.x, y: angleAnchor.y };
            }

            let a = p2;
            let b = p0;
            if (q.includes("base") || q === "a" || q.includes("leg a") || q.includes("leg1") || q.includes("adj") || q.includes("adjacent")) { a = p0; b = p1; }
            else if (q.includes("height") || q === "b" || q.includes("leg b") || q.includes("leg2") || q.includes("opp") || q.includes("opposite")) { a = p1; b = p2; }
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
            this.anchor = null;

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
              this.layout.push({ label: String(bar.label || ""), value: bar.value, x, y, w: barW, h, radius: 10 });
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

        function normalizeSymbolLabel(raw) {
          const text = String(raw || "").trim();
          const lower = text.toLowerCase();
          switch (lower) {
            case "theta": return "θ";
            case "alpha": return "α";
            case "beta": return "β";
            case "gamma": return "γ";
            case "delta": return "δ";
            case "lambda": return "λ";
            case "pi": return "π";
            case "phi": return "φ";
            default: return text;
          }
        }

        function cleanTriangleLabel(raw) {
          return normalizeSymbolLabel(
            String(raw || "")
              .trim()
              .replace(/^[=:\s]+/, "")
              .replace(/[;,\s]+$/, "")
          );
        }

        function extractTriangleLabels(raw) {
          const text = normalizeDrawText(raw);
          const labels = { base: null, height: null, hyp: null };
          const legs = text.match(/\blegs?\s*[:=]?\s*([^\s,;/]+)\s*[,/]\s*([^\s,;/]+)/i);
          if (legs) {
            const first = cleanTriangleLabel(legs[1]);
            const second = cleanTriangleLabel(legs[2]);
            const firstLower = first.toLowerCase();
            const secondLower = second.toLowerCase();

            if (/(adj|adjacent)/i.test(firstLower)) labels.base = first;
            else if (/(opp|opposite)/i.test(firstLower)) labels.height = first;

            if (/(adj|adjacent)/i.test(secondLower)) labels.base = second;
            else if (/(opp|opposite)/i.test(secondLower)) labels.height = second;

            if (!labels.base) labels.base = first;
            if (!labels.height) labels.height = second;
          }

          const hyp = text.match(/\bhyp(?:otenuse)?\s*[:=]?\s*([^\s,;]+)/i);
          if (hyp)
            labels.hyp = cleanTriangleLabel(hyp[1]);

          return labels;
        }

        function extractTriangleSideLabels(raw) {
          const text = normalizeDrawText(raw);
          const labels = { base: null, height: null, hyp: null };
          const tuple = text.match(/\(([^)]+)\)/);
          const parts = tuple
            ? tuple[1].split(/[,/]/).map((part) => cleanTriangleLabel(part)).filter(Boolean)
            : [];

          const remaining = [];
          for (const part of parts) {
            const lower = part.toLowerCase();
            if (!labels.base && /(adj|adjacent)/i.test(lower)) {
              labels.base = part;
              continue;
            }
            if (!labels.height && /(opp|opposite)/i.test(lower)) {
              labels.height = part;
              continue;
            }
            if (!labels.hyp && /(hyp|hypotenuse)/i.test(lower)) {
              labels.hyp = part;
              continue;
            }
            remaining.push(part);
          }

          if (!labels.base && remaining.length > 0) labels.base = remaining.shift();
          if (!labels.height && remaining.length > 0) labels.height = remaining.shift();
          if (!labels.hyp && remaining.length > 0) labels.hyp = remaining.shift();
          return labels;
        }

        function extractTriangleAngleLabel(raw) {
          const text = normalizeDrawText(raw);
          const named = text.match(/\bangle\s*[:=]?\s*([^\s,;]+)/i);
          if (named) return cleanTriangleLabel(named[1]);
          if (/\btheta\b|θ/i.test(text)) return "θ";
          return null;
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

        function buildAttribute(label, value) {
          const text = String(value || "").trim();
          if (!text) return null;
          return {
            label: String(label || "").trim(),
            value: text
          };
        }

        function compactAttributes(items) {
          return Array.isArray(items) ? items.filter(Boolean) : [];
        }

        function formatCoordinateText(x, y) {
          return `(${formatSceneNumber(x)}, ${formatSceneNumber(y)})`;
        }

        function formatDegreeText(value) {
          if (!Number.isFinite(value)) return "";
          const rounded = Math.round(value * 10) / 10;
          const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
          return `${text}°`;
        }

        function buildTriangleAttributes(shape) {
          if (!shape) return [];

          const baseValue = Number.isFinite(shape.a) ? shape.a : 0;
          const heightValue = Number.isFinite(shape.b) ? shape.b : 0;
          const hypValue = Math.sqrt((baseValue * baseValue) + (heightValue * heightValue));
          const baseAngle = Math.atan2(heightValue, Math.max(1e-6, baseValue)) * (180 / Math.PI);
          const topAngle = Math.max(0, 90 - baseAngle);
          const angleSummary = shape.angles
            ? `${formatDegreeText(shape.angles.a)}, ${formatDegreeText(shape.angles.b)}, ${formatDegreeText(shape.angles.c)}`
            : `${formatDegreeText(baseAngle)}, 90°, ${formatDegreeText(topAngle)}`;

          const attributes = compactAttributes([
            buildAttribute(shape.labels && shape.labels.base ? shape.labels.base : "base", formatSceneNumber(baseValue)),
            buildAttribute(shape.labels && shape.labels.height ? shape.labels.height : "height", formatSceneNumber(heightValue)),
            buildAttribute(shape.labels && shape.labels.hyp ? shape.labels.hyp : "hyp", formatSceneNumber(hypValue)),
            buildAttribute("Angles", angleSummary)
          ]);

          if (shape.angleLabel && !shape.angles) {
            attributes.push(buildAttribute(shape.angleLabel, formatDegreeText(baseAngle)));
          }

          return attributes;
        }

        function buildSceneMetrics() {
          const metrics = [];
          if (sceneCounts.axes > 0) {
            metrics.push(`x ${formatSceneNumber(axesRange.xmin)}..${formatSceneNumber(axesRange.xmax)}`);
            metrics.push(`y ${formatSceneNumber(axesRange.ymin)}..${formatSceneNumber(axesRange.ymax)}`);
          }

          const shapeCount = sceneCounts.line + sceneCounts.point + sceneCounts.circle + sceneCounts.square + sceneCounts.triangle + sceneCounts.bar;
          if (shapeCount > 0) {
            metrics.push(`${shapeCount} interactive ${shapeCount === 1 ? "mark" : "marks"}`);
          }
          return metrics;
        }

        function registerShapeScene(shape) {
          if (shape instanceof AxesShape && shape.viewport) {
            sceneCounts.axes += 1;
            registerSceneItem({
              id: shape.id,
              kind: "axes",
              title: "Coordinate plane",
              detail: `x from ${formatSceneNumber(shape.xmin)} to ${formatSceneNumber(shape.xmax)}, y from ${formatSceneNumber(shape.ymin)} to ${formatSceneNumber(shape.ymax)}`,
              anchor: shape.getAnchor(),
              priority: 0,
              hit: {
                type: "rect",
                x: shape.viewport.x,
                y: shape.viewport.y,
                w: shape.viewport.w,
                h: shape.viewport.h,
                padding: 0,
                radius: 14
              },
              accent: "rgba(59,130,246,0.92)",
              attributes: compactAttributes([
                buildAttribute("x range", `${formatSceneNumber(shape.xmin)} to ${formatSceneNumber(shape.xmax)}`),
                buildAttribute("y range", `${formatSceneNumber(shape.ymin)} to ${formatSceneNumber(shape.ymax)}`)
              ]),
              metrics: buildSceneMetrics()
            });
            return;
          }

          if (shape instanceof LineShape && shape.segment) {
            sceneCounts.line += 1;
            const lineAnchor = shape.getAnchor();
            const lineHit = {
              type: "segment",
              x1: shape.segment.x1,
              y1: shape.segment.y1,
              x2: shape.segment.x2,
              y2: shape.segment.y2,
              tolerance: 14
            };
            registerSceneItem({
              id: shape.id,
              kind: "line",
              title: formatLineTitle(shape.expr),
              detail: formatLineDetail(shape.expr),
              anchor: lineAnchor,
              priority: 2,
              hit: lineHit,
              hitTargets: lineAnchor
                ? [
                  lineHit,
                  {
                    type: "circle",
                    x: lineAnchor.x,
                    y: lineAnchor.y,
                    radius: 16,
                    padding: 8
                  }
                ]
                : [lineHit],
              accent: "rgba(124,58,237,0.95)",
              attributes: shape.expr && shape.expr.kind === "vertical"
                ? compactAttributes([
                  buildAttribute("Equation", formatLineTitle(shape.expr)),
                  buildAttribute("Type", "Vertical line"),
                  buildAttribute("x", formatSceneNumber(shape.expr.x))
                ])
                : compactAttributes([
                  buildAttribute("Equation", formatLineTitle(shape.expr)),
                  buildAttribute("Slope", formatSceneNumber(shape.expr && shape.expr.m)),
                  buildAttribute("Intercept", formatSceneNumber(shape.expr && shape.expr.b))
                ])
            });
            return;
          }

          if (shape instanceof PointShape && shape.pixelPoint) {
            sceneCounts.point += 1;
            const pointLabel = shape.label ? `Point ${shape.label}` : `Point (${formatSceneNumber(shape.x)}, ${formatSceneNumber(shape.y)})`;
            registerSceneItem({
              id: shape.id,
              kind: "point",
              title: pointLabel,
              detail: `Coordinate (${formatSceneNumber(shape.x)}, ${formatSceneNumber(shape.y)})`,
              anchor: shape.getAnchor(),
              priority: 3,
              hit: {
                type: "circle",
                x: shape.pixelPoint.x,
                y: shape.pixelPoint.y,
                radius: shape.pixelPoint.radius,
                padding: 4
              },
              accent: "rgba(34,197,94,0.95)",
              attributes: compactAttributes([
                shape.label ? buildAttribute("Label", shape.label) : null,
                buildAttribute("x", formatSceneNumber(shape.x)),
                buildAttribute("y", formatSceneNumber(shape.y))
              ])
            });
            return;
          }

          if (shape instanceof CircleShape && shape.pixelCircle) {
            sceneCounts.circle += 1;
            registerSceneItem({
              id: shape.id,
              kind: "circle",
              title: "Circle sketch",
              detail: `Center (${formatSceneNumber(shape.x)}, ${formatSceneNumber(shape.y)}) with radius ${formatSceneNumber(shape.radius)}`,
              anchor: shape.getAnchor(),
              priority: 2,
              hit: {
                type: "ring",
                x: shape.pixelCircle.x,
                y: shape.pixelCircle.y,
                radius: shape.pixelCircle.radius,
                tolerance: 14
              },
              accent: "rgba(14,165,233,0.95)",
              attributes: compactAttributes([
                buildAttribute("Center", formatCoordinateText(shape.x, shape.y)),
                buildAttribute("Radius", formatSceneNumber(shape.radius)),
                Math.abs((shape.endDeg || 360) - (shape.startDeg || 0)) < 359.5
                  ? buildAttribute("Arc", `${formatDegreeText(shape.startDeg)} to ${formatDegreeText(shape.endDeg)}`)
                  : null
              ])
            });
            return;
          }

          if (shape instanceof SquareShape && Array.isArray(shape.pixelPolygon) && shape.pixelPolygon.length > 0) {
            sceneCounts.square += 1;
            registerSceneItem({
              id: shape.id,
              kind: "square",
              title: "Square sketch",
              detail: `Centered near (${formatSceneNumber(shape.x)}, ${formatSceneNumber(shape.y)})`,
              anchor: shape.getAnchor(),
              priority: 1,
              hit: {
                type: "polygon",
                points: shape.pixelPolygon,
                tolerance: 14
              },
              accent: "rgba(249,115,22,0.95)",
              attributes: compactAttributes([
                buildAttribute("Center", formatCoordinateText(shape.x, shape.y)),
                buildAttribute("Side", formatSceneNumber(shape.size)),
                buildAttribute("Rotation", formatDegreeText(shape.rotationDeg || 0))
              ])
            });
            return;
          }

          if (shape instanceof TriangleShape && Array.isArray(shape.pixelPolygon) && shape.pixelPolygon.length === 3) {
            sceneCounts.triangle += 1;
            registerSceneItem({
              id: shape.id,
              kind: "triangle",
              title: "Triangle diagram",
              detail: `Sides ${formatSceneNumber(shape.a)}, ${formatSceneNumber(shape.b)}, ${shape.labels.hyp || "c"}`,
              anchor: shape.getAnchor(),
              priority: 1,
              hit: {
                type: "polygon",
                points: shape.pixelPolygon,
                tolerance: 14
              },
              accent: "rgba(236,72,153,0.92)",
              attributes: buildTriangleAttributes(shape)
            });
            return;
          }

          if (shape instanceof BarShape && Array.isArray(shape.layout)) {
            for (let i = 0; i < shape.layout.length; i++) {
              const bar = shape.layout[i];
              sceneCounts.bar += 1;
              registerSceneItem({
                id: `${shape.id}:${i}`,
                kind: "bar",
                title: `Bar ${bar.label || i + 1}`,
                detail: `Value ${formatSceneNumber(bar.value)}`,
                anchor: { x: bar.x + (bar.w / 2), y: bar.y },
                priority: 3,
                hit: {
                  type: "rect",
                  x: bar.x,
                  y: bar.y,
                  w: bar.w,
                  h: bar.h,
                  padding: 6,
                  radius: bar.radius || 10
                },
                accent: "rgba(34,197,94,0.92)",
                attributes: compactAttributes([
                  buildAttribute("Bar", bar.label || String(i + 1)),
                  buildAttribute("Value", formatSceneNumber(bar.value))
                ])
              });
            }
          }
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
              registerShapeScene(shape);
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

            registerShapeScene(shape);

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
            if (shape instanceof SquareShape) {
              const p = shape.focus(c, strength, detail || query);
              if (!p) return false;
              drawFocusRing(p.x, p.y, strength);
              lastPen = { x: p.x, y: p.y };
              return true;
            }
            if (shape instanceof CircleShape) {
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
          if (lower.startsWith("square ")) {
            const square = findLastShape("square");
            if (focusByShape(square, query.slice(7).trim())) return true;
          }
          if (lower.startsWith("circle ")) {
            const circle = findLastShape("circle");
            if (focusByShape(circle, query.slice(7).trim())) return true;
          }

          if (lower.includes("square")) {
            if (focusByShape(findLastShape("square"), query)) return true;
          }
          if (lower.includes("circle")) {
            if (focusByShape(findLastShape("circle"), query)) return true;
          }

          if (/(right angle|angle|corner|hyp|hypotenuse|opp|opposite|adj|adjacent|leg|base|height|theta|θ|\ba\b|\bb\b|\bc\b)/i.test(lower)) {
            const tri = findLastShape("triangle");
            if (focusByShape(tri, query)) return true;
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
          const cmd = canonicalizeDrawCommand(step.command);
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
            const labelMatch = normalizeDrawText(rest).match(/label\s*[:=]\s*(.+)$/i);
            const label = labelMatch ? normalizeSymbolLabel(String(labelMatch[1] || "").trim().replace(/^\"|\"$/g, "")) : null;
            const labelLower = String(label || "").trim().toLowerCase();
            if (labelLower === "theta" || labelLower === "θ") {
              const tri = findLastShape("triangle");
              if (tri instanceof TriangleShape) {
                tri.setAngleLabel(label);
                tri.setProgress(1);
                mode = "triangle";
                continue;
              }
            }

            ensureCartesian();
            const pt = parsePoint(rest);
            if (!pt) continue;
            const id = parseShapeId(rest, `point-${i + 1}`);
            let shape = getShape(id);
            if (!(shape instanceof PointShape)) shape = registerShape(new PointShape(id, pt, label, defaultAxesId));
            shape.setAxes(defaultAxesId).setPoint(pt).setLabel(label).setProgress(progressT);
            continue;
          }

          if (op === "circle") {
            const id = parseShapeId(rest, `circle-${i + 1}`);
            const center = parsePoint(rest);
            const r = readNamed(rest, "r") ?? readNamed(rest, "radius");
            const startDeg = readNamed(rest, "start") ?? readNamed(rest, "from");
            const endDeg = readNamed(rest, "end") ?? readNamed(rest, "to");
            const existing = getShape(id);
            const hasUpdateGeometry = !!center || r !== null || startDeg !== null || endDeg !== null;
            const canCreateCircle = !!center && r !== null;
            if (!(existing instanceof CircleShape) && !canCreateCircle) continue;
            if (existing instanceof CircleShape && !hasUpdateGeometry) continue;

            ensureCartesian();
            let shape = existing;
            if (!(shape instanceof CircleShape)) shape = registerShape(new CircleShape(id, defaultAxesId));
            if (center) shape.setCenter(center.x, center.y);
            if (r !== null) shape.setRadius(Math.abs(r));
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
            const hasAngleMeasurements = /\bangles\b/.test(lower) && numbers.length >= 2;
            if (hasAngleMeasurements) {
              const a1 = numbers.length > 0 ? numbers[0] : null;
              const a2 = numbers.length > 1 ? numbers[1] : null;
              const a3 = numbers.length > 2 ? numbers[2] : null;
              shape.setAngles(a1, a2, a3);
            } else {
              const a = (numbers.length > 0 && numbers[0] > 0) ? numbers[0] : 4;
              const b = (numbers.length > 1 && numbers[1] > 0) ? numbers[1] : 3;
              const hintedLabels = extractTriangleLabels(rest);
              const angleLabel = extractTriangleAngleLabel(rest);
              const inferredTrigLabels = !!angleLabel || /\b(?:theta|acute angle|opp(?:osite)?|adj(?:acent)?|hyp(?:otenuse)?)\b|θ/i.test(normalizeDrawText(rest));
              const labels = {
                base: hintedLabels.base || (inferredTrigLabels ? "adj" : (numbers.length > 0 ? String(numbers[0]) : "a")),
                height: hintedLabels.height || (inferredTrigLabels ? "opp" : (numbers.length > 1 ? String(numbers[1]) : "b")),
                hyp: hintedLabels.hyp || (inferredTrigLabels ? "hyp" : (numbers.length > 2 ? String(numbers[2]) : "c"))
              };
              shape.setSides(a, b, labels);
            }
            const angleLabel = extractTriangleAngleLabel(rest);
            if (angleLabel) shape.setAngleLabel(angleLabel);
            shape.setProgress(progressT);
            mode = "triangle";
            continue;
          }

          if (op === "label" || op === "labels") {
            const tri = findLastShape("triangle");
            if (!(tri instanceof TriangleShape)) continue;
            const labels = extractTriangleSideLabels(rest);
            if (labels.base || labels.height || labels.hyp)
              tri.setSides(tri.a, tri.b, labels);
            const angleLabel = extractTriangleAngleLabel(rest);
            if (angleLabel) tri.setAngleLabel(angleLabel);
            tri.setProgress(1);
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
            const pt = parsePoint(cmd);
            if (!pt) continue;
            ensureCartesian();
            registerShape(new PointShape(`point-${i + 1}`, pt, null, defaultAxesId).setProgress(progressT));
            continue;
          }
        }

        renderScene();

        if (focusCommand) {
          const focused = resolveFocus(focusCommand.query, focusCommand.strength);
          if (!focused) activeFocusUnresolved = true;
        }

        const scene = sceneItems.length > 0
          ? {
            viewport: { x: area.x, y: area.y, w: area.w, h: area.h },
            label: mode === "bar" ? "Interactive bar graph" : "Interactive graph",
            title: mode === "triangle"
              ? "Interactive diagram"
              : (mode === "bar" ? "Interactive bar graph" : "Interactive graph"),
            hint: mode === "bar"
              ? "Hover or tap bars to pin their values."
              : "Hover or tap the graph to inspect lines, points, and shapes.",
            metrics: buildSceneMetrics(),
            items: sceneItems
          }
          : null;

        return activeFocusUnresolved
          ? { penX: null, penY: null, scene }
          : { penX: lastPen.x, penY: lastPen.y, scene };
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

        if (activeStep)
          activeLocal = smoothActiveReveal(activeLocal, activeStep);

      if (activeStep && activeStep.kind === "text" && shouldRenderStep(activeLine, activeStep)) {
        const line = activeStep.text;
        const count = Math.max(0, Math.min(line.length, Math.floor(line.length * activeLocal)));
        const partialText = count > 0 ? line.substring(0, count) : "";
        textRows.push({ text: partialText, isActive: true });
      }
      }

      const buildWrappedRows = (availableWidth) => {
        const wrapped = [];
        for (const row of textRows) {
          const parts = wrapBoardTextRows(ctx, row && row.text ? row.text : "", availableWidth);
          if (parts.length === 0) continue;
          for (let i = 0; i < parts.length; i++) {
            wrapped.push({
              text: parts[i],
              isActive: !!(row && row.isActive) && i === parts.length - 1
            });
          }
        }
        return wrapped;
      };

      let visibleTextRows = buildWrappedRows(maxWidth);
      const maxRowsVisible = Math.max(1, Math.floor(textArea.h / lineHeight) - 1);
      boardScrollMaxRows = Math.max(0, visibleTextRows.length - maxRowsVisible);
      if (boardScrollMaxRows > 0) {
        maxWidth = Math.max(80, maxWidth - 12);
        visibleTextRows = buildWrappedRows(maxWidth);
        boardScrollMaxRows = Math.max(0, visibleTextRows.length - maxRowsVisible);
      }
      if (boardScrollRows > boardScrollMaxRows) boardScrollRows = boardScrollMaxRows;
      if (boardScrollRows < 0) boardScrollRows = 0;

      const firstVisibleRow = Math.max(0, visibleTextRows.length - maxRowsVisible - boardScrollRows);
      const visibleRows = visibleTextRows.slice(firstVisibleRow, firstVisibleRow + maxRowsVisible);
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
        const thumbH = Math.max(26, Math.round((maxRowsVisible / Math.max(1, visibleTextRows.length)) * trackH));
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
        const diagramPen = renderDiagram(ctx, diagramArea, steps, activeLine, activeLocal, frameNow);
        if (graphUi) {
          graphUi.updateScene(diagramPen && diagramPen.scene ? diagramPen.scene : null);
          graphUi.renderOverlay(ctx, frameNow);
        }
        if (activeStep && activeStep.kind === "draw") {
          penX = diagramPen.penX;
          penY = diagramPen.penY;
        }
      } else if (graphUi) {
        graphUi.updateScene(null);
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

    drawFrame = draw;
    lastPaintAt = start;
    if (!paintFallbackTimer) {
      paintFallbackTimer = window.setInterval(() => {
        if (!raf || typeof drawFrame !== "function") return;
        if (!isNarrationCurrentlySpeaking() && !hasGraphMotion()) return;

        const now = performance.now();
        if ((now - lastPaintAt) < 140) return;

        cancelAnimationFrame(raf);
        raf = 0;
        drawFrame(now);
      }, 75);
    }

    raf = requestAnimationFrame(draw);
  }

  function stopLoop() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (paintFallbackTimer) {
      window.clearInterval(paintFallbackTimer);
      paintFallbackTimer = 0;
    }
    drawFrame = null;
    loopStartMs = 0;
    lastPaintAt = 0;
  }

  function hasGraphMotion() {
    return !!(graphUi && graphUi.hasActiveMotion && graphUi.hasActiveMotion());
  }

  function refreshBoardFrame() {
    const alreadyRunning = !!raf;
    startLoop();
    if (alreadyRunning) return;

    window.setTimeout(() => {
      if (raf && mode === "qa" && !qaIsSpeaking && (!qaAudio || qaAudio.paused || qaAudio.ended) && !hasGraphMotion()) {
        stopLoop();
        return;
      }
      if (raf && mode === "lesson" && !lessonIsPlaying() && !hasGraphMotion()) {
        stopLoop();
      }
    }, 90);
  }

  function syncBoardToPlayback(force = false) {
    const now = performance.now();
    if (typeof drawFrame === "function") {
      if (!force && lastPaintAt > 0 && (now - lastPaintAt) < 28)
        return;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      drawFrame(now);
      return;
    }

    refreshBoardFrame();
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
    updateSpeedLabel();
    if (mode === "qa") {
      if (!qaAudio) return;
      qaAudio.playbackRate = getSpeed();
      startLoop();
      try {
        await qaAudio.play();
      } catch {
        qaIsSpeaking = false;
      }
      return;
    }

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
      syncBoardToPlayback(false);
    };
    manualUtterance.onend = () => {
      manualElapsedSeconds = estimateDurationSeconds();
      manualIsPlaying = false;
      manualIsPaused = false;
      manualPlayStart = 0;
      manualSpeechCharIndex = text.length;
      manualSpeechProgress = 1;
      manualHasSpeechBoundary = true;
      syncBoardToPlayback(true);
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
    if (hasGraphMotion()) refreshBoardFrame();
    else stopLoop();
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

  function resetQuickQaUi() {
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

  function resetBoardQaUi() {
    if (qaBoardError) {
      qaBoardError.textContent = "";
      qaBoardError.hidden = true;
    }
    if (qaBoardSubmit) {
      qaBoardSubmit.disabled = false;
      qaBoardSubmit.textContent = "Ask";
    }
  }

  function openQuickQa() {
    if (!qaOverlay) return;
    resumeAfterQa = lessonIsPlaying();
    pauseLesson();
    resetQuickQaUi();
    if (qaQuestion) qaQuestion.value = "";
    qaOverlay.hidden = false;
    qaQuestion && qaQuestion.focus();
  }

  function closeQuickQa({ resume } = { resume: true }) {
    if (!qaOverlay) return;
    qaOverlay.hidden = true;
    if (resume && resumeAfterQa) resumeLesson();
  }

  function openBoardQa() {
    if (!qaBoardOverlay) return;
    resumeAfterQa = lessonIsPlaying();
    pauseLesson();
    resetBoardQaUi();
    if (questionBoard && typeof questionBoard.reset === "function") {
      questionBoard.reset();
    }
    qaBoardOverlay.hidden = false;
    if (questionBoard && typeof questionBoard.activate === "function") {
      questionBoard.activate();
    }
    if (questionBoard && typeof questionBoard.focus === "function") {
      questionBoard.focus();
    }
  }

  function closeBoardQa({ resume } = { resume: true }) {
    if (!qaBoardOverlay) return;
    qaBoardOverlay.hidden = true;
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
    const hasStoredNarrationAlignmentIssue =
      narrationSegments.length === boardSteps.length &&
      hasWeakBoardNarrationAlignment(boardLines, narrationSegments);
    const usableNarrationSegments = hasStoredNarrationAlignmentIssue ? [] : narrationSegments;
    const storedLessonSegmentPlan =
      usableNarrationSegments.length === boardSteps.length && scriptText.length > 0
        ? buildStoredNarrationSegmentPlan(scriptText, usableNarrationSegments, lessonSpeechTimeline)
        : [];
    const sectionAnchoredLessonPlan =
      usableNarrationSegments.length === 0 && scriptText.length > 0
        ? buildSectionAnchoredSyncPlan(scriptText, boardSteps, lessonSpeechTimeline)
        : [];
    if (storedLessonSegmentPlan.length === boardSteps.length) {
      boardTimings = storedLessonSegmentPlan.map((segment) => clamp01(segment.startProgress));
      lessonStepSyncPlan = storedLessonSegmentPlan.slice();
    } else {
      const seedLessonTimings = sectionAnchoredLessonPlan.length === boardSteps.length
        ? sectionAnchoredLessonPlan.map((segment) => clamp01(segment.startProgress))
        : boardTimings;
      boardTimings = buildSpeechSyncedTimings(scriptText, boardSteps, seedLessonTimings, lessonSpeechTimeline);
      lessonStepSyncPlan = buildStepSyncPlan(scriptText, boardSteps, boardTimings, lessonSpeechTimeline);
    }
    stepSyncPlan = lessonStepSyncPlan.slice();
    renderBoardTimingPlan();
  }

  function finishQa({ resumeLessonAfter } = { resumeLessonAfter: true }) {
    if (qaAudio) {
      try { qaAudio.pause(); } catch { /* ignore */ }
      try { qaAudio.currentTime = 0; } catch { /* ignore */ }
      if (qaAudio === qaAudioControl) {
        try { qaAudio.removeAttribute("src"); } catch { /* ignore */ }
        try { qaAudio.load(); } catch { /* ignore */ }
      }
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
    setQaAudioControlsVisible(false);

    restoreLessonBoard();
    askButtons.forEach((button) => { button.disabled = false; });
    if (playBtn) {
      playBtn.disabled = false;
      playBtn.textContent = "Play";
    }
    exportBtn && (exportBtn.disabled = false);

    if (resumeLessonAfter && resumeAfterQa) {
      resumeLesson();
    } else if (audio) {
      // Match the old behavior: paused audio means no animation loop.
      if (hasGraphMotion()) refreshBoardFrame();
      else stopLoop();
    }
  }

  function startQaSegment(pack) {
    const qaPack = pack;
    const narration = (qaPack && qaPack.narration) ? String(qaPack.narration || "").trim() : "";
    qaNarrationText = narration;
    const audioUrl = (qaPack && qaPack.audioUrl) ? String(qaPack.audioUrl || "").trim() : "";
    if (!audioUrl) {
      throw new Error("OpenAI answer audio wasn't generated, so the browser voice fallback stayed off. Try again.");
    }
    let qaLines = Array.isArray(qaPack && qaPack.boardLines) ? qaPack.boardLines : [];
    qaLines = qaLines.map((s) => String(s || "").trim()).filter((s) => s.length > 0);

    let qaTimings = Array.isArray(qaPack && qaPack.boardTimings) ? qaPack.boardTimings : [];
    qaTimings = sanitizeTimings(qaTimings, qaLines.length);
    const qaFallbackDurationSeconds = estimateSpeechSeconds(narration, getSpeed());
    let qaTimestampSeconds = Array.isArray(qaPack && qaPack.boardTimestampSeconds) ? qaPack.boardTimestampSeconds : [];
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

    askButtons.forEach((button) => { button.disabled = true; });
    if (playBtn) {
      playBtn.disabled = false;
      playBtn.textContent = "Play answer";
    }
    exportBtn && (exportBtn.disabled = true);
    understoodBtn && (understoodBtn.hidden = false);
    startLoop();

    if (qaAudio) {
      try { qaAudio.pause(); } catch { /* ignore */ }
      try { qaAudio.currentTime = 0; } catch { /* ignore */ }
      if (qaAudio === qaAudioControl) {
        try { qaAudio.removeAttribute("src"); } catch { /* ignore */ }
        try { qaAudio.load(); } catch { /* ignore */ }
      }
      qaAudio = null;
    }

    setQaAudioControlsVisible(true);
    if (qaAudioControl) {
      qaAudio = qaAudioControl;
      qaAudio.preload = "auto";
      qaAudio.src = audioUrl;
      try { qaAudio.load(); } catch { /* ignore */ }
    } else {
      qaAudio = new Audio(audioUrl);
      qaAudio.preload = "auto";
      qaAudio.addEventListener("loadedmetadata", () => {
        if (qaAudio && Number.isFinite(qaAudio.duration) && qaAudio.duration > 0)
          qaDurationSeconds = qaAudio.duration;
        renderBoardTimingPlan();
        syncBoardToPlayback(true);
      });
      qaAudio.addEventListener("play", () => {
        qaIsSpeaking = true;
        startLoop();
        syncBoardToPlayback(true);
      });
      qaAudio.addEventListener("pause", () => {
        qaIsSpeaking = false;
        if (hasGraphMotion()) refreshBoardFrame();
        else stopLoop();
      });
      qaAudio.addEventListener("timeupdate", () => syncBoardToPlayback(true));
      qaAudio.addEventListener("seeking", () => syncBoardToPlayback(true));
      qaAudio.addEventListener("seeked", () => syncBoardToPlayback(true));
      qaAudio.addEventListener("ended", () => finishQa({ resumeLessonAfter: true }));
    }

    qaAudio.playbackRate = getSpeed();
    qaAudio.play().catch(() => {
      qaIsSpeaking = false;
      if (playBtn) {
        playBtn.disabled = false;
      }
      if (hasGraphMotion()) refreshBoardFrame();
      else stopLoop();
    });
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
      if (!data || !String(data.audioUrl || "").trim()) {
        throw new Error("OpenAI answer audio wasn't generated, so the browser voice fallback stayed off. Try again.");
      }

      closeQuickQa({ resume: false });
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

  async function submitBoardQa() {
    if (!videoId || !qaBoardSubmit || !questionBoard) return;

    resetBoardQaUi();
    qaBoardSubmit.disabled = true;
    const oldText = qaBoardSubmit.textContent;
    qaBoardSubmit.textContent = "Asking…";

    try {
      const payload = questionBoard.getPayload();
      const data = await postJson(`/api/videos/${videoId}/question`, {
        question: payload.question,
        progress: progressFractionNow(),
        board: payload.board
      });
      if (!data || !String(data.audioUrl || "").trim()) {
        throw new Error("OpenAI answer audio wasn't generated, so the browser voice fallback stayed off. Try again.");
      }

      closeBoardQa({ resume: false });
      startQaSegment(data);
    } catch (e) {
      if (qaBoardError) {
        qaBoardError.textContent = `Error: ${e.message || e}`;
        qaBoardError.hidden = false;
      }
      if (questionBoard && typeof questionBoard.activate === "function") {
        questionBoard.activate();
      }
    } finally {
      qaBoardSubmit.textContent = oldText;
      qaBoardSubmit.disabled = false;
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
  canvas.addEventListener("pointerleave", handleBoardCanvasPointerLeave);
  canvas.addEventListener("pointerup", handleBoardCanvasPointerUp);
  canvas.addEventListener("pointercancel", handleBoardCanvasPointerUp);
  canvas.addEventListener("lostpointercapture", clearScrollbarDrag);
  canvas.addEventListener("keydown", handleBoardCanvasKeydown);
  playBtn && playBtn.addEventListener("click", play);
  stopBtn && stopBtn.addEventListener("click", stop);
  exportBtn && exportBtn.addEventListener("click", exportVideo);
  fullscreenBtn && fullscreenBtn.addEventListener("click", toggleBoardFullscreen);

  askBoardBtn && askBoardBtn.addEventListener("click", openBoardQa);
  askQuickBtn && askQuickBtn.addEventListener("click", openQuickQa);
  understoodBtn && understoodBtn.addEventListener("click", () => finishQa({ resumeLessonAfter: true }));
  qaClose && qaClose.addEventListener("click", () => closeQuickQa({ resume: true }));
  qaContinue && qaContinue.addEventListener("click", () => closeQuickQa({ resume: true }));
  qaSubmit && qaSubmit.addEventListener("click", submitQa);
  qaBoardSubmit && qaBoardSubmit.addEventListener("click", submitBoardQa);
  qaQuestion && qaQuestion.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitQa();
    }
  });
  questionBoardRoot && questionBoardRoot.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitBoardQa();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && qaOverlay && !qaOverlay.hidden) {
      e.preventDefault();
      closeQuickQa({ resume: true });
      return;
    }
    if (e.key === "Escape" && qaBoardOverlay && !qaBoardOverlay.hidden) {
      e.preventDefault();
      closeBoardQa({ resume: true });
    }
  });
  qaOverlay && qaOverlay.addEventListener("click", (e) => {
    if (e.target === qaOverlay) closeQuickQa({ resume: true });
  });
  qaBoardClose && qaBoardClose.addEventListener("click", () => closeBoardQa({ resume: true }));
  qaBoardOverlay && qaBoardOverlay.addEventListener("click", (e) => {
    if (e.target === qaBoardOverlay) closeBoardQa({ resume: true });
  });
  window.addEventListener("resize", () => ensureCanvasResolution(true));
  document.addEventListener("fullscreenchange", () => {
    updateFullscreenButtonLabel();
    ensureCanvasResolution(true);
  });

  if (qaAudioControl) {
    const syncQaAudioControlFrame = () => {
      if (mode !== "qa" || qaAudio !== qaAudioControl) return;
      renderBoardTimingPlan();
      syncBoardToPlayback(true);
    };

    qaAudioControl.addEventListener("loadedmetadata", () => {
      if (mode !== "qa" || qaAudio !== qaAudioControl) return;
      if (Number.isFinite(qaAudioControl.duration) && qaAudioControl.duration > 0)
        qaDurationSeconds = qaAudioControl.duration;
      renderBoardTimingPlan();
      syncBoardToPlayback(true);
    });
    qaAudioControl.addEventListener("play", () => {
      if (mode !== "qa" || qaAudio !== qaAudioControl) return;
      qaIsSpeaking = true;
      startLoop();
      syncBoardToPlayback(true);
    });
    qaAudioControl.addEventListener("pause", () => {
      if (mode !== "qa" || qaAudio !== qaAudioControl) return;
      qaIsSpeaking = false;
      if (hasGraphMotion()) refreshBoardFrame();
      else stopLoop();
    });
    qaAudioControl.addEventListener("timeupdate", syncQaAudioControlFrame);
    qaAudioControl.addEventListener("seeking", syncQaAudioControlFrame);
    qaAudioControl.addEventListener("seeked", syncQaAudioControlFrame);
    qaAudioControl.addEventListener("ended", () => {
      if (mode !== "qa" || qaAudio !== qaAudioControl) return;
      finishQa({ resumeLessonAfter: true });
    });
  }

  if (audio) {
    const syncLessonAudioFrame = () => {
      if (useBoundaryLessonNarration()) return;
      renderBoardTimingPlan();
      syncBoardToPlayback(true);
    };

    audio.addEventListener("loadedmetadata", () => {
      renderBoardTimingPlan();
      syncBoardToPlayback(true);
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
      syncLessonAudioFrame();
    });
    audio.addEventListener("timeupdate", syncLessonAudioFrame);
    audio.addEventListener("seeking", syncLessonAudioFrame);
    audio.addEventListener("seeked", syncLessonAudioFrame);
    audio.addEventListener("pause", () => {
      if (useBoundaryLessonNarration()) return;
      if (hasGraphMotion()) {
        refreshBoardFrame();
        return;
      }
      stopLoop();
    });
    audio.addEventListener("ended", () => {
      if (useBoundaryLessonNarration()) return;
      if (hasGraphMotion()) {
        refreshBoardFrame();
        return;
      }
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
