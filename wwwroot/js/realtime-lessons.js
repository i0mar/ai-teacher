(function () {
  const root = document.querySelector("[data-realtime-root]");
  if (!root) {
    return;
  }

  const els = {
    topic: document.getElementById("realtime-topic"),
    start: document.getElementById("realtime-start"),
    stop: document.getElementById("realtime-stop"),
    mic: document.getElementById("realtime-mic"),
    status: document.getElementById("realtime-status"),
    error: document.getElementById("realtime-error"),
    boardStatus: document.getElementById("realtime-board-status"),
    audio: document.getElementById("realtime-remote-audio"),
    liveIndicator: document.getElementById("realtime-live-indicator"),
    thread: document.getElementById("realtime-thread"),
    textForm: document.getElementById("realtime-text-form"),
    textInput: document.getElementById("realtime-text-input"),
    send: document.getElementById("realtime-send"),
    topicButtons: Array.from(document.querySelectorAll("[data-realtime-topic]")),
    canvas: document.getElementById("realtime-canvas"),
    fullscreen: document.getElementById("realtime-fullscreen"),
    captionsToggle: document.getElementById("realtime-captions-toggle"),
    shell: document.getElementById("realtime-shell"),
    captions: document.getElementById("realtime-captions")
  };

  const state = {
    available: root.getAttribute("data-realtime-available") === "true",
    connectUrl: root.getAttribute("data-connect-url") || "/api/realtime-lessons/connect",
    boardSyncUrl: root.getAttribute("data-board-sync-url") || "/api/realtime-lessons/board-sync",
    connecting: false,
    connected: false,
    channelOpen: false,
    sessionConfigured: false,
    sessionUpdateSent: false,
    lessonStarted: false,
    micMuted: false,
    studentSpeaking: false,
    sessionTopic: "",
    pc: null,
    dataChannel: null,
    localStream: null,
    remoteStream: null,
    stopping: false,
    activeTutorResponseId: null,
    tutorResponses: new Map(),
    turns: [],
    turnIndex: new Map(),
    turnSeed: 0,
    whiteboard: null,
    captionText: "",
    captionClearTimer: 0,
    captionAdvanceTimer: 0,
    captionQueue: [],
    captionsEnabled: true,
    continuationTimer: 0,
    activeBoardPartialKey: "",
    activeBoardPartialText: "",
    pauseAutoContinuation: false,
    suppressNextTutorResponse: false,
    lessonCompleted: false
  };

  if (typeof window.createRealtimeWhiteboard === "function" && els.canvas) {
    try {
      state.whiteboard = window.createRealtimeWhiteboard({
        canvas: els.canvas,
        fullscreenButton: els.fullscreen
      });
    } catch (error) {
      queueMicrotask(() => {
        setError(error instanceof Error ? error.message : String(error));
      });
    }
  }

  try {
    const savedCaptions = window.localStorage.getItem("realtime-captions-enabled");
    if (savedCaptions !== null) {
      state.captionsEnabled = savedCaptions !== "false";
    }
  } catch {
    // Ignore storage read failures.
  }

  function setBadge(el, text, tone) {
    if (!el) {
      return;
    }

    el.textContent = text;
    el.className = "badge";
    el.classList.add(tone || "subtle");
  }

  function setError(message) {
    if (!els.error) {
      return;
    }

    const text = String(message || "").trim();
    els.error.hidden = text.length === 0;
    els.error.textContent = text;
  }

  function isBoardFullscreen() {
    return !!(els.shell && document.fullscreenElement === els.shell);
  }

  function clearCaptionTimer() {
    if (!state.captionClearTimer) {
      return;
    }

    window.clearTimeout(state.captionClearTimer);
    state.captionClearTimer = 0;
  }

  function clearCaptionAdvanceTimer() {
    if (!state.captionAdvanceTimer) {
      return;
    }

    window.clearTimeout(state.captionAdvanceTimer);
    state.captionAdvanceTimer = 0;
  }

  function updateCaptionsToggle() {
    if (!els.captionsToggle) {
      return;
    }

    els.captionsToggle.textContent = state.captionsEnabled ? "Subtitles on" : "Subtitles off";
    els.captionsToggle.setAttribute("aria-pressed", state.captionsEnabled ? "true" : "false");
  }

  function formatCaptionText(value) {
    const normalized = sanitizeContextText(value);
    if (!normalized) {
      return "";
    }

    if (normalized.length <= 150) {
      return normalized;
    }

    let candidate = normalized.slice(-220);
    const sentenceBoundary = Math.max(
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf("? "),
      candidate.lastIndexOf("! ")
    );
    if (sentenceBoundary >= 0 && candidate.length - (sentenceBoundary + 2) <= 150) {
      candidate = candidate.slice(sentenceBoundary + 2);
    }

    if (candidate.length > 150) {
      const tail = candidate.slice(-150);
      const firstSpace = tail.indexOf(" ");
      candidate = firstSpace > 0 ? tail.slice(firstSpace + 1) : tail;
    }

    return candidate.trim();
  }

  function renderCaptions() {
    if (!els.captions) {
      return;
    }

    const visibleText = state.captionsEnabled && isBoardFullscreen() ? state.captionText : "";
    els.captions.hidden = visibleText.length === 0;
    els.captions.textContent = visibleText;
  }

  function toggleCaptions() {
    state.captionsEnabled = !state.captionsEnabled;
    updateCaptionsToggle();
    renderCaptions();
    try {
      window.localStorage.setItem("realtime-captions-enabled", state.captionsEnabled ? "true" : "false");
    } catch {
      // Ignore storage write failures.
    }
  }

  function showNextCaptionChunk() {
    if (state.captionAdvanceTimer || state.captionQueue.length === 0) {
      return;
    }

    clearCaptionTimer();

    const next = state.captionQueue.shift();
    if (!next) {
      state.captionText = "";
      renderCaptions();
      return;
    }

    state.captionText = formatCaptionText(next.text);
    renderCaptions();

    const durationMs = Math.max(600, Math.min(2600, Number(next.durationMs) || estimateSpeechDurationMs(next.text)));
    const lingerMs = Math.max(0, Number(next.lingerMs) || 0);
    state.captionAdvanceTimer = window.setTimeout(() => {
      state.captionAdvanceTimer = 0;
      if (state.captionQueue.length > 0) {
        showNextCaptionChunk();
        return;
      }

      if (lingerMs > 0 && state.captionText) {
        state.captionClearTimer = window.setTimeout(() => {
          state.captionClearTimer = 0;
          state.captionText = "";
          renderCaptions();
        }, lingerMs);
        return;
      }

      state.captionText = "";
      renderCaptions();
    }, durationMs);
  }

  function queueCaptionChunk(text, lingerMs) {
    const formatted = formatCaptionText(text);
    if (!formatted) {
      return;
    }

    clearCaptionTimer();
    state.captionQueue.push({
      text: formatted,
      durationMs: estimateSpeechDurationMs(formatted),
      lingerMs: lingerMs || 0
    });
    showNextCaptionChunk();
  }

  function findCaptionCutoff(text, flushTail) {
    const source = String(text || "");
    if (!source) {
      return 0;
    }

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      const nextChar = source[i + 1] || "";
      if ((char === "." || char === "!" || char === "?") && (!nextChar || /\s/.test(nextChar))) {
        return i + 1;
      }
    }

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if ((char === "," || char === ";" || char === ":") && i >= 24) {
        return i + 1;
      }
    }

    if (source.length >= 72) {
      const preferredBreak = source.lastIndexOf(" ", 88);
      if (preferredBreak >= 42) {
        return preferredBreak;
      }

      const firstSpaceAfterWindow = source.indexOf(" ", 56);
      if (firstSpaceAfterWindow >= 56) {
        return firstSpaceAfterWindow;
      }
    }

    return flushTail ? source.length : 0;
  }

  function queueCaptionSegments(responseState, deltaText, finalized) {
    if (!responseState) {
      return;
    }

    responseState.captionBuffer = `${responseState.captionBuffer || ""}${deltaText || ""}`;
    if (!responseState.captionBuffer) {
      return;
    }

    while (true) {
      const cutoff = findCaptionCutoff(responseState.captionBuffer, finalized);
      if (cutoff <= 0) {
        break;
      }

      const chunk = sanitizeContextText(responseState.captionBuffer.slice(0, cutoff));
      responseState.captionBuffer = responseState.captionBuffer.slice(cutoff);
      if (chunk) {
        queueCaptionChunk(chunk, finalized && !sanitizeContextText(responseState.captionBuffer) ? 900 : 0);
      }
    }
  }

  function clearCaptions() {
    clearCaptionTimer();
    clearCaptionAdvanceTimer();
    state.captionQueue = [];
    state.captionText = "";
    renderCaptions();
  }

  function clearBoardPartial() {
    state.activeBoardPartialKey = "";
    state.activeBoardPartialText = "";
    if (state.whiteboard) {
      state.whiteboard.cancelPartial();
    }
  }

  function showBoardPartial(partialKey, text) {
    const partialText = String(text || "");
    if (!partialText) {
      clearBoardPartial();
      return;
    }

    if (state.activeBoardPartialKey === partialKey && state.activeBoardPartialText === partialText) {
      return;
    }

    state.activeBoardPartialKey = partialKey;
    state.activeBoardPartialText = partialText;
    if (state.whiteboard) {
      state.whiteboard.cancelPartial();
      state.whiteboard.appendDelta(partialText);
    }
  }

  function commitBoardLine(line) {
    const text = String(line || "").trim();
    if (!text || !state.whiteboard) {
      return;
    }

    clearBoardPartial();
    state.whiteboard.appendDelta(`${text}\n`);
    state.whiteboard.finalizeText("");
  }

  function applyBoardMutationToSnapshot(snapshot, rawLine) {
    const lines = Array.isArray(snapshot) ? snapshot : [];
    const text = String(rawLine || "").trim();
    if (!text) {
      return lines;
    }

    const lower = text.toLowerCase();
    if (lower === "[clear]") {
      lines.length = 0;
      return lines;
    }

    if (lower === "[pop]") {
      if (lines.length > 0) {
        lines.pop();
      }
      return lines;
    }

    if (lower.startsWith("[replace-last]")) {
      const replacement = text.slice("[replace-last]".length).trim();
      if (!replacement) {
        return lines;
      }
      if (lines.length === 0) {
        lines.push(replacement);
      } else {
        lines[lines.length - 1] = replacement;
      }
      return lines;
    }

    if (lines.includes(text)) {
      return lines;
    }

    lines.push(text);
    return lines;
  }

  function getProjectedBoardLines(responseState) {
    const projected = state.whiteboard ? state.whiteboard.getLines().slice() : [];
    if (!responseState || !Array.isArray(responseState.boardPlans)) {
      return projected;
    }

    for (const plan of responseState.boardPlans) {
      if (!plan || plan.committed) {
        continue;
      }
      applyBoardMutationToSnapshot(projected, plan.line);
    }

    return projected;
  }

  function filterPlannedBoardLines(responseState, lines) {
    const filtered = [];
    const projected = getProjectedBoardLines(responseState);

    for (const rawLine of Array.isArray(lines) ? lines : []) {
      const text = String(rawLine || "").trim();
      if (!text) {
        continue;
      }

      const beforeLength = projected.length;
      const beforeLast = beforeLength > 0 ? projected[beforeLength - 1] : "";
      applyBoardMutationToSnapshot(projected, text);

      const afterLength = projected.length;
      const afterLast = afterLength > 0 ? projected[afterLength - 1] : "";
      const changed = afterLength !== beforeLength || afterLast !== beforeLast;
      if (changed || /^\[(?:clear|pop|replace-last)\]/i.test(text) || /^draw:\s*clear$/i.test(text)) {
        filtered.push(text);
      }
    }

    return filtered;
  }

  function isBoardClearRequest(text) {
    const normalized = sanitizeContextText(text).toLowerCase();
    if (!normalized) {
      return false;
    }

    const mentionsBoard = normalized.includes("board")
      || normalized.includes("whiteboard")
      || normalized.includes("screen")
      || normalized.includes("everything")
      || normalized.includes("all of it")
      || normalized.includes("all that");
    const mentionsClearVerb = normalized.includes("clear")
      || normalized.includes("erase")
      || normalized.includes("wipe")
      || normalized.includes("reset")
      || normalized.includes("start over")
      || normalized.includes("start fresh");

    return mentionsClearVerb && (mentionsBoard || normalized === "clear" || normalized === "reset");
  }

  function isPureBoardClearRequest(text) {
    if (!isBoardClearRequest(text)) {
      return false;
    }

    let normalized = sanitizeContextText(text).toLowerCase();
    normalized = normalized
      .replace(/\b(?:please|pls|can|could|would|will|you|just|the|a|an|my|our|this|that|it|board|whiteboard|screen|everything|all of it|all that)\b/g, " ")
      .replace(/\b(?:clear|erase|wipe|reset)\b/g, " ")
      .replace(/\bstart\s+(?:over|fresh)\b/g, " ")
      .replace(/[?!.,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return normalized.length === 0;
  }

  function clearBoardStateForStudentRequest() {
    clearBoardPartial();

    if (state.whiteboard) {
      state.whiteboard.reset();
    }

    for (const responseState of state.tutorResponses.values()) {
      if (!responseState) {
        continue;
      }

      abortBoardSync(responseState);
      responseState.boardPlans = [];
      responseState.boardPlanSeed = 0;
      responseState.boardSyncCursor = String(responseState.transcript || "").length;
    }

    updateIndicators();
  }

  function pruneCommittedBoardPlans(responseState) {
    if (!responseState || !Array.isArray(responseState.boardPlans) || responseState.boardPlans.length === 0) {
      return;
    }

    let removeCount = 0;
    while (removeCount < responseState.boardPlans.length && responseState.boardPlans[removeCount].committed) {
      removeCount += 1;
    }

    if (removeCount > 0) {
      responseState.boardPlans.splice(0, removeCount);
    }
  }

  function dropUnspokenBoardPlans(responseState) {
    if (!responseState) {
      return;
    }

    clearBoardPartial();
    if (Array.isArray(responseState.boardPlans)) {
      responseState.boardPlans = responseState.boardPlans.filter((plan) => plan && plan.committed);
    }
  }

  function clearContinuationTimer() {
    if (!state.continuationTimer) {
      return;
    }

    window.clearTimeout(state.continuationTimer);
    state.continuationTimer = 0;
  }

  function estimateSpeechDurationMs(text) {
    const words = sanitizeContextText(text)
      .split(/\s+/)
      .filter(Boolean)
      .length;

    return Math.max(900, Math.min(3200, words * 260));
  }

  function isLessonCompleteTranscript(text) {
    return /\blesson complete\b/i.test(sanitizeContextText(text));
  }

  function scheduleTutorContinuation() {
    clearContinuationTimer();

    if (!state.connected || !state.channelOpen || state.studentSpeaking || state.lessonCompleted || state.pauseAutoContinuation) {
      return;
    }

    state.continuationTimer = window.setTimeout(() => {
      state.continuationTimer = 0;

      if (!state.connected || !state.channelOpen || state.studentSpeaking || state.lessonCompleted || state.pauseAutoContinuation) {
        return;
      }

      if (getActiveTutorResponse() || hasPendingBoardWork()) {
        scheduleTutorContinuation();
        return;
      }

      try {
        requestTutorResponse(
          "Continue the lesson from exactly where you left off. Keep teaching in short step-by-step chunks. " +
          "Do not stop unless the student interrupts. At the very end of the complete lesson, say exactly 'Lesson complete.'"
        );
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      }
    }, 320);
  }

  function getPrimaryMicTrack() {
    if (!state.localStream) {
      return null;
    }

    const tracks = state.localStream.getAudioTracks();
    return tracks.length > 0 ? tracks[0] : null;
  }

  function nextTurnId(prefix) {
    state.turnSeed += 1;
    return `${prefix}-${state.turnSeed}`;
  }

  function rebuildTurnIndex() {
    state.turnIndex.clear();
    state.turns.forEach((turn, index) => {
      state.turnIndex.set(turn.id, index);
    });
  }

  function upsertTurn(id, role, label, text) {
    if (!id) {
      return null;
    }

    const existingIndex = state.turnIndex.get(id);
    if (typeof existingIndex === "number") {
      const existing = state.turns[existingIndex];
      existing.role = role;
      existing.label = label;
      existing.text = text;
      return existing;
    }

    const turn = { id, role, label, text };
    state.turnIndex.set(id, state.turns.length);
    state.turns.push(turn);
    return turn;
  }

  function removeTurn(id) {
    const index = state.turnIndex.get(id);
    if (typeof index !== "number") {
      return;
    }

    state.turns.splice(index, 1);
    rebuildTurnIndex();
  }

  function renderThread() {
    if (!els.thread) {
      return;
    }

    els.thread.innerHTML = "";
    if (state.turns.length === 0) {
      const empty = document.createElement("div");
      empty.className = "realtime-thread-empty";
      empty.textContent = "Your conversation transcript will show up here.";
      els.thread.appendChild(empty);
      return;
    }

    for (const turn of state.turns) {
      const article = document.createElement("article");
      article.className = `realtime-turn ${turn.role}`;

      const heading = document.createElement("div");
      heading.className = "realtime-turn-role";
      heading.textContent = turn.label;

      const body = document.createElement("div");
      body.className = "realtime-turn-text";
      body.textContent = turn.text || (turn.role === "assistant" ? "..." : "");

      article.appendChild(heading);
      article.appendChild(body);
      els.thread.appendChild(article);
    }

    els.thread.scrollTop = els.thread.scrollHeight;
  }

  function clearBoardSyncTimer(responseState) {
    if (!responseState || !responseState.boardSyncTimer) {
      return;
    }

    window.clearTimeout(responseState.boardSyncTimer);
    responseState.boardSyncTimer = 0;
  }

  function abortBoardSync(responseState) {
    if (!responseState) {
      return;
    }

    clearBoardSyncTimer(responseState);
    responseState.boardSyncQueued = false;
    responseState.boardSyncForceNext = false;

    if (responseState.boardSyncAbortController) {
      responseState.boardSyncAbortController.abort();
      responseState.boardSyncAbortController = null;
    }

    responseState.boardSyncInFlight = false;
  }

  function cleanupResponseState(responseState) {
    if (!responseState) {
      return;
    }

    abortBoardSync(responseState);
    if (state.activeBoardPartialKey && String(state.activeBoardPartialKey).startsWith(`${responseState.turnId}:`)) {
      clearBoardPartial();
    }
    responseState.boardPlans = [];
  }

  function hasBoardContent() {
    return !!(state.whiteboard && state.whiteboard.getLineCount() > 0);
  }

  function getActiveTutorResponse() {
    if (!state.activeTutorResponseId) {
      return null;
    }

    const responseState = state.tutorResponses.get(state.activeTutorResponseId) || null;
    if (!responseState || responseState.cancelling) {
      return null;
    }

    return responseState;
  }

  function hasPendingBoardWork() {
    if (state.activeBoardPartialText) {
      return true;
    }

    for (const responseState of state.tutorResponses.values()) {
      if (!responseState || responseState.cancelling) {
        continue;
      }

      if (responseState.boardSyncInFlight || responseState.boardSyncQueued || responseState.boardSyncTimer) {
        return true;
      }

      const remaining = responseState.transcript.slice(responseState.boardSyncCursor);
      if (findSyncCutoff(remaining, responseState.done) > 0) {
        return true;
      }

      if (Array.isArray(responseState.boardPlans) && responseState.boardPlans.some((plan) => plan && !plan.committed)) {
        return true;
      }
    }

    return false;
  }

  function syncControls() {
    const busy = state.connecting;
    const live = state.connected;
    const micTrack = getPrimaryMicTrack();

    if (els.start) {
      els.start.disabled = !state.available || busy || live;
    }
    if (els.stop) {
      els.stop.disabled = !busy && !live && !state.pc;
    }
    if (els.mic) {
      els.mic.disabled = !live || !micTrack;
      els.mic.textContent = state.micMuted ? "Unmute mic" : "Mute mic";
    }
    if (els.send) {
      els.send.disabled = !live || !state.channelOpen;
    }
  }

  function updateIndicators() {
    const tutorActive = !!getActiveTutorResponse();
    const boardBusy = hasPendingBoardWork();

    if (state.connecting) {
      setBadge(els.status, "Connecting...", "subtle");
      setBadge(els.boardStatus, "Connecting", "subtle");
      setBadge(els.liveIndicator, "Connecting", "subtle");
      return;
    }

    if (!state.connected) {
      setBadge(els.status, "Disconnected", "subtle");
      setBadge(els.boardStatus, hasBoardContent() ? "Session ended" : "Waiting", "subtle");
      setBadge(els.liveIndicator, "Idle", "subtle");
      return;
    }

    if (state.studentSpeaking) {
      setBadge(els.status, "Listening", "good");
      setBadge(els.boardStatus, boardBusy ? "Paused for interruption" : (hasBoardContent() ? "Board ready" : "Waiting"), "good");
      setBadge(els.liveIndicator, state.micMuted ? "Student speaking (muted)" : "Student speaking", "good");
      return;
    }

    if (tutorActive) {
      setBadge(els.status, "Tutor responding", "good");
      setBadge(els.boardStatus, boardBusy ? "Writing live" : (hasBoardContent() ? "Listening for next step" : "Waiting for board"), boardBusy ? "good" : "subtle");
      setBadge(els.liveIndicator, "Tutor speaking", "good");
      return;
    }

    if (boardBusy) {
      setBadge(els.status, "Live", "good");
      setBadge(els.boardStatus, "Writing live", "good");
      setBadge(els.liveIndicator, state.micMuted ? "Mic muted" : "Finishing board", state.micMuted ? "subtle" : "good");
      return;
    }

    setBadge(els.status, "Live", "good");
    setBadge(els.boardStatus, hasBoardContent() ? "Ready for next turn" : "Waiting", "subtle");
    setBadge(els.liveIndicator, state.micMuted ? "Mic muted" : "Mic live", state.micMuted ? "subtle" : "good");
  }

  function resetSessionView() {
    for (const responseState of state.tutorResponses.values()) {
      cleanupResponseState(responseState);
    }

    clearBoardPartial();
    clearContinuationTimer();
    state.activeTutorResponseId = null;
    state.tutorResponses.clear();
    state.turns = [];
    state.turnIndex.clear();
    state.turnSeed = 0;
    state.pauseAutoContinuation = false;
    state.suppressNextTutorResponse = false;
    state.lessonCompleted = false;

    if (state.whiteboard) {
      state.whiteboard.reset();
    }

    clearCaptions();
    renderThread();
    updateIndicators();
  }

  function getResponseId(event) {
    return event.response_id
      || (event.response && event.response.id)
      || (event.response && event.response.response_id)
      || null;
  }

  function ensureTutorResponse(responseId) {
    if (!responseId) {
      return null;
    }

    let responseState = state.tutorResponses.get(responseId);
    if (!responseState) {
      responseState = {
        transcript: "",
        turnId: `assistant-${responseId}`,
        cancelling: false,
        done: false,
        captionBuffer: "",
        boardPlans: [],
        boardPlanSeed: 0,
        boardSyncCursor: 0,
        boardSyncInFlight: false,
        boardSyncQueued: false,
        boardSyncForceNext: false,
        boardSyncTimer: 0,
        boardSyncAbortController: null
      };
      state.tutorResponses.set(responseId, responseState);
    }

    if (state.activeTutorResponseId && state.activeTutorResponseId !== responseId) {
      const previous = state.tutorResponses.get(state.activeTutorResponseId);
      if (previous) {
        previous.done = true;
        maybeFinalizeTutorResponse(state.activeTutorResponseId);
      }
    }

    clearContinuationTimer();
    state.activeTutorResponseId = responseId;
    responseState.cancelling = false;
    upsertTurn(responseState.turnId, "assistant", "Tutor", responseState.transcript);
    return responseState;
  }

  function buildConversationSnapshot() {
    return state.turns
      .slice(-8)
      .map((turn) => `${turn.role === "assistant" ? "Tutor" : "Student"}: ${sanitizeContextText(turn.text)}`)
      .filter((line) => line.length > 0);
  }

  function sanitizeContextText(value) {
    return String(value || "")
      .replace(/\r/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function postJson(url, body, signal) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal
    });

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!response.ok) {
      const message = json && (json.message || json.title) ? (json.message || json.title) : text;
      throw new Error(message || `Request failed (${response.status})`);
    }

    return json;
  }

  async function postSdp(url, sdp) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: sdp
    });

    const text = await response.text();
    if (!response.ok) {
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      const message = json && (json.message || json.title) ? (json.message || json.title) : text;
      throw new Error(message || `Request failed (${response.status})`);
    }

    return text;
  }

  async function waitForIceGatheringComplete(pc) {
    if (!pc || pc.iceGatheringState === "complete") {
      return;
    }

    await new Promise((resolve) => {
      const timeoutId = window.setTimeout(() => {
        pc.removeEventListener("icegatheringstatechange", handleChange);
        resolve();
      }, 1500);

      function handleChange() {
        if (pc.iceGatheringState !== "complete") {
          return;
        }

        window.clearTimeout(timeoutId);
        pc.removeEventListener("icegatheringstatechange", handleChange);
        resolve();
      }

      pc.addEventListener("icegatheringstatechange", handleChange);
    });
  }

  function sendEvent(payload) {
    if (!state.dataChannel || state.dataChannel.readyState !== "open") {
      throw new Error("Realtime data channel is not open yet.");
    }

    state.dataChannel.send(JSON.stringify(payload));
  }

  function buildSpokenLessonInstructions(topic) {
    return [
      `You are a live SAT tutor in a two-way voice lesson. The lesson topic is: ${topic}.`,
      "",
      "Primary behavior:",
      "- Start immediately with a one-sentence welcome, then teach the first important concept.",
      "- Speak naturally in very short step-sized chunks so the student can interrupt at any time.",
      "- Keep teaching proactively until the full lesson is complete; do not stop after one answer unless the student interrupts.",
      "- Treat the lesson as a sequence of mini-turns, usually 1 to 2 sentences each, then continue.",
      "- If the student interrupts with speech or text, answer that interruption directly before deciding whether to resume the earlier thread.",
      "- Keep explanations SAT-oriented, concrete, and step-by-step.",
      "- Ask quick comprehension checks when useful.",
      "- Never quote copyrighted SAT prompts.",
      "- At the true end of the full lesson, give a short recap and say exactly 'Lesson complete.'",
      "",
      "Board coordination:",
      "- There is a live whiteboard following your explanation in real time.",
      "- When you want something written, say the exact equation, label, step, or diagram detail out loud.",
      "- If the student asks for a board change, explicitly say what you are writing, drawing, clearing, replacing, labeling, or moving on the board.",
      "- Avoid vague references like 'put that there' or 'change this one' without naming the actual board content.",
      "- Keep prior board work visible unless the student explicitly asks to clear, erase, replace, or remove something.",
      "",
      "Voice style:",
      "- Warm adult woman with a subtle Southern U.S. accent.",
      "- Friendly, confident classroom teacher.",
      "- Conversational pacing with short pauses after key steps.",
      "- Sound like a real one-on-one tutor from the American South."
    ].join("\n");
  }

  function sendTutorTextTurn(text) {
    sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text
          }
        ]
      }
    });
    sendEvent({ type: "response.create" });
  }

  function requestTutorResponse(instructions) {
    const text = sanitizeContextText(instructions);
    if (!text) {
      return;
    }

    sendEvent({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions: text
      }
    });
  }

  function configureSession() {
    if (!state.channelOpen || state.sessionUpdateSent) {
      return;
    }

    state.sessionUpdateSent = true;
    sendEvent({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: buildSpokenLessonInstructions(state.sessionTopic),
        output_modalities: ["audio"],
        audio: {
          input: {
            turn_detection: {
              type: "semantic_vad",
              create_response: true,
              interrupt_response: true
            }
          }
        }
      }
    });

    state.sessionConfigured = true;
    updateIndicators();
    startLessonTurn();
  }

  function startLessonTurn() {
    if (!state.channelOpen || !state.sessionConfigured || state.lessonStarted) {
      return;
    }

    state.lessonStarted = true;
    state.lessonCompleted = false;
    requestTutorResponse(`Start a live lesson on ${state.sessionTopic}. Begin teaching immediately.`);
    updateIndicators();
  }

  function resolveRealtimeError(event) {
    if (!event) {
      return "Unknown realtime error.";
    }

    if (event.error && event.error.message) {
      return event.error.message;
    }

    if (event.message) {
      return event.message;
    }

    return "Realtime connection failed.";
  }

  function shouldIgnoreRealtimeError(message) {
    const normalized = String(message || "").toLowerCase();
    return normalized.includes("no response to cancel")
      || normalized.includes("no active response found")
      || normalized.includes("cancellation failed")
      || normalized.includes("response is not in progress")
      || normalized.includes("nothing to cancel");
  }

  function findSyncCutoff(text, flushTail) {
    const source = String(text || "");
    if (!source) {
      return 0;
    }

    if (!source.trim()) {
      return source.length;
    }

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      const nextChar = source[i + 1] || "";
      if ((char === "." || char === "!" || char === "?") && (!nextChar || /\s/.test(nextChar))) {
        return i + 1;
      }
    }

    if (source.length >= 48) {
      const separators = [";", ":", ","];
      for (const separator of separators) {
        const separatorIndex = source.indexOf(separator);
        if (separatorIndex >= 28) {
          return separatorIndex + 1;
        }
      }

      const cuePhrases = [" then ", " now ", " next ", " so ", " therefore ", " finally "];
      for (const phrase of cuePhrases) {
        const cueIndex = source.toLowerCase().indexOf(phrase);
        if (cueIndex >= 24) {
          return cueIndex;
        }
      }
    }

    if (source.length >= 90) {
      const preferredBreak = source.lastIndexOf(" ", 110);
      if (preferredBreak >= 55) {
        return preferredBreak;
      }

      const firstSpaceAfterWindow = source.indexOf(" ", 70);
      if (firstSpaceAfterWindow >= 70) {
        return firstSpaceAfterWindow;
      }
    }

    if (flushTail) {
      return source.length;
    }

    return 0;
  }

  function normalizeForCueMatch(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\r/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[“”"']/g, "")
      .replace(/[.,!?;:()[\]{}]/g, "")
      .trim();
  }

  function tokenizeNarration(text) {
    const tokens = [];
    const src = String(text || "");
    const re = /[A-Za-z0-9]+/g;
    let match = re.exec(src);
    while (match) {
      tokens.push({ word: match[0].toLowerCase(), index: match.index });
      match = re.exec(src);
    }
    return tokens;
  }

  function normalizeForSearch(text) {
    const src = String(text || "");
    let normalized = "";
    const sourceMap = [];
    let pendingSpace = false;
    let hasAny = false;

    for (let i = 0; i < src.length; i += 1) {
      const char = src[i].toLowerCase();
      if (/[a-z0-9]/.test(char)) {
        if (pendingSpace && hasAny) {
          normalized += " ";
          sourceMap.push(i);
        }
        normalized += char;
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
      if (!isNumber && token.length <= 1 && !keepSingles.has(token)) {
        continue;
      }
      if (stop.has(token) || seen.has(token)) {
        continue;
      }
      seen.add(token);
      out.push(token);
      if (out.length >= 8) {
        break;
      }
    }
    return out;
  }

  function findTokenIndexFrom(tokens, keyword, fromIndex) {
    for (let i = Math.max(0, fromIndex || 0); i < tokens.length; i += 1) {
      if (tokens[i].word === keyword) {
        return i;
      }
    }
    return -1;
  }

  function findKeywordWindow(tokens, keywords, fromTokenIndex) {
    if (!Array.isArray(tokens) || tokens.length === 0 || !Array.isArray(keywords) || keywords.length === 0) {
      return null;
    }

    let first = -1;
    let last = -1;
    let cursor = Math.max(0, fromTokenIndex || 0);
    let foundCount = 0;

    for (const keyword of keywords) {
      const index = findTokenIndexFrom(tokens, keyword, cursor);
      if (index < 0) {
        continue;
      }
      if (first < 0) {
        first = index;
      }
      last = index;
      cursor = index + 1;
      foundCount += 1;
    }

    if (first < 0 || last < 0 || foundCount <= 0) {
      return null;
    }

    const minRequired = keywords.length >= 3 ? 2 : 1;
    if (foundCount < minRequired) {
      return null;
    }

    return {
      startChar: tokens[first].index,
      endChar: tokens[last].index + tokens[last].word.length,
      nextTokenCursor: cursor
    };
  }

  function isWriteCueToken(token) {
    const normalized = String(token || "").toLowerCase();
    return normalized === "write"
      || normalized === "writing"
      || normalized === "board"
      || normalized === "draw"
      || normalized === "drawing"
      || normalized === "graph"
      || normalized === "plot"
      || normalized === "sketch";
  }

  function findCueBeforeChar(tokens, targetChar, maxDistanceChars) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return -1;
    }

    const target = Math.max(0, Math.floor(Number.isFinite(targetChar) ? targetChar : 0));
    const maxDistance = Math.max(12, Math.floor(Number.isFinite(maxDistanceChars) ? maxDistanceChars : 140));
    let best = -1;
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!token || !Number.isFinite(token.index)) {
        continue;
      }
      if (token.index >= target) {
        break;
      }
      if (!isWriteCueToken(token.word)) {
        continue;
      }
      if ((target - token.index) > maxDistance) {
        continue;
      }
      best = token.index;
    }
    return best;
  }

  function buildBoardStepEntries(lines) {
    return lines
      .map((rawLine) => String(rawLine || "").trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        if (/^draw\b\s*[:\-]?/i.test(line)) {
          return {
            kind: "draw",
            line,
            syncText: line.replace(/^draw\b\s*[:\-]?\s*/i, "").trim()
          };
        }
        return {
          kind: "text",
          line,
          syncText: line
        };
      });
  }

  function planBoardChunkLines(responseState, transcriptChunk, lines, chunkStartChar) {
    const entries = buildBoardStepEntries(lines);
    if (!responseState || entries.length === 0) {
      return [];
    }

    const chunkText = String(transcriptChunk || "");
    const chunkLength = Math.max(1, chunkText.length);
    const chunkEndChar = chunkStartChar + chunkLength;
    const tokens = tokenizeNarration(chunkText);
    const normalizedNarration = normalizeForSearch(chunkText);
    const existingPlans = Array.isArray(responseState.boardPlans) ? responseState.boardPlans : [];

    let normCursor = 0;
    let tokenCursor = 0;
    let previousStartChar = existingPlans.length > 0
      ? existingPlans[existingPlans.length - 1].startChar
      : Math.max(0, chunkStartChar - 1);

    return entries.map((entry, index) => {
      const fallbackStart = chunkStartChar + Math.floor((index / Math.max(1, entries.length)) * chunkLength);
      let startChar = fallbackStart;
      let endChar = Math.min(chunkEndChar, startChar + Math.max(1, Math.floor(chunkLength / Math.max(2, entries.length + 1))));
      let matched = false;

      if (entry.kind === "text") {
        const normalizedStep = normalizeForSearch(entry.syncText).normalized;
        if (normalizedStep.length >= 4 && normalizedNarration.normalized.length > 0) {
          const matchIndex = normalizedNarration.normalized.indexOf(normalizedStep, normCursor);
          if (matchIndex >= 0) {
            const startMap = normalizedNarration.sourceMap[matchIndex];
            const endMapIndex = Math.min(normalizedNarration.sourceMap.length - 1, matchIndex + normalizedStep.length - 1);
            const endMap = normalizedNarration.sourceMap[endMapIndex];
            if (Number.isFinite(startMap) && Number.isFinite(endMap)) {
              startChar = chunkStartChar + startMap;
              endChar = chunkStartChar + endMap + 1;
              matched = true;
              normCursor = matchIndex + normalizedStep.length;
              while (tokenCursor < tokens.length && tokens[tokenCursor].index < startMap) {
                tokenCursor += 1;
              }
            }
          }
        }
      }

      if (!matched) {
        const keywords = extractSyncKeywords(entry.syncText);
        const window = findKeywordWindow(tokens, keywords, tokenCursor);
        if (window) {
          startChar = chunkStartChar + window.startChar;
          endChar = chunkStartChar + window.endChar;
          tokenCursor = window.nextTokenCursor;
          matched = true;
        }
      }

      if (matched) {
        const cueChar = findCueBeforeChar(tokens, startChar - chunkStartChar, entry.kind === "draw" ? 42 : 180);
        if (cueChar >= 0) {
          startChar = Math.min(startChar, chunkStartChar + cueChar);
        }
      }

      const minSpan = entry.kind === "draw"
        ? Math.max(8, Math.min(20, Math.floor(chunkLength * 0.08)))
        : Math.max(4, Math.min(24, Math.floor(entry.line.length * 0.45)));
      const maxSpan = entry.kind === "draw"
        ? Math.max(minSpan + 4, Math.min(48, Math.floor(chunkLength * 0.22)))
        : Math.max(minSpan + 4, Math.min(72, Math.floor(entry.line.length * 1.8)));

      startChar = Math.max(chunkStartChar, Math.min(chunkEndChar, startChar));
      if (startChar <= previousStartChar) {
        startChar = Math.min(chunkEndChar, previousStartChar + 1);
      }

      endChar = Math.max(startChar + minSpan, endChar);
      endChar = Math.min(chunkEndChar, Math.min(endChar, startChar + maxSpan));
      if (endChar <= startChar) {
        endChar = Math.min(chunkEndChar, startChar + 1);
      }

      previousStartChar = startChar;
      responseState.boardPlanSeed = (responseState.boardPlanSeed || 0) + 1;

      return {
        id: responseState.boardPlanSeed,
        kind: entry.kind,
        line: entry.line,
        startChar,
        endChar,
        committed: false
      };
    });
  }

  function reconcileBoardPlayback(responseState, forceCommitAll) {
    if (!responseState || !state.whiteboard) {
      return;
    }

    const plans = Array.isArray(responseState.boardPlans) ? responseState.boardPlans : [];
    if (plans.length === 0) {
      clearBoardPartial();
      updateIndicators();
      return;
    }

    const spokenCharIndex = forceCommitAll
      ? Number.MAX_SAFE_INTEGER
      : String(responseState.transcript || "").length;
    let showedPartial = false;

    for (const plan of plans) {
      if (!plan || plan.committed) {
        continue;
      }

      if (plan.kind === "draw") {
        if (spokenCharIndex >= plan.startChar) {
          commitBoardLine(plan.line);
          plan.committed = true;
          continue;
        }
        break;
      }

      if (spokenCharIndex >= plan.endChar) {
        commitBoardLine(plan.line);
        plan.committed = true;
        continue;
      }

      if (spokenCharIndex > plan.startChar) {
        const span = Math.max(1, plan.endChar - plan.startChar);
        const local = Math.max(0, Math.min(1, (spokenCharIndex - plan.startChar) / span));
        const count = Math.max(0, Math.min(plan.line.length, Math.floor(plan.line.length * local)));
        if (count > 0) {
          showBoardPartial(`${responseState.turnId}:${plan.id}`, plan.line.slice(0, count));
          showedPartial = true;
        }
      }
      break;
    }

    if (!showedPartial) {
      clearBoardPartial();
    }

    pruneCommittedBoardPlans(responseState);
    updateIndicators();
  }

  function maybeFinalizeTutorResponse(responseId) {
    const responseState = state.tutorResponses.get(responseId);
    if (!responseState || !responseState.done) {
      return;
    }

    if (responseState.cancelling) {
      finalizeTutorResponse(responseId);
      return;
    }

    if (responseState.boardSyncInFlight || responseState.boardSyncTimer) {
      return;
    }

    if (Array.isArray(responseState.boardPlans) && responseState.boardPlans.some((plan) => plan && !plan.committed)) {
      reconcileBoardPlayback(responseState, responseState.done);
      if (responseState.boardPlans.some((plan) => plan && !plan.committed)) {
        return;
      }
    }

    const remaining = responseState.transcript.slice(responseState.boardSyncCursor);
    if (findSyncCutoff(remaining, true) > 0) {
      scheduleBoardSync(responseId, true);
      return;
    }

    finalizeTutorResponse(responseId);
  }

  function finalizeTutorResponse(responseId) {
    if (!responseId) {
      return;
    }

    const responseState = state.tutorResponses.get(responseId);
    if (!responseState) {
      if (state.activeTutorResponseId === responseId) {
        state.activeTutorResponseId = null;
      }
      updateIndicators();
      return;
    }

    cleanupResponseState(responseState);

    if (!String(responseState.transcript || "").trim()) {
      removeTurn(responseState.turnId);
    }

    state.tutorResponses.delete(responseId);
    if (state.activeTutorResponseId === responseId) {
      state.activeTutorResponseId = null;
    }

    renderThread();
    updateIndicators();
  }

  function scheduleBoardSync(responseId, force) {
    const responseState = state.tutorResponses.get(responseId);
    if (!responseState || responseState.cancelling) {
      return;
    }

    if (responseState.boardSyncInFlight) {
      responseState.boardSyncQueued = true;
      responseState.boardSyncForceNext = responseState.boardSyncForceNext || !!force;
      return;
    }

    clearBoardSyncTimer(responseState);

    const remaining = responseState.transcript.slice(responseState.boardSyncCursor);
    const cutoff = findSyncCutoff(remaining, force || responseState.done);
    if (cutoff <= 0) {
      if (responseState.done) {
        maybeFinalizeTutorResponse(responseId);
      }
      return;
    }

    const chunk = remaining.slice(0, cutoff);
    const quickBoundary = force || /[.!?]\s*$/.test(chunk) || chunk.length >= 120;
    const delay = quickBoundary ? 120 : 520;

    responseState.boardSyncTimer = window.setTimeout(() => {
      responseState.boardSyncTimer = 0;
      void flushBoardSync(responseId, force || responseState.done);
    }, delay);

    updateIndicators();
  }

  async function flushBoardSync(responseId, force) {
    const responseState = state.tutorResponses.get(responseId);
    if (!responseState || responseState.cancelling || !state.whiteboard) {
      return;
    }

    if (responseState.boardSyncInFlight) {
      responseState.boardSyncQueued = true;
      responseState.boardSyncForceNext = responseState.boardSyncForceNext || !!force;
      return;
    }

    clearBoardSyncTimer(responseState);

    const remaining = responseState.transcript.slice(responseState.boardSyncCursor);
    const cutoff = findSyncCutoff(remaining, force || responseState.done);
    if (cutoff <= 0) {
      maybeFinalizeTutorResponse(responseId);
      updateIndicators();
      return;
    }

    const chunk = remaining.slice(0, cutoff);
    if (!chunk.trim()) {
      responseState.boardSyncCursor += cutoff;
      maybeFinalizeTutorResponse(responseId);
      updateIndicators();
      return;
    }

    responseState.boardSyncInFlight = true;
    const controller = new AbortController();
    responseState.boardSyncAbortController = controller;
    let advancedCursor = false;
    updateIndicators();

    try {
      const result = await postJson(
        state.boardSyncUrl,
        {
          topic: state.sessionTopic,
          assistantTranscriptChunk: chunk,
          assistantTranscriptSoFar: responseState.transcript.slice(0, responseState.boardSyncCursor + cutoff),
          recentConversation: buildConversationSnapshot(),
          boardLines: getProjectedBoardLines(responseState),
          isFinalChunk: !!(force || responseState.done)
        },
        controller.signal
      );

      if (!state.tutorResponses.has(responseId) || responseState.cancelling) {
        return;
      }

      const rawLines = result && Array.isArray(result.lines) ? result.lines : [];
      const lines = filterPlannedBoardLines(responseState, rawLines);
      if (lines.length > 0) {
        const plannedLines = planBoardChunkLines(responseState, chunk, lines, responseState.boardSyncCursor);
        if (plannedLines.length > 0) {
          responseState.boardPlans.push(...plannedLines);
        }
      }
      responseState.boardSyncCursor += cutoff;
      advancedCursor = true;
      reconcileBoardPlayback(responseState, false);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setError(error instanceof Error ? `Whiteboard sync error: ${error.message}` : "Whiteboard sync failed.");
        if (responseState.done) {
          responseState.boardSyncCursor += cutoff;
          advancedCursor = true;
        }
      }
    } finally {
      if (responseState.boardSyncAbortController === controller) {
        responseState.boardSyncAbortController = null;
      }
      responseState.boardSyncInFlight = false;

      if (!state.tutorResponses.has(responseId)) {
        updateIndicators();
        return;
      }

      if (responseState.cancelling) {
        maybeFinalizeTutorResponse(responseId);
        updateIndicators();
        return;
      }

      if (responseState.boardSyncQueued) {
        const nextForce = responseState.boardSyncForceNext;
        responseState.boardSyncQueued = false;
        responseState.boardSyncForceNext = false;
        window.setTimeout(() => {
          void flushBoardSync(responseId, nextForce || responseState.done);
        }, 0);
        updateIndicators();
        return;
      }

      if (advancedCursor) {
        const remainingAfter = responseState.transcript.slice(responseState.boardSyncCursor);
        if (findSyncCutoff(remainingAfter, responseState.done) > 0) {
          window.setTimeout(() => {
            scheduleBoardSync(responseId, responseState.done);
          }, 0);
          updateIndicators();
          return;
        }
      }

      if (responseState.done) {
        maybeFinalizeTutorResponse(responseId);
      }

      updateIndicators();
    }
  }

  function handleTutorTranscriptDelta(event) {
    const responseId = getResponseId(event);
    const responseState = ensureTutorResponse(responseId);
    if (!responseState || responseState.cancelling) {
      return;
    }

    responseState.transcript += event.delta || "";
    upsertTurn(responseState.turnId, "assistant", "Tutor", responseState.transcript);
    queueCaptionSegments(responseState, event.delta || "", false);
    reconcileBoardPlayback(responseState, false);
    renderThread();
    scheduleBoardSync(responseId, false);
    updateIndicators();
  }

  function handleTutorTranscriptDone(event) {
    const responseId = getResponseId(event);
    const responseState = ensureTutorResponse(responseId);
    if (!responseState || responseState.cancelling) {
      return;
    }

    const finalTranscript = String(event.transcript || "");
    const residualDelta = finalTranscript.startsWith(responseState.transcript)
      ? finalTranscript.slice(responseState.transcript.length)
      : "";

    if (residualDelta) {
      responseState.transcript += residualDelta;
    }

    if (event.transcript) {
      responseState.transcript = event.transcript;
    }

    upsertTurn(responseState.turnId, "assistant", "Tutor", responseState.transcript);
    queueCaptionSegments(responseState, residualDelta, true);
    reconcileBoardPlayback(responseState, false);
    renderThread();
    scheduleBoardSync(responseId, true);
    updateIndicators();
  }

  function handleResponseDone(event) {
    const responseId = getResponseId(event);
    const responseState = state.tutorResponses.get(responseId);
    if (!responseState) {
      return;
    }

    responseState.done = true;
    state.lessonCompleted = state.lessonCompleted || isLessonCompleteTranscript(responseState.transcript);
    if (event.type === "response.cancelled" && responseState.cancelling) {
      finalizeTutorResponse(responseId);
      return;
    }

    scheduleBoardSync(responseId, true);
    reconcileBoardPlayback(responseState, true);
    maybeFinalizeTutorResponse(responseId);
    if (!state.lessonCompleted) {
      scheduleTutorContinuation();
    }
  }

  function handleVoiceTranscriptCompleted(event) {
    const transcript = String(event.transcript || "").trim();
    if (!transcript) {
      return;
    }

    const boardClearRequest = isBoardClearRequest(transcript);
    const pureBoardClearRequest = isPureBoardClearRequest(transcript);

    if (boardClearRequest) {
      clearBoardStateForStudentRequest();
    }

    state.pauseAutoContinuation = pureBoardClearRequest;
    if (pureBoardClearRequest) {
      state.suppressNextTutorResponse = true;
      cancelActiveTutorResponse();
    } else {
      state.suppressNextTutorResponse = false;
    }

    upsertTurn(event.item_id || nextTurnId("student-voice"), "user", "You (voice)", transcript);
    renderThread();
  }

  function cancelResponse(responseId, clearAudioBuffer) {
    if (!state.channelOpen) {
      return;
    }

    try {
      sendEvent({
        type: "response.cancel",
        response_id: responseId
      });
    } catch {
      // Ignore local cancel failures.
    }

    if (clearAudioBuffer) {
      try {
        sendEvent({ type: "output_audio_buffer.clear" });
      } catch {
        // Ignore local clear failures.
      }
    }
  }

  function cancelActiveTutorResponse() {
    const responseState = getActiveTutorResponse();
    if (!responseState || !state.activeTutorResponseId) {
      clearBoardPartial();
      clearCaptions();
      return;
    }

    reconcileBoardPlayback(responseState, false);
    dropUnspokenBoardPlans(responseState);
    responseState.cancelling = true;
    abortBoardSync(responseState);
    clearContinuationTimer();
    cancelResponse(state.activeTutorResponseId, true);
    clearCaptions();
    updateIndicators();
  }

  function handleRealtimeEvent(event) {
    if (!event || !event.type) {
      return;
    }

    switch (event.type) {
      case "session.created":
        updateIndicators();
        break;
      case "session.updated":
        state.sessionConfigured = true;
        updateIndicators();
        startLessonTurn();
        break;
      case "response.created":
        if (state.suppressNextTutorResponse) {
          state.suppressNextTutorResponse = false;
          cancelResponse(getResponseId(event), true);
          updateIndicators();
          break;
        }
        ensureTutorResponse(getResponseId(event));
        updateIndicators();
        renderThread();
        break;
      case "response.output_audio_transcript.delta":
        handleTutorTranscriptDelta(event);
        break;
      case "response.output_audio_transcript.done":
        handleTutorTranscriptDone(event);
        break;
      case "response.done":
      case "response.completed":
      case "response.cancelled":
        handleResponseDone(event);
        break;
      case "conversation.item.input_audio_transcription.completed":
        handleVoiceTranscriptCompleted(event);
        break;
      case "input_audio_buffer.speech_started":
        state.studentSpeaking = true;
        cancelActiveTutorResponse();
        clearCaptions();
        updateIndicators();
        break;
      case "input_audio_buffer.speech_stopped":
        state.studentSpeaking = false;
        updateIndicators();
        break;
      case "error": {
        const message = resolveRealtimeError(event);
        if (shouldIgnoreRealtimeError(message)) {
          break;
        }
        setError(message);
        updateIndicators();
        break;
      }
      default:
        break;
    }
  }

  async function startSession() {
    if (!state.available) {
      setError("Live mode requires OpenAI enabled plus an API key.");
      return;
    }

    if (!state.whiteboard) {
      setError("The live whiteboard failed to load. Refresh the page and try again.");
      return;
    }

    const topic = String(els.topic && els.topic.value ? els.topic.value : "").trim();
    if (!topic) {
      setError("Enter a lesson topic before starting live mode.");
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("This browser cannot access microphone input for live mode.");
      return;
    }

    setError("");
    resetSessionView();

    state.connecting = true;
    state.connected = false;
    state.channelOpen = false;
    state.sessionConfigured = false;
    state.sessionUpdateSent = false;
    state.lessonStarted = false;
    state.lessonCompleted = false;
    state.micMuted = false;
    state.studentSpeaking = false;
    state.pauseAutoContinuation = false;
    state.suppressNextTutorResponse = false;
    state.sessionTopic = topic;
    updateIndicators();
    syncControls();

    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      state.remoteStream = new MediaStream();
      if (els.audio) {
        els.audio.srcObject = state.remoteStream;
      }

      state.pc = new RTCPeerConnection();
      state.pc.ontrack = (event) => {
        if (!state.remoteStream) {
          state.remoteStream = new MediaStream();
          if (els.audio) {
            els.audio.srcObject = state.remoteStream;
          }
        }

        state.remoteStream.addTrack(event.track);
        if (els.audio) {
          els.audio.play().catch(() => { });
        }
      };
      state.pc.onconnectionstatechange = () => {
        if (!state.pc) {
          return;
        }

        const connectionState = state.pc.connectionState;
        if (connectionState === "failed" || connectionState === "disconnected" || connectionState === "closed") {
          const shouldWarn = !state.stopping && state.connected;
          teardownSession();
          if (shouldWarn) {
            setError("Realtime connection closed. Start a new session to continue.");
          }
        }
      };

      for (const track of state.localStream.getTracks()) {
        state.pc.addTrack(track, state.localStream);
      }

      state.dataChannel = state.pc.createDataChannel("oai-events");
      state.dataChannel.addEventListener("open", () => {
        state.channelOpen = true;
        syncControls();
        configureSession();
      });
      state.dataChannel.addEventListener("close", () => {
        state.channelOpen = false;
        syncControls();
      });
      state.dataChannel.addEventListener("error", () => {
        setError("Realtime data channel error.");
      });
      state.dataChannel.addEventListener("message", (messageEvent) => {
        try {
          handleRealtimeEvent(JSON.parse(messageEvent.data));
        } catch {
          setError("Failed to read a realtime event from the tutor.");
        }
      });

      const offer = await state.pc.createOffer({ offerToReceiveAudio: true });
      await state.pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(state.pc);

      const answerSdp = await postSdp(
        `${state.connectUrl}?topic=${encodeURIComponent(topic)}`,
        state.pc.localDescription ? state.pc.localDescription.sdp : offer.sdp
      );

      await state.pc.setRemoteDescription({
        type: "answer",
        sdp: answerSdp
      });

      state.connected = true;
      updateIndicators();
      syncControls();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      teardownSession();
    } finally {
      state.connecting = false;
      updateIndicators();
      syncControls();
    }
  }

  function teardownSession() {
    state.connecting = false;
    state.connected = false;
    state.channelOpen = false;
    state.sessionConfigured = false;
    state.sessionUpdateSent = false;
    state.lessonStarted = false;
    state.studentSpeaking = false;
    state.pauseAutoContinuation = false;
    state.suppressNextTutorResponse = false;
    clearBoardPartial();
    clearContinuationTimer();

    for (const responseState of state.tutorResponses.values()) {
      cleanupResponseState(responseState);
    }
    state.activeTutorResponseId = null;
    state.tutorResponses.clear();

    if (state.dataChannel) {
      try {
        state.dataChannel.close();
      } catch {
        // Ignore close failures.
      }
      state.dataChannel = null;
    }

    if (state.pc) {
      try {
        state.pc.close();
      } catch {
        // Ignore close failures.
      }
      state.pc = null;
    }

    if (state.localStream) {
      for (const track of state.localStream.getTracks()) {
        track.stop();
      }
      state.localStream = null;
    }

    if (state.remoteStream) {
      for (const track of state.remoteStream.getTracks()) {
        track.stop();
      }
      state.remoteStream = null;
    }

    if (els.audio) {
      els.audio.srcObject = null;
    }

    clearCaptions();
    updateIndicators();
    syncControls();
  }

  function stopSession() {
    state.stopping = true;
    cancelActiveTutorResponse();
    teardownSession();
    window.setTimeout(() => {
      state.stopping = false;
    }, 0);
  }

  function toggleMic() {
    const track = getPrimaryMicTrack();
    if (!track) {
      return;
    }

    state.micMuted = !state.micMuted;
    track.enabled = !state.micMuted;
    updateIndicators();
    syncControls();
  }

  function sendTypedMessage(event) {
    event.preventDefault();

    if (!state.connected || !state.channelOpen) {
      setError("Start the live lesson before sending a typed message.");
      return;
    }

    const text = String(els.textInput && els.textInput.value ? els.textInput.value : "").trim();
    if (!text) {
      return;
    }

    setError("");
    clearContinuationTimer();
    cancelActiveTutorResponse();

    const boardClearRequest = isBoardClearRequest(text);
    const pureBoardClearRequest = isPureBoardClearRequest(text);

    if (boardClearRequest) {
      clearBoardStateForStudentRequest();
    }

    state.pauseAutoContinuation = pureBoardClearRequest;

    upsertTurn(nextTurnId("student-text"), "user", "You (typed)", text);
    renderThread();

    if (pureBoardClearRequest) {
      state.suppressNextTutorResponse = false;
      if (els.textInput) {
        els.textInput.value = "";
        els.textInput.focus();
      }
      updateIndicators();
      return;
    }

    try {
      state.suppressNextTutorResponse = false;
      sendTutorTextTurn(text);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }

    if (els.textInput) {
      els.textInput.value = "";
      els.textInput.focus();
    }
  }

  for (const button of els.topicButtons) {
    button.addEventListener("click", () => {
      const topic = button.getAttribute("data-realtime-topic") || "";
      if (els.topic) {
        els.topic.value = topic;
        els.topic.focus();
      }
    });
  }

  if (els.start) {
    els.start.addEventListener("click", startSession);
  }
  if (els.stop) {
    els.stop.addEventListener("click", stopSession);
  }
  if (els.mic) {
    els.mic.addEventListener("click", toggleMic);
  }
  if (els.textForm) {
    els.textForm.addEventListener("submit", sendTypedMessage);
  }
  if (els.captionsToggle) {
    els.captionsToggle.addEventListener("click", toggleCaptions);
  }
  document.addEventListener("fullscreenchange", renderCaptions);

  renderThread();
  updateCaptionsToggle();
  renderCaptions();
  updateIndicators();
  syncControls();
})();
