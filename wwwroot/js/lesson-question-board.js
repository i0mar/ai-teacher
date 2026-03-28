(function () {
  function createLessonQuestionBoardComposer(options) {
    const root = options && options.root ? options.root : null;
    if (!root) {
      return null;
    }

    const els = {
      written: root.querySelector("#qa-board-text"),
      kind: root.querySelector("#qa-board-drawing-kind"),
      commandPreview: root.querySelector("#qa-board-command-preview"),
      empty: root.querySelector("#qa-board-drawing-empty"),
      list: root.querySelector("#qa-board-drawing-list"),
      save: root.querySelector("#qa-board-item-save"),
      cancel: root.querySelector("#qa-board-edit-cancel"),
      error: root.querySelector("#qa-board-error"),
      previewCanvas: root.querySelector("#qa-board-preview"),
      groups: Array.from(root.querySelectorAll("[data-board-kind-group]")),
      axesXMin: root.querySelector("#qa-board-axes-xmin"),
      axesXMax: root.querySelector("#qa-board-axes-xmax"),
      axesYMin: root.querySelector("#qa-board-axes-ymin"),
      axesYMax: root.querySelector("#qa-board-axes-ymax"),
      lineExpr: root.querySelector("#qa-board-line-expression"),
      pointX: root.querySelector("#qa-board-point-x"),
      pointY: root.querySelector("#qa-board-point-y"),
      pointLabel: root.querySelector("#qa-board-point-label"),
      circleX: root.querySelector("#qa-board-circle-x"),
      circleY: root.querySelector("#qa-board-circle-y"),
      circleRadius: root.querySelector("#qa-board-circle-radius"),
      squareX: root.querySelector("#qa-board-square-x"),
      squareY: root.querySelector("#qa-board-square-y"),
      squareSize: root.querySelector("#qa-board-square-size"),
      squareAngle: root.querySelector("#qa-board-square-angle"),
      triangleBaseLength: root.querySelector("#qa-board-triangle-base-length"),
      triangleHeightLength: root.querySelector("#qa-board-triangle-height-length"),
      triangleAngleDegrees: root.querySelector("#qa-board-triangle-angle-degrees"),
      triangleBaseLabel: root.querySelector("#qa-board-triangle-base-label"),
      triangleHeightLabel: root.querySelector("#qa-board-triangle-height-label"),
      triangleHypLabel: root.querySelector("#qa-board-triangle-hyp-label"),
      triangleAngleLabel: root.querySelector("#qa-board-triangle-angle-label"),
      barValues: root.querySelector("#qa-board-bar-values"),
      customCommand: root.querySelector("#qa-board-custom-command")
    };

    const kindLabels = {
      axes: "Axes / graph",
      line: "Line / plot",
      point: "Point",
      circle: "Circle",
      square: "Square",
      triangle: "Triangle",
      bar: "Bar chart",
      custom: "Custom DRAW"
    };

    const state = {
      items: [],
      editingId: null,
      nextId: 1,
      preview: null
    };

    function normalizeText(value) {
      return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    }

    function clearError() {
      if (!els.error) {
        return;
      }

      els.error.textContent = "";
      els.error.hidden = true;
    }

    function showError(message) {
      if (!els.error) {
        return;
      }

      els.error.textContent = String(message || "").trim();
      els.error.hidden = els.error.textContent.length === 0;
    }

    function splitWrittenLines(value) {
      return normalizeText(value)
        .split("\n")
        .map((line) => String(line || "").trim())
        .filter((line) => line.length > 0);
    }

    function summarizeQuestion(value) {
      const lines = splitWrittenLines(value);
      const first = lines[0] || "";
      if (!first) {
        return "";
      }

      if (first.length <= 220) {
        return first;
      }

      return `${first.slice(0, 217).trimEnd()}...`;
    }

    function getSelectedKind() {
      return els.kind && els.kind.value ? els.kind.value : "axes";
    }

    function buildDefaultValues(kind) {
      switch (kind) {
        case "axes":
          return { xMin: "-5", xMax: "5", yMin: "-5", yMax: "5" };
        case "line":
          return { expression: "y=2x+1" };
        case "point":
          return { x: "3", y: "7", label: "(3,7)" };
        case "circle":
          return { x: "0", y: "0", radius: "3" };
        case "square":
          return { x: "2", y: "2", size: "2", angle: "20" };
        case "triangle":
          return {
            baseLength: "4",
            heightLength: "3",
            angleDegrees: "",
            baseLabel: "adj",
            heightLabel: "opp",
            hypLabel: "hyp",
            angleLabel: "θ"
          };
        case "bar":
          return { values: "A=2 B=5 C=3" };
        case "custom":
          return { command: "" };
        default:
          return {};
      }
    }

    function applyValues(kind, values) {
      const safe = values || {};
      if (kind === "axes") {
        if (els.axesXMin) els.axesXMin.value = safe.xMin || "";
        if (els.axesXMax) els.axesXMax.value = safe.xMax || "";
        if (els.axesYMin) els.axesYMin.value = safe.yMin || "";
        if (els.axesYMax) els.axesYMax.value = safe.yMax || "";
      } else if (kind === "line") {
        if (els.lineExpr) els.lineExpr.value = safe.expression || "";
      } else if (kind === "point") {
        if (els.pointX) els.pointX.value = safe.x || "";
        if (els.pointY) els.pointY.value = safe.y || "";
        if (els.pointLabel) els.pointLabel.value = safe.label || "";
      } else if (kind === "circle") {
        if (els.circleX) els.circleX.value = safe.x || "";
        if (els.circleY) els.circleY.value = safe.y || "";
        if (els.circleRadius) els.circleRadius.value = safe.radius || "";
      } else if (kind === "square") {
        if (els.squareX) els.squareX.value = safe.x || "";
        if (els.squareY) els.squareY.value = safe.y || "";
        if (els.squareSize) els.squareSize.value = safe.size || "";
        if (els.squareAngle) els.squareAngle.value = safe.angle || "";
      } else if (kind === "triangle") {
        if (els.triangleBaseLength) els.triangleBaseLength.value = safe.baseLength || "";
        if (els.triangleHeightLength) els.triangleHeightLength.value = safe.heightLength || "";
        if (els.triangleAngleDegrees) els.triangleAngleDegrees.value = safe.angleDegrees || "";
        if (els.triangleBaseLabel) els.triangleBaseLabel.value = safe.baseLabel || "";
        if (els.triangleHeightLabel) els.triangleHeightLabel.value = safe.heightLabel || "";
        if (els.triangleHypLabel) els.triangleHypLabel.value = safe.hypLabel || "";
        if (els.triangleAngleLabel) els.triangleAngleLabel.value = safe.angleLabel || "";
      } else if (kind === "bar") {
        if (els.barValues) els.barValues.value = safe.values || "";
      } else if (kind === "custom") {
        if (els.customCommand) els.customCommand.value = safe.command || "";
      }
    }

    function setKind(kind, values) {
      const nextKind = kindLabels[kind] ? kind : "axes";
      if (els.kind) {
        els.kind.value = nextKind;
      }

      for (const group of els.groups) {
        const groupKind = group.getAttribute("data-board-kind-group");
        const shouldHide = groupKind !== nextKind;
        group.hidden = shouldHide;
        group.style.display = shouldHide ? "none" : "";
      }

      applyValues(nextKind, values || buildDefaultValues(nextKind));
      updateSaveButton();
      renderCommandPreview();
    }

    function ensurePreview() {
      if (state.preview || !els.previewCanvas || typeof window.createRealtimeWhiteboard !== "function") {
        return;
      }

      state.preview = window.createRealtimeWhiteboard({
        canvas: els.previewCanvas
      });
    }

    function buildCommand(item) {
      if (!item) {
        return "";
      }

      if (item.kind === "axes") {
        return `axes x=${item.xMin}..${item.xMax} y=${item.yMin}..${item.yMax}`;
      }

      if (item.kind === "line") {
        return `line ${item.expression}`;
      }

      if (item.kind === "point") {
        const label = item.label ? ` label=${item.label}` : "";
        return `point (${item.x},${item.y})${label}`;
      }

      if (item.kind === "circle") {
        return `circle center=(${item.x},${item.y}) r=${item.radius}`;
      }

      if (item.kind === "square") {
        const angle = item.angle ? ` angle=${item.angle}` : "";
        return `square center=(${item.x},${item.y}) size=${item.size}${angle}`;
      }

      if (item.kind === "triangle") {
        const geometry = resolveTriangleGeometry(item);
        if (!geometry) {
          return "";
        }

        const parts = ["triangle right"];
        const baseLabel = String(item.baseLabel || "").trim();
        const heightLabel = String(item.heightLabel || "").trim();
        const hypLabel = String(item.hypLabel || "").trim();
        const angleLabel = buildTriangleAngleText(item, geometry);
        const legs = [baseLabel, heightLabel].filter((value) => value.length > 0);

        parts.push(`${geometry.baseLength} ${geometry.heightLength}`);
        if (legs.length === 2) {
          parts.push(`legs ${legs[0]},${legs[1]}`);
        }
        if (hypLabel) {
          parts.push(`hypotenuse ${hypLabel}`);
        }
        if (angleLabel) {
          parts.push(`angle ${angleLabel}`);
        }

        return parts.join("; ");
      }

      if (item.kind === "bar") {
        return `bar ${item.values}`;
      }

      if (item.kind === "custom") {
        return String(item.command || "").replace(/^draw\b\s*[:\-]?\s*/i, "").trim();
      }

      return "";
    }

    function collectCurrentItem() {
      const kind = getSelectedKind();
      if (kind === "axes") {
        return {
          kind,
          xMin: String(els.axesXMin && els.axesXMin.value || "").trim(),
          xMax: String(els.axesXMax && els.axesXMax.value || "").trim(),
          yMin: String(els.axesYMin && els.axesYMin.value || "").trim(),
          yMax: String(els.axesYMax && els.axesYMax.value || "").trim()
        };
      }

      if (kind === "line") {
        return {
          kind,
          expression: String(els.lineExpr && els.lineExpr.value || "").trim()
        };
      }

      if (kind === "point") {
        return {
          kind,
          x: String(els.pointX && els.pointX.value || "").trim(),
          y: String(els.pointY && els.pointY.value || "").trim(),
          label: String(els.pointLabel && els.pointLabel.value || "").trim()
        };
      }

      if (kind === "circle") {
        return {
          kind,
          x: String(els.circleX && els.circleX.value || "").trim(),
          y: String(els.circleY && els.circleY.value || "").trim(),
          radius: String(els.circleRadius && els.circleRadius.value || "").trim()
        };
      }

      if (kind === "square") {
        return {
          kind,
          x: String(els.squareX && els.squareX.value || "").trim(),
          y: String(els.squareY && els.squareY.value || "").trim(),
          size: String(els.squareSize && els.squareSize.value || "").trim(),
          angle: String(els.squareAngle && els.squareAngle.value || "").trim()
        };
      }

      if (kind === "triangle") {
        return {
          kind,
          baseLength: String(els.triangleBaseLength && els.triangleBaseLength.value || "").trim(),
          heightLength: String(els.triangleHeightLength && els.triangleHeightLength.value || "").trim(),
          angleDegrees: String(els.triangleAngleDegrees && els.triangleAngleDegrees.value || "").trim(),
          baseLabel: String(els.triangleBaseLabel && els.triangleBaseLabel.value || "").trim(),
          heightLabel: String(els.triangleHeightLabel && els.triangleHeightLabel.value || "").trim(),
          hypLabel: String(els.triangleHypLabel && els.triangleHypLabel.value || "").trim(),
          angleLabel: String(els.triangleAngleLabel && els.triangleAngleLabel.value || "").trim()
        };
      }

      if (kind === "bar") {
        return {
          kind,
          values: String(els.barValues && els.barValues.value || "").trim()
        };
      }

      return {
        kind,
        command: String(els.customCommand && els.customCommand.value || "").trim()
      };
    }

    function validateItem(item) {
      if (!item) {
        return "Choose a visual to add.";
      }

      if (item.kind === "axes") {
        if (!item.xMin || !item.xMax || !item.yMin || !item.yMax) {
          return "Enter both x and y ranges.";
        }
      } else if (item.kind === "line") {
        if (!item.expression) {
          return "Enter a line or plotted expression.";
        }
      } else if (item.kind === "point") {
        if (!item.x || !item.y) {
          return "Enter the point coordinates.";
        }
      } else if (item.kind === "circle") {
        if (!item.x || !item.y || !item.radius) {
          return "Enter the circle center and radius.";
        }
      } else if (item.kind === "square") {
        if (!item.x || !item.y || !item.size) {
          return "Enter the square center and side length.";
        }
      } else if (item.kind === "triangle") {
        if (!item.baseLabel || !item.heightLabel) {
          return "Enter labels for the two legs of the right triangle.";
        }
        if (!resolveTriangleGeometry(item)) {
          return "Enter both leg lengths, or one leg length plus an acute angle.";
        }
      } else if (item.kind === "bar") {
        if (!item.values) {
          return "Enter the bar values.";
        }
      } else if (item.kind === "custom") {
        if (!item.command) {
          return "Enter a custom DRAW command.";
        }
      }

      const command = buildCommand(item);
      if (!command) {
        return "That visual is incomplete.";
      }

      if (command.length > 220) {
        return "Keep each visual command under 220 characters.";
      }

      return "";
    }

    function getDrawCommands() {
      return state.items
        .map((item) => buildCommand(item))
        .filter((command) => command.length > 0);
    }

    function syncPreview() {
      if (!state.preview) {
        return;
      }

      const lines = splitWrittenLines(els.written && els.written.value)
        .concat(getDrawCommands().map((command) => `DRAW: ${command}`));

      state.preview.setLines(lines);
      state.preview.refresh();
    }

    function renderCommandPreview() {
      if (!els.commandPreview) {
        return;
      }

      const preview = collectCurrentItem();
      const error = validateItem(preview);
      const command = error ? "" : buildCommand(preview);
      els.commandPreview.textContent = command ? `DRAW: ${command}` : "DRAW: ...";
    }

    function updateSaveButton() {
      if (!els.save) {
        return;
      }

      els.save.textContent = state.editingId ? "Update visual" : "Add visual";
      if (els.cancel) {
        els.cancel.hidden = !state.editingId;
      }
    }

    function cancelEdit() {
      state.editingId = null;
      clearError();
      updateSaveButton();
      setKind(getSelectedKind());
    }

    function beginEdit(itemId) {
      const item = state.items.find((entry) => entry.id === itemId);
      if (!item) {
        return;
      }

      state.editingId = item.id;
      updateSaveButton();
      setKind(item.kind, item);
    }

    function moveItem(itemId, direction) {
      const index = state.items.findIndex((entry) => entry.id === itemId);
      if (index < 0) {
        return;
      }

      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= state.items.length) {
        return;
      }

      const [item] = state.items.splice(index, 1);
      state.items.splice(nextIndex, 0, item);
      renderList();
      syncPreview();
    }

    function removeItem(itemId) {
      state.items = state.items.filter((entry) => entry.id !== itemId);
      if (state.editingId === itemId) {
        cancelEdit();
      }
      renderList();
      syncPreview();
    }

    function renderList() {
      if (!els.list) {
        return;
      }

      els.list.replaceChildren();
      const isEmpty = state.items.length === 0;
      if (els.empty) {
        els.empty.hidden = !isEmpty;
      }

      if (isEmpty) {
        return;
      }

      state.items.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "qa-board-drawing-item";

        const body = document.createElement("div");
        body.className = "qa-board-drawing-copy";

        const label = document.createElement("div");
        label.className = "qa-board-drawing-label";
        label.textContent = kindLabels[item.kind] || "Visual";
        body.appendChild(label);

        const code = document.createElement("code");
        code.className = "qa-board-drawing-command";
        code.textContent = `DRAW: ${buildCommand(item)}`;
        body.appendChild(code);

        const actions = document.createElement("div");
        actions.className = "qa-board-drawing-actions";

        const makeButton = (text, handler, disabled) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "btn";
          button.textContent = text;
          button.disabled = !!disabled;
          button.addEventListener("click", handler);
          return button;
        };

        actions.appendChild(makeButton("Edit", () => beginEdit(item.id), false));
        actions.appendChild(makeButton("Up", () => moveItem(item.id, -1), index === 0));
        actions.appendChild(makeButton("Down", () => moveItem(item.id, 1), index === state.items.length - 1));
        actions.appendChild(makeButton("Delete", () => removeItem(item.id), false));

        row.appendChild(body);
        row.appendChild(actions);
        els.list.appendChild(row);
      });
    }

    function saveItem() {
      const candidate = collectCurrentItem();
      const error = validateItem(candidate);
      if (error) {
        showError(error);
        return;
      }

      if (state.editingId) {
        state.items = state.items.map((entry) => (entry.id === state.editingId ? { ...candidate, id: entry.id } : entry));
      } else {
        state.items.push({ ...candidate, id: `draw-${state.nextId}` });
        state.nextId += 1;
      }

      cancelEdit();
      renderList();
      syncPreview();
    }

    function reset() {
      state.items = [];
      state.editingId = null;
      state.nextId = 1;
      clearError();
      if (els.written) {
        els.written.value = "";
      }
      updateSaveButton();
      setKind("axes");
      renderList();
      syncPreview();
    }

    function activate() {
      ensurePreview();
      syncPreview();
      window.requestAnimationFrame(() => {
        if (state.preview) {
          state.preview.refresh();
        }
      });
    }

    function focus() {
      if (els.written) {
        els.written.focus();
      }
    }

    function getPayload() {
      const writtenContent = normalizeText(els.written && els.written.value).trim();
      if (!writtenContent) {
        const message = "Write your question on the board before asking.";
        showError(message);
        throw new Error(message);
      }

      clearError();
      const drawCommands = getDrawCommands();
      return {
        question: summarizeQuestion(writtenContent),
        board: {
          writtenContent,
          drawCommands
        }
      };
    }

    function destroy() {
      if (state.preview && typeof state.preview.destroy === "function") {
        state.preview.destroy();
      }
    }

    function roundGeometry(value) {
      if (!Number.isFinite(value)) {
        return "";
      }

      const rounded = Math.round(value * 100) / 100;
      return Number.isInteger(rounded) ? String(rounded) : String(rounded);
    }

    function parsePositiveNumber(value) {
      const parsed = Number.parseFloat(String(value || "").trim());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
      }

      return parsed;
    }

    function parseAngleDegrees(value) {
      const parsed = Number.parseFloat(String(value || "").trim());
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 90) {
        return null;
      }

      return parsed;
    }

    function resolveTriangleGeometry(item) {
      if (!item || item.kind !== "triangle") {
        return null;
      }

      const baseLength = parsePositiveNumber(item.baseLength);
      const heightLength = parsePositiveNumber(item.heightLength);
      const angleDegrees = parseAngleDegrees(item.angleDegrees);

      let resolvedBase = baseLength;
      let resolvedHeight = heightLength;

      if (angleDegrees !== null) {
        const angleRadians = (angleDegrees * Math.PI) / 180;
        if (resolvedBase !== null) {
          resolvedHeight = resolvedBase * Math.tan(angleRadians);
        } else if (resolvedHeight !== null) {
          resolvedBase = resolvedHeight / Math.tan(angleRadians);
        } else {
          resolvedBase = 4;
          resolvedHeight = resolvedBase * Math.tan(angleRadians);
        }
      } else if (resolvedBase === null || resolvedHeight === null) {
        return null;
      }

      if (!Number.isFinite(resolvedBase) || !Number.isFinite(resolvedHeight) || resolvedBase <= 0 || resolvedHeight <= 0) {
        return null;
      }

      return {
        baseLength: roundGeometry(resolvedBase),
        heightLength: roundGeometry(resolvedHeight),
        derivedAngleLabel: angleDegrees !== null ? `${roundGeometry(angleDegrees)}°` : ""
      };
    }

    function buildTriangleAngleText(item, geometry) {
      const rawLabel = String(item && item.angleLabel || "").trim();
      const derived = String(geometry && geometry.derivedAngleLabel || "").trim();
      if (!derived) {
        return rawLabel;
      }

      if (!rawLabel) {
        return derived;
      }

      if (/[0-9]/.test(rawLabel) || rawLabel.includes("°")) {
        return rawLabel;
      }

      return `${rawLabel}=${derived}`;
    }

    if (els.kind) {
      els.kind.addEventListener("change", () => {
        state.editingId = null;
        updateSaveButton();
        setKind(getSelectedKind());
      });
    }

    const previewInputs = [
      els.written,
      els.axesXMin,
      els.axesXMax,
      els.axesYMin,
      els.axesYMax,
      els.lineExpr,
      els.pointX,
      els.pointY,
      els.pointLabel,
      els.circleX,
      els.circleY,
      els.circleRadius,
      els.squareX,
      els.squareY,
      els.squareSize,
      els.squareAngle,
      els.triangleBaseLength,
      els.triangleHeightLength,
      els.triangleAngleDegrees,
      els.triangleBaseLabel,
      els.triangleHeightLabel,
      els.triangleHypLabel,
      els.triangleAngleLabel,
      els.barValues,
      els.customCommand
    ].filter(Boolean);

    for (const input of previewInputs) {
      input.addEventListener("input", () => {
        clearError();
        renderCommandPreview();
        syncPreview();
      });
    }

    if (els.save) {
      els.save.addEventListener("click", saveItem);
    }

    if (els.cancel) {
      els.cancel.addEventListener("click", cancelEdit);
    }

    reset();

    return {
      activate,
      destroy,
      focus,
      getPayload,
      reset
    };
  }

  window.createLessonQuestionBoardComposer = createLessonQuestionBoardComposer;
})();
