(function () {
  "use strict";

  const state = {
    sampleId: null,
    sourceType: null,
    currentReads: null,
    currentUmis: null,
    currentSat: null,
    satSeries: null,
    umiSeries: null,
    satFit: null,
    umiFit: null,
  };

  const els = {
    fileInput: document.getElementById("fileInput"),
    status: document.getElementById("status"),
    sampleId: document.getElementById("sampleId"),
    sourceType: document.getElementById("sourceType"),
    currentReads: document.getElementById("currentReads"),
    currentUmis: document.getElementById("currentUmis"),
    currentSat: document.getElementById("currentSat"),
    satA: document.getElementById("satA"),
    umiA: document.getElementById("umiA"),
    umiB: document.getElementById("umiB"),
    fitNotes: document.getElementById("fitNotes"),
    satCanvas: document.getElementById("satCanvas"),
    umiCanvas: document.getElementById("umiCanvas"),
    readsTarget: document.getElementById("readsTarget"),
    umiTarget: document.getElementById("umiTarget"),
    satTarget: document.getElementById("satTarget"),
    runPredictions: document.getElementById("runPredictions"),
    results: document.getElementById("results"),
  };

  function toNumber(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    const cleaned = value.replace(/[,%]/g, "").trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function prettyNum(n, digits = 0) {
    if (n === null || n === undefined || !Number.isFinite(n)) return "-";
    return n.toLocaleString(undefined, { maximumFractionDigits: digits });
  }

  function pairedSeries(pairs) {
    const sorted = pairs
      .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y))
      .sort((a, b) => a.x - b.x);
    return {
      x: sorted.map((d) => d.x),
      y: sorted.map((d) => d.y),
    };
  }

  function collectFromMetricKeys(obj, keyRegex, valueTransform) {
    const pairs = [];
    Object.keys(obj).forEach((key) => {
      const m = key.match(keyRegex);
      if (!m) return;
      const reads = Number(m[1]);
      let y = toNumber(obj[key]);
      if (!Number.isFinite(reads) || !Number.isFinite(y)) return;
      if (valueTransform) y = valueTransform(y);
      pairs.push({ x: reads, y });
    });
    return pairedSeries(pairs);
  }

  function extractJsonFromWebSummary(htmlText) {
    const marker = "const data";
    const markerIdx = htmlText.indexOf(marker);
    if (markerIdx < 0) throw new Error("Could not find `const data` in web_summary HTML.");

    const firstBrace = htmlText.indexOf("{", markerIdx);
    if (firstBrace < 0) throw new Error("Could not locate JSON object in web_summary HTML.");

    let depth = 0;
    let inString = false;
    let quote = "";
    let escaped = false;
    for (let i = firstBrace; i < htmlText.length; i += 1) {
      const ch = htmlText[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          inString = false;
          quote = "";
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = true;
        quote = ch;
      } else if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          return JSON.parse(htmlText.slice(firstBrace, i + 1));
        }
      }
    }
    throw new Error("Failed to parse JSON payload from web_summary HTML.");
  }

  function fromWebSummary(data) {
    const out = {
      sampleId: null,
      sourceType: "web_summary.html",
      currentReads: null,
      currentUmis: null,
      currentSat: null,
      satSeries: null,
      umiSeries: null,
    };

    const summary = data?.summary;
    out.sampleId = summary?.sample?.id || data?.sample?.id || "Unknown sample";

    const satX = summary?.analysis_tab?.seq_saturation_plot?.plot?.data?.[0]?.x;
    const satY = summary?.analysis_tab?.seq_saturation_plot?.plot?.data?.[0]?.y;
    if (Array.isArray(satX) && Array.isArray(satY)) {
      const pairs = satX.map((x, i) => ({
        x: Number(x),
        y: Number(satY[i]),
      }));
      out.satSeries = pairedSeries(
        pairs.map((d) => ({
          x: d.x,
          y: d.y > 1 && d.y <= 100 ? d.y / 100 : d.y,
        }))
      );
    }

    const seqRows = summary?.summary_tab?.sequencing?.table?.rows || [];
    for (const row of seqRows) {
      if (!Array.isArray(row)) continue;
      if (String(row[0]).toLowerCase().includes("sequencing saturation")) {
        const sat = toNumber(row[1]);
        out.currentSat = sat !== null ? (sat > 1 ? sat / 100 : sat) : null;
      }
    }

    const cellsRows = summary?.summary_tab?.cells?.table?.rows || [];
    for (const row of cellsRows) {
      if (!Array.isArray(row)) continue;
      const key = String(row[0]).toLowerCase();
      if (key.includes("mean reads per cell")) out.currentReads = toNumber(row[1]);
      if (key.includes("median umi") || key.includes("median counts")) out.currentUmis = toNumber(row[1]);
    }

    return out;
  }

  function fromMetricsSummary(obj) {
    const out = {
      sampleId: obj.sample_id || "Unknown sample",
      sourceType: "metrics_summary.json",
      currentReads: toNumber(obj.reads_per_cell),
      currentUmis: null,
      currentSat: null,
      satSeries: null,
      umiSeries: null,
    };

    const umiCurrentKey = Object.keys(obj).find(
      (k) => k.includes("filtered_bcs_median_counts") && !k.includes("subsampled")
    );
    if (umiCurrentKey) out.currentUmis = toNumber(obj[umiCurrentKey]);

    const umiSeries = collectFromMetricKeys(
      obj,
      /raw_rpc_(\d+)_subsampled_filtered_bcs_median_counts$/i
    );
    if (umiSeries.x.length > 0) {
      const pairs = umiSeries.x.map((x, i) => ({ x, y: umiSeries.y[i] })).filter((d) => d.y > 0);
      out.umiSeries = pairedSeries(pairs);
    }

    const satSeries = collectFromMetricKeys(
      obj,
      /raw_rpc_(\d+)_subsampled_.*(sequencing_saturation|duplication_frac|dup_frac|percent_duplicates)$/i,
      (v) => (v > 1 && v <= 100 ? v / 100 : v)
    );
    if (satSeries.x.length > 0) {
      const pairs = satSeries.x.map((x, i) => ({ x, y: satSeries.y[i] })).filter((d) => d.y > 0 && d.y < 1);
      out.satSeries = pairedSeries(pairs);
    }

    if (out.currentSat === null) {
      const satValue =
        toNumber(obj.sequencing_saturation) ??
        toNumber(obj.duplication_frac) ??
        toNumber(obj.percent_duplicates);
      if (satValue !== null) out.currentSat = satValue > 1 ? satValue / 100 : satValue;
    }

    return out;
  }

  function fitSaturationCurve(series) {
    if (!series || series.x.length < 2) return null;
    const x = series.x;
    const y = series.y.map((v) => Math.min(0.999999, Math.max(1e-6, v)));

    const estimates = x.map((xi, i) => (xi * (1 - y[i])) / y[i]).filter((v) => v > 0 && Number.isFinite(v));
    if (estimates.length === 0) return null;
    estimates.sort((a, b) => a - b);
    let a = estimates[Math.floor(estimates.length / 2)];

    const lr = Math.max(1e-6, a * 1e-4);
    for (let iter = 0; iter < 3000; iter += 1) {
      let grad = 0;
      for (let i = 0; i < x.length; i += 1) {
        const xi = x[i];
        const yi = y[i];
        const pred = xi / (xi + a);
        grad += 2 * (pred - yi) * (-xi / ((xi + a) * (xi + a)));
      }
      a -= (lr * grad) / x.length;
      if (a < 1e-6) a = 1e-6;
    }

    return {
      a,
      predict: (reads) => reads / (reads + a),
      readsForTargetSat: (sat) => (a * sat) / (1 - sat),
    };
  }

  function linearRegression(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;
    const sx = xs.reduce((p, c) => p + c, 0);
    const sy = ys.reduce((p, c) => p + c, 0);
    const sxx = xs.reduce((p, c) => p + c * c, 0);
    const sxy = xs.reduce((p, c, i) => p + c * ys[i], 0);
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-12) return null;
    const slope = (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;
    return { slope, intercept };
  }

  function fitUmiCurve(series) {
    if (!series || series.x.length < 2) return null;
    const clean = series.x
      .map((x, i) => ({ x, y: series.y[i] }))
      .filter((d) => d.x > 0 && d.y > 0 && Number.isFinite(d.x) && Number.isFinite(d.y));
    if (clean.length < 2) return null;

    const invX = clean.map((d) => 1 / d.x);
    const invY = clean.map((d) => 1 / d.y);
    const lr = linearRegression(invX, invY);
    if (!lr || lr.intercept <= 0) return null;

    let b = 1 / lr.intercept;
    let a = lr.slope / lr.intercept;
    if (!(a > 0 && b > 0)) return null;

    const maxY = Math.max(...clean.map((d) => d.y));
    if (b < maxY) b = maxY * 1.02;

    const stepA = Math.max(1e-6, a * 8e-5);
    const stepB = Math.max(1e-6, b * 8e-5);
    for (let iter = 0; iter < 4000; iter += 1) {
      let gradA = 0;
      let gradB = 0;
      for (const d of clean) {
        const pred = (b * d.x) / (d.x + a);
        const err = pred - d.y;
        gradA += 2 * err * (-b * d.x) / ((d.x + a) * (d.x + a));
        gradB += 2 * err * (d.x / (d.x + a));
      }
      a -= (stepA * gradA) / clean.length;
      b -= (stepB * gradB) / clean.length;
      if (a < 1e-6) a = 1e-6;
      if (b < maxY * 1.001) b = maxY * 1.001;
    }

    return {
      a,
      b,
      predict: (reads) => (b * reads) / (reads + a),
      readsForTargetUmi: (umi) => (a * umi) / (b - umi),
    };
  }

  function resetCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 640;
    const cssHeight = canvas.clientHeight || 380;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function drawPlot(canvas, opts) {
    const ctx = resetCanvas(canvas);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const m = { left: 56, right: 16, top: 34, bottom: 42 };
    const w = width - m.left - m.right;
    const h = height - m.top - m.bottom;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fffdf6";
    ctx.fillRect(0, 0, width, height);

    if (!opts || !opts.x || opts.x.length < 2) {
      ctx.fillStyle = "#4b5563";
      ctx.font = "14px Space Grotesk, sans-serif";
      ctx.fillText("No plottable data in this file.", 20, 30);
      return;
    }

    const xMaxData = Math.max(...opts.x);
    const xMax = Math.max(xMaxData, opts.targetX || 0) * 1.15;
    const yMaxData = Math.max(...opts.y);
    const yMax = Math.max(yMaxData, opts.curveMaxY || yMaxData) * 1.1;

    const xToPx = (x) => m.left + (x / xMax) * w;
    const yToPx = (y) => m.top + h - (y / yMax) * h;

    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(m.left, m.top);
    ctx.lineTo(m.left, m.top + h);
    ctx.lineTo(m.left + w, m.top + h);
    ctx.stroke();

    ctx.fillStyle = "#111827";
    ctx.font = "12px Space Grotesk, sans-serif";
    ctx.fillText(opts.title || "", m.left, 18);
    ctx.fillText(opts.xLabel || "x", m.left + w - 80, m.top + h + 30);
    ctx.fillText(opts.yLabel || "y", 6, m.top + 14);

    ctx.fillStyle = "#1f2937";
    for (let i = 0; i <= 4; i += 1) {
      const xVal = (xMax * i) / 4;
      const xPx = xToPx(xVal);
      ctx.fillText(prettyNum(xVal), xPx - 16, m.top + h + 16);
    }
    for (let i = 0; i <= 4; i += 1) {
      const yVal = (yMax * i) / 4;
      const yPx = yToPx(yVal);
      ctx.fillText(prettyNum(yVal, yMax <= 1.2 ? 2 : 0), 8, yPx + 4);
    }

    ctx.fillStyle = opts.pointColor || "#0f766e";
    for (let i = 0; i < opts.x.length; i += 1) {
      ctx.beginPath();
      ctx.arc(xToPx(opts.x[i]), yToPx(opts.y[i]), 3.2, 0, 2 * Math.PI);
      ctx.fill();
    }

    if (typeof opts.fitFn === "function") {
      ctx.strokeStyle = opts.lineColor || "#ea580c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const samples = 220;
      for (let i = 0; i <= samples; i += 1) {
        const xVal = (xMax * i) / samples;
        const yVal = opts.fitFn(xVal);
        const xPx = xToPx(xVal);
        const yPx = yToPx(yVal);
        if (i === 0) ctx.moveTo(xPx, yPx);
        else ctx.lineTo(xPx, yPx);
      }
      ctx.stroke();
    }

    if (Number.isFinite(opts.targetX) && Number.isFinite(opts.targetY)) {
      ctx.fillStyle = "#be123c";
      ctx.beginPath();
      ctx.arc(xToPx(opts.targetX), yToPx(opts.targetY), 4.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  function render() {
    els.sampleId.textContent = state.sampleId || "-";
    els.sourceType.textContent = state.sourceType || "-";
    els.currentReads.textContent = prettyNum(state.currentReads);
    els.currentUmis.textContent = prettyNum(state.currentUmis);
    els.currentSat.textContent =
      state.currentSat !== null ? `${prettyNum(state.currentSat * 100, 2)}%` : "-";

    els.satA.textContent = state.satFit ? prettyNum(state.satFit.a) : "-";
    els.umiA.textContent = state.umiFit ? prettyNum(state.umiFit.a) : "-";
    els.umiB.textContent = state.umiFit ? prettyNum(state.umiFit.b) : "-";

    const notes = [];
    if (!state.satFit) notes.push("Sequencing saturation fit unavailable from current file.");
    if (!state.umiFit) notes.push("UMI fit unavailable from current file.");
    if (notes.length === 0) notes.push("Fits computed successfully.");
    els.fitNotes.textContent = notes.join(" ");

    drawPlot(els.satCanvas, {
      x: state.satSeries?.x,
      y: state.satSeries?.y,
      fitFn: state.satFit?.predict,
      title: "Saturation Curve",
      xLabel: "Reads/Cell",
      yLabel: "Saturation",
      curveMaxY: 1,
      pointColor: "#0f766e",
      lineColor: "#b45309",
    });

    drawPlot(els.umiCanvas, {
      x: state.umiSeries?.x,
      y: state.umiSeries?.y,
      fitFn: state.umiFit?.predict,
      title: "UMI Curve",
      xLabel: "Reads/Cell",
      yLabel: "UMIs/Cell",
      curveMaxY: state.umiFit?.b || undefined,
      pointColor: "#1d4ed8",
      lineColor: "#dc2626",
    });
  }

  function setFromParsed(parsed) {
    state.sampleId = parsed.sampleId;
    state.sourceType = parsed.sourceType;
    state.currentReads = parsed.currentReads;
    state.currentUmis = parsed.currentUmis;
    state.currentSat = parsed.currentSat;
    state.satSeries = parsed.satSeries;
    state.umiSeries = parsed.umiSeries;
    state.satFit = fitSaturationCurve(parsed.satSeries);
    state.umiFit = fitUmiCurve(parsed.umiSeries);
    render();
  }

  function runPredictions() {
    const readsTarget = toNumber(els.readsTarget.value);
    const umiTarget = toNumber(els.umiTarget.value);
    const satPctTarget = toNumber(els.satTarget.value);
    const out = [];

    if (Number.isFinite(readsTarget) && readsTarget > 0) {
      out.push(`<h3>From ${prettyNum(readsTarget)} reads/cell</h3>`);
      if (state.umiFit) {
        const predU = state.umiFit.predict(readsTarget);
        out.push(`<p>Predicted UMIs/cell: <strong>${prettyNum(predU)}</strong></p>`);
      }
      if (state.satFit) {
        const predS = state.satFit.predict(readsTarget) * 100;
        out.push(`<p>Predicted saturation: <strong>${prettyNum(predS, 2)}%</strong></p>`);
      }
    }

    if (Number.isFinite(umiTarget) && umiTarget > 0) {
      out.push(`<h3>For target ${prettyNum(umiTarget)} UMIs/cell</h3>`);
      if (!state.umiFit) {
        out.push("<p>UMI model unavailable for current file.</p>");
      } else if (umiTarget >= state.umiFit.b) {
        out.push(
          `<p>Target exceeds fitted UMI max (${prettyNum(state.umiFit.b)}). Reads required are undefined.</p>`
        );
      } else {
        const r = state.umiFit.readsForTargetUmi(umiTarget);
        out.push(`<p>Required reads/cell: <strong>${prettyNum(r)}</strong></p>`);
      }
    }

    if (Number.isFinite(satPctTarget) && satPctTarget > 0) {
      const sat = satPctTarget > 1 ? satPctTarget / 100 : satPctTarget;
      out.push(`<h3>For target ${prettyNum(sat * 100, 2)}% saturation</h3>`);
      if (!state.satFit) {
        out.push("<p>Saturation model unavailable for current file.</p>");
      } else if (sat >= 1) {
        out.push("<p>Saturation target must be below 100%.</p>");
      } else {
        const r = state.satFit.readsForTargetSat(sat);
        out.push(`<p>Required reads/cell: <strong>${prettyNum(r)}</strong></p>`);
      }
    }

    if (out.length === 0) {
      out.push("<p>Enter at least one target value and click Run Predictions.</p>");
    }
    els.results.innerHTML = out.join("");
  }

  async function handleFile(file) {
    els.status.textContent = `Reading ${file.name}...`;
    try {
      const text = await file.text();
      let parsed;

      if (file.name.toLowerCase().endsWith(".json")) {
        parsed = fromMetricsSummary(JSON.parse(text));
      } else if (file.name.toLowerCase().endsWith(".html") || file.name.toLowerCase().endsWith(".htm")) {
        parsed = fromWebSummary(extractJsonFromWebSummary(text));
      } else {
        try {
          parsed = fromMetricsSummary(JSON.parse(text));
        } catch (_jsonErr) {
          parsed = fromWebSummary(extractJsonFromWebSummary(text));
        }
      }

      setFromParsed(parsed);
      els.status.textContent = `Loaded ${file.name}`;
      els.results.innerHTML = "";
    } catch (err) {
      els.status.textContent = "Unable to parse this file.";
      els.results.innerHTML = `<p>${String(err.message || err)}</p>`;
    }
  }

  els.fileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleFile(file);
  });

  els.runPredictions.addEventListener("click", runPredictions);
  window.addEventListener("resize", render);
  render();
})();
