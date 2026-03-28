(function () {
  function roundedRectPath(context, x, y, width, height, radius) {
    const safeRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    if (typeof context.roundRect === "function") {
      context.beginPath();
      context.roundRect(x, y, width, height, safeRadius);
      return;
    }

    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + width - safeRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    context.lineTo(x + width, y + height - safeRadius);
    context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    context.lineTo(x + safeRadius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    context.lineTo(x, y + safeRadius);
    context.quadraticCurveTo(x, y, x + safeRadius, y);
  }

  function pointInRect(point, rect, padding) {
    if (!point || !rect) return false;
    const pad = Number.isFinite(padding) ? padding : 0;
    return point.x >= rect.x - pad
      && point.x <= rect.x + rect.w + pad
      && point.y >= rect.y - pad
      && point.y <= rect.y + rect.h + pad;
  }

  function distanceToSegment(point, segment) {
    const dx = segment.x2 - segment.x1;
    const dy = segment.y2 - segment.y1;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return Number.POSITIVE_INFINITY;

    const lengthSquared = (dx * dx) + (dy * dy);
    if (lengthSquared <= 1e-6) {
      return Math.hypot(point.x - segment.x1, point.y - segment.y1);
    }

    let t = (((point.x - segment.x1) * dx) + ((point.y - segment.y1) * dy)) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    const px = segment.x1 + (dx * t);
    const py = segment.y1 + (dy * t);
    return Math.hypot(point.x - px, point.y - py);
  }

  function pointInPolygon(point, polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      const intersects = ((yi > point.y) !== (yj > point.y))
        && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-6) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function distanceToPolygon(point, polygon) {
    if (!Array.isArray(polygon) || polygon.length === 0) return Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < polygon.length; i++) {
      const current = polygon[i];
      const next = polygon[(i + 1) % polygon.length];
      const distance = distanceToSegment(point, {
        x1: current.x,
        y1: current.y,
        x2: next.x,
        y2: next.y
      });
      if (distance < best) best = distance;
    }
    return best;
  }

  function trimText(value, max) {
    const text = String(value || "").trim();
    if (!max || text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
  }

  function normalizeCardRows(item) {
    const rows = [];

    const detail = trimText(item && item.detail ? item.detail : "", 88);
    if (detail) rows.push({ type: "detail", text: detail });

    const attributes = Array.isArray(item && item.attributes) ? item.attributes : [];
    for (const attribute of attributes) {
      if (!attribute) continue;
      if (typeof attribute === "string") {
        const text = trimText(attribute, 44);
        if (text) rows.push({ type: "attribute", label: "", value: text });
        continue;
      }

      const label = trimText(attribute.label || "", 18);
      const value = trimText(attribute.value || "", 34);
      if (!label && !value) continue;
      rows.push({ type: "attribute", label, value });
    }

    return rows;
  }

  function hitTestTarget(hit, point) {
    if (!hit || !point) return null;
    switch (hit.type) {
      case "rect": {
        const padding = Number.isFinite(hit.padding) ? hit.padding : 0;
        if (!pointInRect(point, hit, padding)) return null;
        const centerX = hit.x + (hit.w / 2);
        const centerY = hit.y + (hit.h / 2);
        return Math.hypot(point.x - centerX, point.y - centerY);
      }
      case "circle": {
        const radius = Math.max(4, Number.isFinite(hit.radius) ? hit.radius : 8);
        const distance = Math.hypot(point.x - hit.x, point.y - hit.y);
        if (distance > radius + (hit.padding || 0)) return null;
        return distance;
      }
      case "ring": {
        const radius = Math.max(4, Number.isFinite(hit.radius) ? hit.radius : 8);
        const tolerance = Math.max(8, Number.isFinite(hit.tolerance) ? hit.tolerance : 12);
        const distance = Math.abs(Math.hypot(point.x - hit.x, point.y - hit.y) - radius);
        if (distance > tolerance) return null;
        return distance;
      }
      case "segment": {
        const tolerance = Math.max(8, Number.isFinite(hit.tolerance) ? hit.tolerance : 12);
        const distance = distanceToSegment(point, hit);
        if (distance > tolerance) return null;
        return distance;
      }
      case "polygon": {
        const inside = pointInPolygon(point, hit.points);
        const distance = distanceToPolygon(point, hit.points);
        const tolerance = Math.max(8, Number.isFinite(hit.tolerance) ? hit.tolerance : 12);
        if (!inside && distance > tolerance) return null;
        return inside ? 0 : distance;
      }
      default:
        return null;
    }
  }

  function hitTestItem(item, point) {
    if (!item || !point) return null;
    const targets = Array.isArray(item.hitTargets) && item.hitTargets.length > 0
      ? item.hitTargets
      : (item.hit ? [item.hit] : []);
    if (targets.length === 0) return null;

    let best = null;
    for (const target of targets) {
      const score = hitTestTarget(target, point);
      if (score === null) continue;
      if (best === null || score < best) best = score;
    }

    return best;
  }

  function drawTracer(context, item, now, accent) {
    if (!item || !item.hit) return;
    const time = Number.isFinite(now) ? now : performance.now();
    const color = accent || "rgba(124,58,237,0.95)";

    context.save();
    context.fillStyle = color;
    context.strokeStyle = color;

    if (item.hit.type === "segment") {
      const t = (Math.sin(time / 420) + 1) / 2;
      const x = item.hit.x1 + ((item.hit.x2 - item.hit.x1) * t);
      const y = item.hit.y1 + ((item.hit.y2 - item.hit.y1) * t);
      context.beginPath();
      context.arc(x, y, 5, 0, Math.PI * 2);
      context.fill();
    } else if (item.hit.type === "ring") {
      const angle = time / 540;
      const x = item.hit.x + Math.cos(angle) * item.hit.radius;
      const y = item.hit.y + Math.sin(angle) * item.hit.radius;
      context.beginPath();
      context.arc(x, y, 5, 0, Math.PI * 2);
      context.fill();
    } else if (item.hit.type === "rect") {
      const wobble = Math.sin((time / 360) + ((item.anchor && item.anchor.x) || 0) / 34) * 3;
      const y = item.hit.y - 6 + wobble;
      roundedRectPath(context, item.hit.x + 4, y, Math.max(16, item.hit.w - 8), 6, 3);
      context.fill();
    } else if (item.hit.type === "circle") {
      const radius = Math.max(10, item.hit.radius + 8 + (Math.sin(time / 360) * 2));
      context.globalAlpha = 0.18;
      context.beginPath();
      context.arc(item.hit.x, item.hit.y, radius, 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
  }

  function drawHighlight(context, item, now, pinned) {
    if (!item || !item.hit) return;
    const pulse = 0.65 + 0.35 * Math.sin((Number.isFinite(now) ? now : performance.now()) / 240);
    const accent = item.accent || (pinned ? "rgba(34,197,94,0.96)" : "rgba(124,58,237,0.92)");

    context.save();
    context.strokeStyle = accent;
    context.fillStyle = accent;
    context.globalAlpha = pinned ? 0.92 : 0.72;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = pinned ? 4.5 : 3.5;

    if (item.hit.type === "rect") {
      roundedRectPath(
        context,
        item.hit.x - 4,
        item.hit.y - 4,
        item.hit.w + 8,
        item.hit.h + 8,
        Math.max(8, (item.hit.radius || 10) + 2)
      );
      context.stroke();
    } else if (item.hit.type === "circle") {
      context.beginPath();
      context.arc(item.hit.x, item.hit.y, item.hit.radius + 8 + (pulse * 4), 0, Math.PI * 2);
      context.stroke();
    } else if (item.hit.type === "ring") {
      context.beginPath();
      context.arc(item.hit.x, item.hit.y, item.hit.radius, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha *= 0.18;
      context.beginPath();
      context.arc(item.hit.x, item.hit.y, item.hit.radius + 12 + (pulse * 5), 0, Math.PI * 2);
      context.fill();
    } else if (item.hit.type === "segment") {
      context.beginPath();
      context.moveTo(item.hit.x1, item.hit.y1);
      context.lineTo(item.hit.x2, item.hit.y2);
      context.stroke();
    } else if (item.hit.type === "polygon") {
      const points = item.hit.points || [];
      if (points.length > 1) {
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          context.lineTo(points[i].x, points[i].y);
        }
        context.closePath();
        context.stroke();
      }
    }

    context.restore();
    drawTracer(context, item, now, accent);
  }

  function drawCard(context, item, viewport, cardIndex) {
    if (!item || !viewport) return;
    const anchor = item.anchor || {
      x: viewport.x + viewport.w - 88,
      y: viewport.y + 56
    };
    const rows = normalizeCardRows(item);

    context.save();
    context.font = "600 14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const title = trimText(item.title || item.kind || "Graph element", 32);
    let contentWidth = context.measureText(title).width;
    let height = 38;

    for (const row of rows) {
      if (row.type === "detail") {
        context.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
        contentWidth = Math.max(contentWidth, context.measureText(row.text).width);
        height += 18;
        continue;
      }

      context.font = "600 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      const labelWidth = row.label ? context.measureText(`${row.label}:`).width : 0;
      context.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      const valueWidth = row.value ? context.measureText(row.value).width : 0;
      contentWidth = Math.max(contentWidth, labelWidth + (row.label && row.value ? 10 : 0) + valueWidth);
      height += 18;
    }

    const width = Math.min(280, Math.max(148, Math.ceil(contentWidth + 26)));
    height += rows.length > 0 ? 8 : 0;

    const stackIndex = Number.isFinite(cardIndex) ? Math.max(0, Math.floor(cardIndex)) : 0;
    const stackOffsetX = stackIndex % 2 === 0 ? 0 : 12;
    const stackOffsetY = stackIndex * 18;

    let x = anchor.x + 14 + stackOffsetX;
    let y = anchor.y - height - 12 + stackOffsetY;
    if (x + width > viewport.x + viewport.w - 8) x = anchor.x - width - 14;
    if (x < viewport.x + 8) x = viewport.x + 8;
    if (y < viewport.y + 8) y = Math.min(viewport.y + viewport.h - height - 8, anchor.y + 16);
    if (y + height > viewport.y + viewport.h - 8) y = viewport.y + viewport.h - height - 8;

    context.fillStyle = "rgba(15, 23, 42, 0.92)";
    roundedRectPath(context, x, y, width, height, 14);
    context.fill();
    context.strokeStyle = item.accent || "rgba(124,58,237,0.9)";
    context.lineWidth = 1.5;
    roundedRectPath(context, x, y, width, height, 14);
    context.stroke();

    context.fillStyle = "rgba(248, 250, 252, 0.98)";
    context.font = "600 14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(title, x + 12, y + 10, width - 24);

    let rowY = y + 30;
    for (const row of rows) {
      if (row.type === "detail") {
        context.fillStyle = "rgba(226, 232, 240, 0.88)";
        context.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
        context.fillText(row.text, x + 12, rowY, width - 24);
        rowY += 18;
        continue;
      }

      if (row.label) {
        context.fillStyle = "rgba(191, 219, 254, 0.94)";
        context.font = "600 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
        const labelText = `${row.label}:`;
        context.fillText(labelText, x + 12, rowY, width - 24);
        const labelWidth = context.measureText(labelText).width;
        context.fillStyle = "rgba(248, 250, 252, 0.96)";
        context.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
        context.fillText(row.value, x + 12 + labelWidth + 10, rowY, width - 24 - labelWidth - 10);
      } else {
        context.fillStyle = "rgba(248, 250, 252, 0.96)";
        context.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
        context.fillText(row.value, x + 12, rowY, width - 24);
      }

      rowY += 18;
    }

    context.restore();
  }

  function createWhiteboardGraphUi(options) {
    const canvas = options && options.canvas ? options.canvas : null;
    if (!canvas) return null;

    const requestRender = typeof (options && options.requestRender) === "function"
      ? options.requestRender
      : function () { };

    let scene = null;
    let pointer = null;
    let hoverIds = [];
    let selectedId = null;

    function getPoint(clientX, clientY) {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    }

    function findItem(id) {
      if (!scene || !Array.isArray(scene.items)) return null;
      return scene.items.find((item) => item && item.id === id) || null;
    }

    function sameIds(left, right) {
      if (left === right) return true;
      if (!Array.isArray(left) || !Array.isArray(right)) return false;
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
      }
      return true;
    }

    function normalizeIds(ids) {
      if (!Array.isArray(ids) || ids.length === 0) return [];
      const seen = new Set();
      const normalized = [];
      for (const id of ids) {
        const item = findItem(id);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        normalized.push(item.id);
      }
      return normalized;
    }

    function collectItems(ids) {
      return normalizeIds(ids)
        .map((id) => findItem(id))
        .filter(Boolean);
    }

    function pickItems(point) {
      if (!scene || !scene.viewport || !Array.isArray(scene.items)) return [];
      const matches = [];
      for (let index = 0; index < scene.items.length; index++) {
        const item = scene.items[index];
        const score = hitTestItem(item, point);
        if (score === null) continue;
        const priority = Number.isFinite(item.priority) ? item.priority : 0;
        matches.push({ item, score, priority, index });
      }
      if (matches.length === 0) return [];

      let maxPriority = matches[0].priority;
      for (let i = 1; i < matches.length; i++) {
        if (matches[i].priority > maxPriority) maxPriority = matches[i].priority;
      }

      return matches
        .filter((match) => match.priority === maxPriority)
        .sort((a, b) => {
          if (a.priority !== b.priority) return b.priority - a.priority;
          if (Math.abs(a.score - b.score) > 0.001) return a.score - b.score;
          return b.index - a.index;
        })
        .map((match) => match.item);
    }

    function sync() {
      const selected = findItem(selectedId);
      const hovered = collectItems(hoverIds);
      const active = selected || hovered[0] || null;

      if (!scene || !scene.viewport || !pointer || !pointInRect(pointer, scene.viewport, 0)) {
        canvas.style.cursor = "";
        return;
      }

      canvas.style.cursor = active ? "pointer" : "crosshair";
    }

    function updateScene(nextScene) {
      scene = nextScene && nextScene.viewport ? nextScene : null;

      if (scene && Array.isArray(scene.items)) {
        if (selectedId && !findItem(selectedId)) selectedId = null;
        hoverIds = normalizeIds(hoverIds);
      } else {
        hoverIds = [];
        selectedId = null;
      }

      sync();
    }

    function handlePointerMove(evt) {
      const nextPoint = getPoint(evt && evt.clientX, evt && evt.clientY);
      const previousHoverIds = hoverIds.slice();
      pointer = nextPoint;

      if (!scene || !scene.viewport || !nextPoint || !pointInRect(nextPoint, scene.viewport, 0)) {
        hoverIds = [];
      } else {
        hoverIds = pickItems(nextPoint).map((item) => item.id);
      }

      const changed = !sameIds(previousHoverIds, hoverIds);
      sync();
      if (changed) requestRender();
      return hoverIds.length > 0;
    }

    function handlePointerDown(evt) {
      const point = getPoint(evt && evt.clientX, evt && evt.clientY);
      pointer = point;
      if (!scene || !scene.viewport || !point || !pointInRect(point, scene.viewport, 0)) {
        return false;
      }

      const hits = pickItems(point);
      const hitIds = hits.map((item) => item.id);
      hoverIds = hitIds;
      if (hitIds.length === 0) {
        selectedId = null;
      } else if (selectedId && hitIds.includes(selectedId)) {
        selectedId = hitIds.length === 1
          ? null
          : hitIds[(hitIds.indexOf(selectedId) + 1) % hitIds.length];
      } else {
        selectedId = hitIds[0];
      }
      sync();
      requestRender();
      return true;
    }

    function handlePointerLeave() {
      if (hoverIds.length === 0 && !pointer) return;
      hoverIds = [];
      pointer = null;
      sync();
      requestRender();
    }

    function renderOverlay(context, now) {
      if (!scene || !scene.viewport) return;

      const selected = findItem(selectedId);
      const hovered = collectItems(hoverIds)
        .filter((item) => !selected || item.id !== selected.id);

      if (selected) drawHighlight(context, selected, now, true);
      for (const item of hovered) drawHighlight(context, item, now, false);

      const cardItems = selected ? [selected, ...hovered] : hovered;
      for (let i = 0; i < cardItems.length; i++) {
        drawCard(context, cardItems[i], scene.viewport, i);
      }
    }

    function hasActiveMotion() {
      return !!(hoverIds.length > 0 || selectedId);
    }

    function destroy() {
      canvas.style.cursor = "";
    }

    return {
      destroy,
      handlePointerDown,
      handlePointerLeave,
      handlePointerMove,
      hasActiveMotion,
      renderOverlay,
      updateScene
    };
  }

  window.createWhiteboardGraphUi = createWhiteboardGraphUi;
})();
