(function () {
  function createRealtimeWhiteboard(options) {
    const canvas = options && options.canvas ? options.canvas : null;
    if (!canvas) {
      throw new Error("Realtime whiteboard requires a canvas element.");
    }

    const stage = (options && options.stage) || canvas.closest(".avatar-stage") || canvas;
    const shell = (options && options.shell) || canvas.closest(".avatar-shell") || stage;
    const fullscreenBtn = (options && options.fullscreenButton) || null;
    const ctx = canvas.getContext("2d");

    let raf = 0;
    let renderWidth = 960;
    let renderHeight = 540;
    let renderScale = 1;

    let boardLines = [];
    let boardSteps = [];
    let boardHasDraw = false;
    let streamingBuffer = "";
    let streamingPartialLine = "";
    let drawAnimation = null;

    let boardTextViewport = null;
    let boardScrollRows = 0;
    let boardScrollMaxRows = 0;
    let boardScrollbarViewport = null;
    let boardScrollbarDrag = null;

    function clamp01(value) {
      if (!Number.isFinite(value)) return 0;
      return Math.max(0, Math.min(1, value));
    }

    function normalizeDrawText(raw) {
      return String(raw || "")
        .replace(/\u00A0/g, " ")
        .replace(/[−–—]/g, "-")
        .replace(/[×]/g, "*");
    }

    function parseNumeric(raw) {
      let text = normalizeDrawText(raw).trim();
      if (!text) return null;
      text = text.replace(/^[=:\s]+/, "").replace(/[,\s;]+$/, "");
      if (!text) return null;

      if (text.endsWith("%")) {
        const value = parseNumeric(text.slice(0, -1));
        return value === null ? null : value / 100;
      }

      const slash = text.indexOf("/");
      if (slash > 0 && slash < text.length - 1) {
        const a = parseFloat(text.slice(0, slash));
        const b = parseFloat(text.slice(slash + 1));
        if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b;
      }

      const value = parseFloat(text);
      return Number.isFinite(value) ? value : null;
    }

    function parseRange(raw) {
      const text = normalizeDrawText(raw).trim();
      if (!text) return null;

      const dotdot = text.match(/([^\s]+)\s*\.\.\s*([^\s]+)/);
      if (dotdot) {
        const a = parseNumeric(dotdot[1]);
        const b = parseNumeric(dotdot[2]);
        if (a === null || b === null || a === b) return null;
        return { min: Math.min(a, b), max: Math.max(a, b) };
      }

      const fromTo = text.match(/from\s+([^\s]+)\s+to\s+([^\s]+)/i);
      if (fromTo) {
        const a = parseNumeric(fromTo[1]);
        const b = parseNumeric(fromTo[2]);
        if (a === null || b === null || a === b) return null;
        return { min: Math.min(a, b), max: Math.max(a, b) };
      }

      return null;
    }

    function parsePoint(raw) {
      const text = normalizeDrawText(raw);

      const tuple = text.match(/\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/);
      if (tuple) {
        const x = parseNumeric(tuple[1]);
        const y = parseNumeric(tuple[2]);
        if (x === null || y === null) return null;
        return { x, y };
      }

      const matchX = text.match(/\bx\s*[:=]\s*([^\s,;]+)/i);
      const matchY = text.match(/\by\s*[:=]\s*([^\s,;]+)/i);
      if (matchX && matchY) {
        const x = parseNumeric(matchX[1]);
        const y = parseNumeric(matchY[1]);
        if (x === null || y === null) return null;
        return { x, y };
      }

      const pair = text.trim().match(/^([^\s,;]+)[,\s]+([^\s,;]+)/);
      if (pair) {
        const x = parseNumeric(pair[1]);
        const y = parseNumeric(pair[2]);
        if (x === null || y === null) return null;
        return { x, y };
      }

      return null;
    }

    function parseLineExpr(raw) {
      let source = normalizeDrawText(raw).trim();
      if (!source) return null;
      source = source.replace(/\s+/g, "");

      const lowerSource = source.toLowerCase();
      const indexY = lowerSource.indexOf("y=");
      const indexX = lowerSource.indexOf("x=");
      if (indexY > 0 && (indexX < 0 || indexY < indexX)) source = source.substring(indexY);
      else if (indexX > 0) source = source.substring(indexX);

      source = source.replace(/[^0-9a-zA-Z+\-./=*]/g, "");
      const text = source.toLowerCase();
      if (!text) return null;

      if (text.startsWith("y=")) {
        const rhs = text.slice(2);
        if (!rhs) return null;
        if (rhs.includes("x")) {
          const parts = rhs.split("x");
          const coefPart = parts[0] || "";
          const constPart = parts.length > 1 ? (parts[1] || "") : "";
          let slope = null;
          if (coefPart === "" || coefPart === "+") slope = 1;
          else if (coefPart === "-") slope = -1;
          else slope = parseNumeric(coefPart);
          if (slope === null) return null;

          let intercept = 0;
          if (constPart) {
            const parsedIntercept = parseNumeric(constPart);
            if (parsedIntercept !== null) intercept = parsedIntercept;
          }

          return { kind: "slopeIntercept", m: slope, b: intercept };
        }

        const constant = parseNumeric(rhs);
        if (constant === null) return null;
        return { kind: "slopeIntercept", m: 0, b: constant };
      }

      if (text.startsWith("x=")) {
        const x = parseNumeric(text.slice(2));
        if (x === null) return null;
        return { kind: "vertical", x };
      }

      if (text.includes("=") && text.includes("x") && text.includes("y")) {
        const parts = text.split("=");
        if (parts.length === 2) {
          const parseSide = (expr) => {
            const terms = String(expr || "").match(/[+\-]?[^+\-]+/g) || [];
            let xCoef = 0;
            let yCoef = 0;
            let constant = 0;
            for (const rawTerm of terms) {
              let term = String(rawTerm || "").trim();
              if (!term) continue;
              term = term.replace(/\*/g, "");
              if (term.endsWith("x")) {
                const coefPart = term.slice(0, -1);
                let coef = null;
                if (coefPart === "" || coefPart === "+") coef = 1;
                else if (coefPart === "-") coef = -1;
                else coef = parseNumeric(coefPart);
                if (coef !== null) xCoef += coef;
              } else if (term.endsWith("y")) {
                const coefPart = term.slice(0, -1);
                let coef = null;
                if (coefPart === "" || coefPart === "+") coef = 1;
                else if (coefPart === "-") coef = -1;
                else coef = parseNumeric(coefPart);
                if (coef !== null) yCoef += coef;
              } else {
                const value = parseNumeric(term);
                if (value !== null) constant += value;
              }
            }
            return { xCoef, yCoef, constant };
          };

          const left = parseSide(parts[0]);
          const right = parseSide(parts[1]);
          const xCoef = left.xCoef - right.xCoef;
          const yCoef = left.yCoef - right.yCoef;
          const constant = left.constant - right.constant;

          if (Math.abs(yCoef) > 1e-9) {
            return { kind: "slopeIntercept", m: -(xCoef / yCoef), b: -(constant / yCoef) };
          }
          if (Math.abs(xCoef) > 1e-9) {
            return { kind: "vertical", x: -(constant / xCoef) };
          }
        }
      }

      return null;
    }

    function roundedRectPath(context, x, y, width, height, radius) {
      const safeRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
      if (context.roundRect) {
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

    function renderCartesianAxes(context, area, axes) {
      const pad = 18;
      const innerWidth = Math.max(10, area.w - pad * 2);
      const innerHeight = Math.max(10, area.h - pad * 2);

      const mapX = (x) => area.x + pad + ((x - axes.xmin) / (axes.xmax - axes.xmin)) * innerWidth;
      const mapY = (y) => area.y + area.h - pad - ((y - axes.ymin) / (axes.ymax - axes.ymin)) * innerHeight;

      const niceStep = (span) => {
        const size = Math.abs(span);
        if (size <= 6) return 1;
        if (size <= 12) return 2;
        if (size <= 30) return 5;
        return 10;
      };

      const xStep = niceStep(axes.xmax - axes.xmin);
      const yStep = niceStep(axes.ymax - axes.ymin);

      context.save();
      context.lineWidth = 1;
      context.strokeStyle = "rgba(17,24,39,0.08)";
      context.beginPath();
      for (let x = Math.ceil(axes.xmin / xStep) * xStep; x <= axes.xmax; x += xStep) {
        const px = mapX(x);
        context.moveTo(px, area.y + 10);
        context.lineTo(px, area.y + area.h - 10);
      }
      for (let y = Math.ceil(axes.ymin / yStep) * yStep; y <= axes.ymax; y += yStep) {
        const py = mapY(y);
        context.moveTo(area.x + 10, py);
        context.lineTo(area.x + area.w - 10, py);
      }
      context.stroke();

      const xAxisY = (axes.ymin <= 0 && axes.ymax >= 0) ? mapY(0) : mapY(axes.ymin);
      const yAxisX = (axes.xmin <= 0 && axes.xmax >= 0) ? mapX(0) : mapX(axes.xmin);

      context.lineWidth = 2.5;
      context.strokeStyle = "rgba(17,24,39,0.55)";
      context.beginPath();
      context.moveTo(area.x + 10, xAxisY);
      context.lineTo(area.x + area.w - 10, xAxisY);
      context.moveTo(yAxisX, area.y + 10);
      context.lineTo(yAxisX, area.y + area.h - 10);
      context.stroke();

      context.fillStyle = "rgba(17,24,39,0.70)";
      context.font = "16px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      context.textAlign = "right";
      context.textBaseline = "top";
      context.fillText("x", area.x + area.w - 12, xAxisY + 6);
      context.textAlign = "left";
      context.fillText("y", yAxisX + 6, area.y + 12);
      context.restore();

      return { mapX, mapY };
    }

    function parseShapeId(raw, fallback) {
      const text = normalizeDrawText(raw);
      const byKey = text.match(/\bid\s*[:=]\s*([a-z0-9_-]+)/i);
      if (byKey) return byKey[1];

      const head = text.match(/^([a-z0-9_-]{2,})\s+/i);
      if (head && !/^(right|line|point|bar|bars|triangle|circle|square|axes|axis|focus)$/i.test(head[1])) {
        return head[1];
      }

      return fallback;
    }

    function extractAxisRange(command, axisChar) {
      const text = normalizeDrawText(command);
      const dotdot = text.match(new RegExp(`${axisChar}\\s*[:=]\\s*([^\\s,;]+\\s*\\.\\.\\s*[^\\s,;]+)`, "i"));
      if (dotdot) return parseRange(dotdot[1]);

      const fromTo = text.match(new RegExp(`${axisChar}\\s*[:=]?\\s*from\\s+([^\\s,;]+)\\s+to\\s+([^\\s,;]+)`, "i"));
      if (fromTo) return parseRange(`from ${fromTo[1]} to ${fromTo[2]}`);

      return null;
    }

    function readNamed(raw, key) {
      const expression = new RegExp(`\\b${key}\\s*[:=]\\s*([^\\s,;]+)`, "i");
      const match = normalizeDrawText(raw).match(expression);
      return match ? parseNumeric(match[1]) : null;
    }

    function readBarsFromText(text) {
      const tokens = String(text || "").split(/\s+/).filter(Boolean);
      const bars = [];
      for (const token of tokens) {
        const separator = token.includes("=") ? token.indexOf("=") : token.indexOf(":");
        if (separator <= 0) continue;
        const label = token.slice(0, separator).trim();
        const value = parseNumeric(token.slice(separator + 1).trim());
        if (!label || value === null) continue;
        bars.push({ label, value });
      }
      return bars;
    }

    function renderDiagram(context, area, steps, activeIndex, activeProgress) {
      if (!area) return { penX: null, penY: null };

      const bgPad = 10;
      const bg = { x: area.x - bgPad, y: area.y - bgPad, w: area.w + bgPad * 2, h: area.h + bgPad * 2 };

      function resetLayer() {
        context.save();
        context.clearRect(bg.x, bg.y, bg.w, bg.h);
        context.fillStyle = "rgba(255,255,255,0.92)";
        roundedRectPath(context, bg.x, bg.y, bg.w, bg.h, 14);
        context.fill();
        context.strokeStyle = "rgba(17,24,39,0.10)";
        context.lineWidth = 2;
        roundedRectPath(context, bg.x, bg.y, bg.w, bg.h, 14);
        context.stroke();
        context.restore();
      }

      class WhiteboardShape {
        constructor(id, kind) {
          this.id = id;
          this.kind = kind;
          this.progress = 1;
        }
        setProgress(progress) {
          this.progress = clamp01(progress);
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
        draw() { }
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
        draw(context2) {
          this.mapper = renderCartesianAxes(context2, area, {
            xmin: this.xmin,
            xmax: this.xmax,
            ymin: this.ymin,
            ymax: this.ymax
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
        draw(context2, getMapper, axesRange) {
          const mapper = getMapper(this.axesId);
          if (!mapper || !this.expr) return;

          const progress = this.progress;
          context2.save();
          context2.lineCap = "round";
          context2.lineJoin = "round";
          context2.strokeStyle = "rgba(124,58,237,0.95)";
          context2.lineWidth = 4;

          if (this.expr.kind === "vertical") {
            const x = mapper.mapX(this.expr.x);
            const y1 = area.y + 14;
            const y2 = area.y + area.h - 14;
            const y = y1 + (y2 - y1) * progress;
            context2.beginPath();
            context2.moveTo(x, y1);
            context2.lineTo(x, y);
            context2.stroke();
            this.anchor = { x, y };
          } else {
            const x1Model = axesRange.xmin;
            const x2Model = axesRange.xmax;
            const y1Model = this.expr.m * x1Model + this.expr.b;
            const y2Model = this.expr.m * x2Model + this.expr.b;
            const x1 = mapper.mapX(x1Model);
            const y1 = mapper.mapY(y1Model);
            const x2 = mapper.mapX(x2Model);
            const y2 = mapper.mapY(y2Model);
            const x = x1 + (x2 - x1) * progress;
            const y = y1 + (y2 - y1) * progress;
            context2.beginPath();
            context2.moveTo(x1, y1);
            context2.lineTo(x, y);
            context2.stroke();
            this.anchor = { x, y };
          }

          context2.restore();
        }
        getAnchor() {
          return this.anchor;
        }
      }

      class PointShape extends WhiteboardShape {
        constructor(id, point, label, axesId) {
          super(id, "point");
          this.x = point.x;
          this.y = point.y;
          this.label = label || null;
          this.axesId = axesId;
          this.anchor = null;
        }
        setPoint(point) {
          this.x = point.x;
          this.y = point.y;
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
        draw(context2, getMapper) {
          const mapper = getMapper(this.axesId);
          if (!mapper) return;
          const x = mapper.mapX(this.x);
          const y = mapper.mapY(this.y);
          context2.save();
          context2.globalAlpha = 0.2 + 0.8 * this.progress;
          context2.fillStyle = "rgba(17,24,39,0.92)";
          context2.beginPath();
          context2.arc(x, y, 6, 0, Math.PI * 2);
          context2.fill();
          context2.restore();

          if (this.label) {
            context2.save();
            context2.globalAlpha = 0.2 + 0.8 * this.progress;
            context2.fillStyle = "rgba(17,24,39,0.80)";
            context2.font = "16px 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
            context2.textAlign = "left";
            context2.textBaseline = "bottom";
            context2.fillText(this.label, x + 8, y - 6, area.w - 12);
            context2.restore();
          }

          this.anchor = { x, y };
        }
        getAnchor() {
          return this.anchor;
        }
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
        setCenter(x, y) {
          this.setPosition(x, y);
          return this;
        }
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
        draw(context2, getMapper) {
          const mapper = getMapper(this.axesId);
          if (!mapper) return;
          const cx = mapper.mapX(this.x);
          const cy = mapper.mapY(this.y);
          const radius = Math.max(4, Math.abs(mapper.mapX(this.x + this.radius) - cx));
          const start = (this.startDeg * Math.PI) / 180;
          const end = (this.endDeg * Math.PI) / 180;
          const current = start + (end - start) * this.progress;

          context2.save();
          context2.strokeStyle = "rgba(124,58,237,0.95)";
          context2.lineWidth = 4;
          context2.beginPath();
          context2.arc(cx, cy, radius, start, current, false);
          context2.stroke();
          context2.restore();

          this.anchor = { x: cx + Math.cos(current) * radius, y: cy + Math.sin(current) * radius };
        }
        getAnchor() {
          return this.anchor;
        }
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
        setCenter(x, y) {
          this.setPosition(x, y);
          return this;
        }
        setSize(size) {
          if (Number.isFinite(size) && size > 0) this.size = size;
          return this;
        }
        setRotation(degrees) {
          if (Number.isFinite(degrees)) this.rotationDeg = degrees;
          return this;
        }
        setAxes(axesId) {
          this.axesId = axesId;
          return this;
        }
        draw(context2, getMapper) {
          const mapper = getMapper(this.axesId);
          if (!mapper) return;
          const cx = mapper.mapX(this.x);
          const cy = mapper.mapY(this.y);
          const half = Math.max(8, Math.abs(mapper.mapX(this.x + this.size / 2) - cx));
          const rotation = (this.rotationDeg * Math.PI) / 180;
          const base = [
            { x: -half, y: -half },
            { x: half, y: -half },
            { x: half, y: half },
            { x: -half, y: half }
          ];
          const points = base.map((point) => ({
            x: cx + (point.x * Math.cos(rotation) - point.y * Math.sin(rotation)),
            y: cy + (point.x * Math.sin(rotation) + point.y * Math.cos(rotation))
          }));
          const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
          const edgeProgress = clamp01(this.progress) * edges.length;

          context2.save();
          context2.strokeStyle = "rgba(124,58,237,0.95)";
          context2.lineWidth = 4;
          context2.lineCap = "round";
          for (let i = 0; i < edges.length; i++) {
            const remaining = edgeProgress - i;
            if (remaining <= 0) break;
            const edge = edges[i];
            const p1 = points[edge[0]];
            const p2 = points[edge[1]];
            const localProgress = Math.min(1, remaining);
            const x = p1.x + (p2.x - p1.x) * localProgress;
            const y = p1.y + (p2.y - p1.y) * localProgress;
            context2.beginPath();
            context2.moveTo(p1.x, p1.y);
            context2.lineTo(x, y);
            context2.stroke();
            this.anchor = { x, y };
          }
          context2.restore();

          if (!this.anchor) this.anchor = { x: cx, y: cy };
        }
        getAnchor() {
          return this.anchor;
        }
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
          if (labels) {
            this.labels = {
              base: labels.base || this.labels.base,
              height: labels.height || this.labels.height,
              hyp: labels.hyp || this.labels.hyp
            };
          }
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
        draw(context2) {
          const pad = 22;
          const maxWidth = area.w - pad * 2;
          const maxHeight = area.h - pad * 2;

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

          const scale = Math.max(1e-6, Math.min(maxWidth / base, maxHeight / height) * 0.82);
          const x0 = area.x + pad;
          const y0 = area.y + area.h - pad;
          const p0 = { x: x0, y: y0 };
          const p1 = { x: x0 + base * scale, y: y0 };
          const p2 = { x: x0 + base * scale, y: y0 - height * scale };
          this.layout = { p0, p1, p2 };

          const segment = (from, to, progress) => {
            const x = from.x + (to.x - from.x) * progress;
            const y = from.y + (to.y - from.y) * progress;
            context2.beginPath();
            context2.moveTo(from.x, from.y);
            context2.lineTo(x, y);
            context2.stroke();
            this.anchor = { x, y };
          };

          context2.save();
          context2.strokeStyle = "rgba(124,58,237,0.95)";
          context2.lineWidth = 4;
          context2.lineCap = "round";
          context2.lineJoin = "round";
          if (this.progress < 1 / 3) {
            segment(p0, p1, this.progress * 3);
          } else if (this.progress < 2 / 3) {
            segment(p0, p1, 1);
            segment(p1, p2, (this.progress - 1 / 3) * 3);
          } else {
            segment(p0, p1, 1);
            segment(p1, p2, 1);
            segment(p2, p0, (this.progress - 2 / 3) * 3);
          }
          context2.restore();

          if (this.progress > 0.9) {
            context2.save();
            context2.fillStyle = "rgba(17,24,39,0.78)";
            context2.font = "16px 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
            context2.textAlign = "center";
            context2.textBaseline = "middle";
            context2.fillText(String(this.labels.base || "a"), (p0.x + p1.x) / 2, p0.y + 14, maxWidth);
            context2.fillText(String(this.labels.height || "b"), p1.x + 14, (p1.y + p2.y) / 2, maxWidth);
            if (this.labels.hyp) {
              context2.fillText(String(this.labels.hyp), (p0.x + p2.x) / 2 - 6, (p0.y + p2.y) / 2 - 10, maxWidth);
            }
            context2.restore();
          }
        }
        focus(context2, strength, which) {
          if (!this.layout) return false;
          const query = String(which || "").toLowerCase().trim();
          const p0 = this.layout.p0;
          const p1 = this.layout.p1;
          const p2 = this.layout.p2;

          if (query.includes("angle") || query.includes("corner") || query.includes("box") || query.includes("square")) {
            context2.save();
            context2.globalAlpha = 0.25 + 0.75 * strength;
            context2.strokeStyle = "rgba(34,197,94,0.95)";
            context2.lineWidth = 4;
            context2.beginPath();
            context2.moveTo(p1.x, p1.y);
            context2.lineTo(p1.x - 16, p1.y);
            context2.lineTo(p1.x - 16, p1.y - 16);
            context2.lineTo(p1.x, p1.y - 16);
            context2.stroke();
            context2.restore();
            return { x: p1.x, y: p1.y };
          }

          let a = p2;
          let b = p0;
          if (query.includes("base") || query === "a" || query.includes("leg a") || query.includes("leg1")) {
            a = p0;
            b = p1;
          } else if (query.includes("height") || query === "b" || query.includes("leg b") || query.includes("leg2")) {
            a = p1;
            b = p2;
          } else if (query.includes("hyp") || query === "c" || query.includes("hypotenuse")) {
            a = p2;
            b = p0;
          }

          context2.save();
          context2.globalAlpha = 0.25 + 0.75 * strength;
          context2.strokeStyle = "rgba(34,197,94,0.95)";
          context2.lineWidth = 7;
          context2.lineCap = "round";
          context2.beginPath();
          context2.moveTo(a.x, a.y);
          context2.lineTo(b.x, b.y);
          context2.stroke();
          context2.restore();
          return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        }
        getAnchor() {
          return this.anchor;
        }
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
        draw(context2) {
          if (!Array.isArray(this.bars) || this.bars.length === 0) return;

          const pad = 18;
          const innerWidth = Math.max(10, area.w - pad * 2);
          const innerHeight = Math.max(10, area.h - pad * 2);
          const x0 = area.x + pad;
          const y0 = area.y + area.h - pad;
          const maxValue = Math.max(1e-6, ...this.bars.map((bar) => Math.abs(bar.value)));
          const count = this.bars.length;
          const gapPx = Math.max(8, Math.floor(innerWidth * 0.04));
          const barWidth = count > 0
            ? Math.max(10, Math.floor((innerWidth - gapPx * (count - 1)) / count))
            : innerWidth;

          this.layout = [];
          context2.save();
          context2.strokeStyle = "rgba(17,24,39,0.55)";
          context2.lineWidth = 2.5;
          context2.beginPath();
          context2.moveTo(x0, y0);
          context2.lineTo(x0 + innerWidth, y0);
          context2.stroke();

          for (let i = 0; i < count; i++) {
            const bar = this.bars[i];
            const height = (Math.abs(bar.value) / maxValue) * (innerHeight - 38) * this.progress;
            const x = x0 + i * (barWidth + gapPx);
            const y = y0 - height;
            this.layout.push({ label: String(bar.label || ""), x, y, w: barWidth, h: height });

            context2.fillStyle = "rgba(124,58,237,0.55)";
            roundedRectPath(context2, x, y, barWidth, height, 10);
            context2.fill();

            context2.fillStyle = "rgba(17,24,39,0.82)";
            context2.font = "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
            context2.textAlign = "center";
            context2.textBaseline = "top";
            context2.fillText(bar.label, x + barWidth / 2, y0 + 8, barWidth + 8);
            this.anchor = { x: x + barWidth / 2, y };
          }

          context2.restore();
        }
        focus(context2, strength, labelText) {
          const query = String(labelText || "").trim().toLowerCase();
          if (!query || !Array.isArray(this.layout) || this.layout.length === 0) return false;

          const found = this.layout.find((bar) => String(bar.label || "").trim().toLowerCase() === query)
            || this.layout.find((bar) => String(bar.label || "").trim().toLowerCase().includes(query));
          if (!found) return false;

          context2.save();
          context2.globalAlpha = 0.25 + 0.75 * strength;
          context2.strokeStyle = "rgba(34,197,94,0.95)";
          context2.lineWidth = 4;
          roundedRectPath(context2, found.x - 4, found.y - 4, found.w + 8, found.h + 8, 12);
          context2.stroke();
          context2.restore();
          return { x: found.x + found.w / 2, y: found.y };
        }
        getAnchor() {
          return this.anchor;
        }
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
        const amount = clamp01(strength);
        const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 180);
        const radius = 12 + 10 * pulse;
        context.save();
        context.globalAlpha = 0.25 + 0.75 * amount;
        context.strokeStyle = "rgba(34,197,94,0.95)";
        context.lineWidth = 4;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = "rgba(34,197,94,0.20)";
        context.beginPath();
        context.arc(x, y, Math.max(6, radius * 0.45), 0, Math.PI * 2);
        context.fill();
        context.restore();
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

      function setAxesFromCommand(command) {
        const xRange = extractAxisRange(command, "x");
        if (xRange) {
          axesRange.xmin = xRange.min;
          axesRange.xmax = xRange.max;
        }
        const yRange = extractAxisRange(command, "y");
        if (yRange) {
          axesRange.ymin = yRange.min;
          axesRange.ymax = yRange.max;
        }
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

      function renderScene() {
        resetLayer();
        currentMapper = null;

        for (const id of drawOrder) {
          const shape = shapesById.get(id);
          if (!shape) continue;

          if (shape instanceof AxesShape) {
            mode = "cartesian";
            shape.draw(context);
            currentMapper = shape.mapper;
            const anchor = shape.getAnchor();
            if (anchor) lastPen = anchor;
            continue;
          }

          if (shape instanceof LineShape) {
            mode = "cartesian";
            shape.draw(context, readMapper, axesRange);
          } else if (shape instanceof PointShape) {
            mode = "cartesian";
            shape.draw(context, readMapper);
          } else if (shape instanceof CircleShape) {
            mode = "cartesian";
            shape.draw(context, readMapper);
          } else if (shape instanceof SquareShape) {
            mode = "cartesian";
            shape.draw(context, readMapper);
          } else if (shape instanceof BarShape) {
            mode = "bar";
            shape.draw(context);
          } else if (shape instanceof TriangleShape) {
            mode = "triangle";
            shape.draw(context);
          } else {
            shape.draw(context, readMapper, axesRange);
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
            const point = shape.focus(context, strength, detail || query);
            if (!point) return false;
            drawFocusRing(point.x, point.y, strength);
            lastPen = { x: point.x, y: point.y };
            return true;
          }
          if (shape instanceof TriangleShape) {
            const point = shape.focus(context, strength, detail || query);
            if (!point) return false;
            drawFocusRing(point.x, point.y, strength);
            lastPen = { x: point.x, y: point.y };
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
          const shape = getShape(idMatch[1]);
          if (focusByShape(shape, query)) return true;
        }

        if (lower.startsWith("bar ")) {
          if (focusByShape(findLastShape("bar"), query.slice(4).trim())) return true;
        }
        if (lower.startsWith("triangle ")) {
          if (focusByShape(findLastShape("triangle"), query.slice(9).trim())) return true;
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
          const mapper = readMapper(defaultAxesId);
          if (!mapper) return false;
          const x = mapper.mapX(point.x);
          const y = mapper.mapY(point.y);
          drawFocusRing(x, y, strength);
          lastPen = { x, y };
          return true;
        }

        const expr = parseLineExpr(query);
        if (expr) {
          const line = new LineShape("focus-line", expr, defaultAxesId).setProgress(Math.max(0.4, strength));
          line.draw(context, readMapper, axesRange);
          const anchor = line.getAnchor();
          if (!anchor) return false;
          drawFocusRing(anchor.x, anchor.y, strength);
          lastPen = { x: anchor.x, y: anchor.y };
          return true;
        }

        return false;
      }

      for (let i = 0; i <= activeIndex && i < steps.length; i++) {
        const step = steps[i];
        if (!step || step.kind !== "draw") continue;

        const progress = i === activeIndex ? activeProgress : 1;
        const command = normalizeDrawText(step.command).trim();
        if (!command) continue;
        const parts = command.split(/\s+/).filter(Boolean);
        const operation = (parts[0] || "").toLowerCase().replace(/[^a-z]/g, "");
        const rest = parts.slice(1).join(" ");

        if (operation === "focus" || operation === "highlight" || operation === "pointat") {
          if (i === activeIndex) focusCommand = { query: rest, strength: progress };
          continue;
        }

        if (operation === "clear" || operation === "reset") {
          mode = "none";
          axesRange = { xmin: -5, xmax: 5, ymin: -5, ymax: 5 };
          currentMapper = null;
          defaultAxesId = null;
          drawOrder.length = 0;
          shapesById.clear();
          continue;
        }

        if (operation === "axes" || operation === "axis" || operation === "grid" || operation === "plane" || operation === "coordinate") {
          setAxesFromCommand(rest);
          const id = parseShapeId(rest, `axes-${i + 1}`);
          const shape = ensureAxesShape(id).setRange(axesRange).setProgress(progress);
          registerShape(shape);
          continue;
        }

        if (operation === "line" || operation === "graph" || operation === "plot" || operation === "sketch") {
          ensureCartesian();
          const expr = parseLineExpr(rest);
          if (!expr) {
            if (operation === "graph" || operation === "plot" || operation === "sketch") {
              const id = parseShapeId(rest, `axes-${i + 1}`);
              const shape = ensureAxesShape(id).setRange(axesRange).setProgress(progress);
              registerShape(shape);
            }
            continue;
          }
          const id = parseShapeId(rest, `line-${i + 1}`);
          let shape = getShape(id);
          if (!(shape instanceof LineShape)) shape = registerShape(new LineShape(id, expr, defaultAxesId));
          shape.setAxes(defaultAxesId).setEquation(expr).setProgress(progress);
          continue;
        }

        if (operation === "point" || operation === "dot") {
          ensureCartesian();
          const point = parsePoint(rest);
          if (!point) continue;
          const labelMatch = normalizeDrawText(rest).match(/label\s*[:=]\s*(.+)$/i);
          const label = labelMatch ? String(labelMatch[1] || "").trim().replace(/^\"|\"$/g, "") : null;
          const id = parseShapeId(rest, `point-${i + 1}`);
          let shape = getShape(id);
          if (!(shape instanceof PointShape)) shape = registerShape(new PointShape(id, point, label, defaultAxesId));
          shape.setAxes(defaultAxesId).setPoint(point).setLabel(label).setProgress(progress);
          continue;
        }

        if (operation === "circle") {
          ensureCartesian();
          const id = parseShapeId(rest, `circle-${i + 1}`);
          let shape = getShape(id);
          if (!(shape instanceof CircleShape)) shape = registerShape(new CircleShape(id, defaultAxesId));
          const center = parsePoint(rest);
          if (center) shape.setCenter(center.x, center.y);
          const radius = readNamed(rest, "r") ?? readNamed(rest, "radius");
          if (radius !== null) shape.setRadius(Math.abs(radius));
          const startDeg = readNamed(rest, "start") ?? readNamed(rest, "from");
          const endDeg = readNamed(rest, "end") ?? readNamed(rest, "to");
          if (startDeg !== null || endDeg !== null) shape.setAngles(startDeg, endDeg);
          shape.setAxes(defaultAxesId).setProgress(progress);
          continue;
        }

        if (operation === "square") {
          ensureCartesian();
          const id = parseShapeId(rest, `square-${i + 1}`);
          let shape = getShape(id);
          if (!(shape instanceof SquareShape)) shape = registerShape(new SquareShape(id, defaultAxesId));
          const center = parsePoint(rest);
          if (center) shape.setCenter(center.x, center.y);
          const size = readNamed(rest, "size") ?? readNamed(rest, "side") ?? readNamed(rest, "s");
          if (size !== null) shape.setSize(Math.abs(size));
          const rotation = readNamed(rest, "angle") ?? readNamed(rest, "rotation") ?? readNamed(rest, "rot");
          if (rotation !== null) shape.setRotation(rotation);
          shape.setAxes(defaultAxesId).setProgress(progress);
          continue;
        }

        if (operation === "bar" || operation === "bars") {
          const bars = readBarsFromText(rest);
          if (bars.length === 0) continue;
          const id = parseShapeId(rest, `bar-${i + 1}`);
          let shape = getShape(id);
          if (!(shape instanceof BarShape)) shape = registerShape(new BarShape(id));
          shape.setBars(bars).setProgress(progress);
          mode = "bar";
          continue;
        }

        if (operation === "triangle") {
          const id = parseShapeId(rest, `triangle-${i + 1}`);
          let shape = getShape(id);
          if (!(shape instanceof TriangleShape)) shape = registerShape(new TriangleShape(id));

          const cleaned = normalizeDrawText(rest).replace(/[;,]/g, " ").replace(/\s+/g, " ").trim();
          const numbers = (cleaned.match(/-?\d+(?:\.\d+)?/g) || [])
            .map((n) => parseNumeric(n))
            .filter((value) => value !== null);

          const lowerCommand = cleaned.toLowerCase();
          if (lowerCommand.includes("angle")) {
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
          shape.setProgress(progress);
          mode = "triangle";
          continue;
        }

        if (operation === "move" || operation === "shift") {
          const id = parseShapeId(rest, "");
          const shape = getShape(id);
          if (!shape) continue;
          const point = parsePoint(rest);
          if (point) {
            shape.setPosition(point.x, point.y);
          } else {
            const dx = readNamed(rest, "dx");
            const dy = readNamed(rest, "dy");
            shape.moveBy(dx || 0, dy || 0);
          }
          shape.setProgress(progress);
          continue;
        }

        const lowerCommand = command.toLowerCase();
        if (lowerCommand.includes("..") && (lowerCommand.includes("x") || lowerCommand.includes("y"))) {
          setAxesFromCommand(command);
          ensureAxesShape(`axes-${i + 1}`).setRange(axesRange).setProgress(progress);
          continue;
        }

        if (lowerCommand.includes("y=") || lowerCommand.includes("x=") || (lowerCommand.includes("=") && lowerCommand.includes("x") && lowerCommand.includes("y"))) {
          ensureCartesian();
          const expr = parseLineExpr(command);
          if (!expr) continue;
          const shape = registerShape(new LineShape(`line-${i + 1}`, expr, defaultAxesId).setProgress(progress));
          shape.setAxes(defaultAxesId).setEquation(expr);
          continue;
        }

        if (lowerCommand.includes("(") && lowerCommand.includes(",") && lowerCommand.includes(")")) {
          ensureCartesian();
          const point = parsePoint(command);
          if (!point) continue;
          registerShape(new PointShape(`point-${i + 1}`, point, null, defaultAxesId).setProgress(progress));
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

    function rebuildBoardSteps() {
      const steps = [];
      let hasDraw = false;

      for (const raw of boardLines) {
        const text = String(raw || "").trim();
        if (!text) continue;
        const match = text.match(/^draw\b\s*[:\-]?\s*(.*)$/i);
        if (match) {
          hasDraw = true;
          steps.push({ kind: "draw", command: String(match[1] || "").trim() });
        } else {
          steps.push({ kind: "text", text });
        }
      }

      boardSteps = steps;
      boardHasDraw = hasDraw;
    }

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
      return point.x >= boardTextViewport.x
        && point.x <= boardTextViewport.x + boardTextViewport.w
        && point.y >= boardTextViewport.y
        && point.y <= boardTextViewport.y + boardTextViewport.h;
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

      const pointerId = boardScrollbarDrag.pointerId;
      boardScrollbarDrag = null;
      if (!Number.isFinite(pointerId)) return;

      try {
        if (canvas.hasPointerCapture && canvas.hasPointerCapture(pointerId)) {
          canvas.releasePointerCapture(pointerId);
        }
      } catch {
        /* ignore */
      }
    }

    function focusCanvasWithoutPageScroll() {
      if (document.activeElement === canvas) return;
      if (typeof canvas.focus !== "function") return;
      try {
        canvas.focus({ preventScroll: true });
      } catch {
        canvas.focus();
      }
    }

    function handlePointerDown(evt) {
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
        try {
          canvas.setPointerCapture(evt.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }

      if (setBoardScrollFromScrollbarY(point.y, boardScrollbarViewport.thumbH / 2)) refresh();
      boardScrollbarDrag = {
        pointerId: evt.pointerId,
        grabOffset: boardScrollbarViewport.thumbH / 2
      };
      try {
        canvas.setPointerCapture(evt.pointerId);
      } catch {
        /* ignore */
      }
    }

    function handlePointerMove(evt) {
      if (!evt || !boardScrollbarDrag || evt.pointerId !== boardScrollbarDrag.pointerId) return;
      const point = pointerToCanvasPoint(evt.clientX, evt.clientY);
      if (!point) return;

      evt.preventDefault();
      evt.stopPropagation();
      if (setBoardScrollFromScrollbarY(point.y, boardScrollbarDrag.grabOffset)) refresh();
    }

    function handlePointerUp(evt) {
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

    function handleWheel(evt) {
      if (!evt || !isPointerInBoardTextArea(evt.clientX, evt.clientY)) return;
      evt.preventDefault();
      evt.stopPropagation();
      if (scrollBoardByWheelDelta(evt.deltaY)) refresh();
    }

    function handleKeydown(evt) {
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
      if (setBoardScrollRows(next)) refresh();
    }

    function computeRenderScale() {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      return Math.min(4, Math.max(2.5, dpr * 1.8));
    }

    function ensureCanvasResolution(force) {
      const host = stage || canvas;
      const rect = host.getBoundingClientRect();
      const cssWidth = Math.max(320, Math.round(rect.width || 960));
      const cssHeight = Math.max(180, Math.round(rect.height || (cssWidth * 9 / 16)));
      const scale = computeRenderScale();
      const pxWidth = Math.max(1, Math.min(7680, Math.round(cssWidth * scale)));
      const pxHeight = Math.max(1, Math.min(4320, Math.round(cssHeight * scale)));

      renderWidth = cssWidth;
      renderHeight = cssHeight;
      renderScale = scale;

      if (!force && canvas.width === pxWidth && canvas.height === pxHeight) return;
      canvas.width = pxWidth;
      canvas.height = pxHeight;
    }

    function isFullscreen() {
      return !!(shell && document.fullscreenElement === shell);
    }

    function updateFullscreenButtonLabel() {
      if (!fullscreenBtn) return;
      fullscreenBtn.textContent = isFullscreen() ? "Exit fullscreen" : "Fullscreen board";
    }

    async function toggleFullscreen() {
      if (!shell || !shell.requestFullscreen) return;
      if (isFullscreen()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        return;
      }
      try {
        await shell.requestFullscreen();
      } catch {
        /* ignore */
      }
    }

    function currentDiagramAnimationState(now) {
      if (drawAnimation && drawAnimation.stepIndex >= 0 && drawAnimation.stepIndex < boardSteps.length) {
        const elapsed = now - drawAnimation.startMs;
        const progress = clamp01(elapsed / drawAnimation.durationMs);
        if (progress >= 1) {
          drawAnimation = null;
          return {
            activeIndex: boardSteps.length > 0 ? boardSteps.length - 1 : -1,
            activeProgress: 1
          };
        }
        return {
          activeIndex: drawAnimation.stepIndex,
          activeProgress: progress
        };
      }

      return {
        activeIndex: boardSteps.length > 0 ? boardSteps.length - 1 : -1,
        activeProgress: 1
      };
    }

    function drawFrame(now) {
      ensureCanvasResolution(false);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);

      const width = renderWidth;
      const height = renderHeight;

      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "rgba(124, 58, 237, 0.22)");
      gradient.addColorStop(1, "rgba(34, 197, 94, 0.14)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const padding = 18;
      const board = {
        x: padding,
        y: padding,
        w: width - padding * 2,
        h: height - padding * 2
      };

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

      const textRows = [];
      for (const step of boardSteps) {
        if (step && step.kind === "text") {
          textRows.push({ text: step.text, isActive: false });
        }
      }

      const partialTrimmed = String(streamingPartialLine || "").trim();
      const showPartialText = partialTrimmed.length > 0 && !/^draw\b\s*[:\-]?/i.test(partialTrimmed);
      if (showPartialText) {
        textRows.push({ text: partialTrimmed, isActive: true });
      }

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
        }
        y0 += lineHeight;
      }

      if (boardScrollMaxRows > 0) {
        const trackWidth = 5;
        const trackPad = 4;
        const trackX = textArea.x + textArea.w - trackWidth - 2;
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
          trackW: trackWidth,
          trackH,
          travel,
          thumbY,
          thumbH,
          hitX: trackX - hitPadX,
          hitY: trackY,
          hitW: trackWidth + hitPadX * 2,
          hitH: trackH,
          thumbHitX: trackX - hitPadX,
          thumbHitW: trackWidth + hitPadX * 2
        };

        ctx.fillStyle = "rgba(17,24,39,0.10)";
        ctx.fillRect(trackX, trackY, trackWidth, trackH);
        ctx.fillStyle = "rgba(17,24,39,0.40)";
        ctx.fillRect(trackX, thumbY, trackWidth, thumbH);
      } else {
        boardScrollbarViewport = null;
        clearScrollbarDrag();
      }

      if (diagramArea) {
        const activeState = currentDiagramAnimationState(now);
        renderDiagram(ctx, diagramArea, boardSteps, activeState.activeIndex, activeState.activeProgress);
      }

      ctx.restore();

      ctx.fillStyle = "rgba(255,255,255,0.70)";
      ctx.font = "13px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("AI-generated whiteboard", 16, height - 16);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function startLoop() {
      if (raf) return;

      const draw = (time) => {
        raf = requestAnimationFrame(draw);
        drawFrame(time);
      };

      raf = requestAnimationFrame(draw);
    }

    function stopLoop() {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    }

    function refresh() {
      startLoop();
    }

    function commitLine(rawLine) {
      const line = String(rawLine || "").trim();
      if (!line) return;

      const lower = line.toLowerCase();
      if (lower === "[clear]") {
        boardLines = [];
        boardSteps = [];
        boardHasDraw = false;
        drawAnimation = null;
        resetBoardScroll();
        return;
      }

      if (lower === "[pop]") {
        if (boardLines.length > 0) {
          boardLines.pop();
          rebuildBoardSteps();
          resetBoardScroll();
        }
        drawAnimation = null;
        return;
      }

      if (lower.startsWith("[replace-last]")) {
        const replacement = line.substring("[replace-last]".length).trim();
        if (!replacement) {
          return;
        }

        if (boardLines.length === 0) {
          boardLines.push(replacement);
        } else {
          boardLines[boardLines.length - 1] = replacement;
        }

        rebuildBoardSteps();
        resetBoardScroll();
        drawAnimation = null;
        return;
      }

      boardLines.push(line);
      rebuildBoardSteps();
      resetBoardScroll();

      const step = boardSteps.length > 0 ? boardSteps[boardSteps.length - 1] : null;
      if (step && step.kind === "draw") {
        drawAnimation = {
          stepIndex: boardSteps.length - 1,
          startMs: performance.now(),
          durationMs: 650
        };
      } else {
        drawAnimation = null;
      }
    }

    function flushStreaming(commitPartial) {
      const text = String(streamingBuffer || "").replace(/\r/g, "");
      let cursor = 0;

      while (cursor < text.length) {
        const newlineIndex = text.indexOf("\n", cursor);
        if (newlineIndex < 0) break;
        const line = text.slice(cursor, newlineIndex);
        commitLine(line);
        cursor = newlineIndex + 1;
      }

      streamingBuffer = text.slice(cursor);
      streamingPartialLine = commitPartial ? "" : streamingBuffer;

      if (commitPartial && String(streamingBuffer || "").trim()) {
        commitLine(streamingBuffer);
        streamingBuffer = "";
        streamingPartialLine = "";
      }

      refresh();
    }

    function appendDelta(delta) {
      if (!delta) return;
      streamingBuffer += String(delta || "");
      flushStreaming(false);
    }

    function finalizeText(text) {
      if (text && !streamingBuffer) {
        streamingBuffer = String(text || "");
      }
      flushStreaming(true);
    }

    function cancelPartial() {
      streamingBuffer = "";
      streamingPartialLine = "";
      refresh();
    }

    function reset() {
      boardLines = [];
      boardSteps = [];
      boardHasDraw = false;
      streamingBuffer = "";
      streamingPartialLine = "";
      drawAnimation = null;
      resetBoardScroll();
      refresh();
    }

    function setLines(lines) {
      boardLines = Array.isArray(lines)
        ? lines.map((line) => String(line || "").trim()).filter((line) => line.length > 0)
        : [];
      streamingBuffer = "";
      streamingPartialLine = "";
      drawAnimation = null;
      rebuildBoardSteps();
      resetBoardScroll();
      refresh();
    }

    function getLines() {
      return boardLines.slice();
    }

    function getLineCount() {
      return boardLines.length;
    }

    function hasStreaming() {
      return String(streamingPartialLine || "").trim().length > 0;
    }

    function destroy() {
      stopLoop();
      clearScrollbarDrag();
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("resize", refresh);
      document.removeEventListener("fullscreenchange", updateFullscreenButtonLabel);
      if (fullscreenBtn) fullscreenBtn.removeEventListener("click", toggleFullscreen);
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("keydown", handleKeydown);
    window.addEventListener("resize", refresh);
    document.addEventListener("fullscreenchange", updateFullscreenButtonLabel);
    if (fullscreenBtn) fullscreenBtn.addEventListener("click", toggleFullscreen);

    ensureCanvasResolution(true);
    updateFullscreenButtonLabel();
    refresh();

    return {
      appendDelta,
      cancelPartial,
      destroy,
      finalizeText,
      getLineCount,
      getLines,
      hasStreaming,
      refresh,
      reset,
      setLines,
      toggleFullscreen
    };
  }

  window.createRealtimeWhiteboard = createRealtimeWhiteboard;
})();
