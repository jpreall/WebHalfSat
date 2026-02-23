(function () {
  "use strict";

  const state = {
    sampleId: null,
    sourceType: null,
    currentCells: null,
    currentReads: null,
    currentUmis: null,
    currentSat: null,
    lowerMetricKind: "umi",
    satSeries: null,
    umiSeries: null,
    satFit: null,
    umiFit: null,
    satHoverX: null,
    umiHoverX: null,
    satXZoomScale: 1,
    umiXZoomScale: 1,
  };

  const PLOT_MARGINS = { left: 56, right: 16, top: 34, bottom: 42 };

  const els = {
    fileInput: document.getElementById("fileInput"),
    status: document.getElementById("status"),
    loadExampleWeb: document.getElementById("loadExampleWeb"),
    loadExampleMetrics: document.getElementById("loadExampleMetrics"),
    sampleId: document.getElementById("sampleId"),
    sourceType: document.getElementById("sourceType"),
    currentCells: document.getElementById("currentCells"),
    currentReads: document.getElementById("currentReads"),
    currentUmis: document.getElementById("currentUmis"),
    currentSat: document.getElementById("currentSat"),
    lowerFitLabelA: document.getElementById("lowerFitLabelA"),
    lowerFitLabelB: document.getElementById("lowerFitLabelB"),
    lowerPlotTitle: document.getElementById("lowerPlotTitle"),
    metricTargetLabel: document.getElementById("metricTargetLabel"),
    satA: document.getElementById("satA"),
    umiA: document.getElementById("umiA"),
    umiB: document.getElementById("umiB"),
    fitNotes: document.getElementById("fitNotes"),
    satCanvas: document.getElementById("satCanvas"),
    umiCanvas: document.getElementById("umiCanvas"),
    satZoomOut: document.getElementById("satZoomOut"),
    satZoomIn: document.getElementById("satZoomIn"),
    satZoomReset: document.getElementById("satZoomReset"),
    satZoomLabel: document.getElementById("satZoomLabel"),
    umiZoomOut: document.getElementById("umiZoomOut"),
    umiZoomIn: document.getElementById("umiZoomIn"),
    umiZoomReset: document.getElementById("umiZoomReset"),
    umiZoomLabel: document.getElementById("umiZoomLabel"),
    readsTarget: document.getElementById("readsTarget"),
    umiTarget: document.getElementById("umiTarget"),
    satTarget: document.getElementById("satTarget"),
    runPredictions: document.getElementById("runPredictions"),
    results: document.getElementById("results"),
  };

  function lowerMetricMeta(kind) {
    if (kind === "gene") {
      return {
        singular: "Gene",
        plural: "Genes",
        perCell: "Genes/Cell",
        panelTitle: "Genes vs Reads",
      };
    }
    return {
      singular: "UMI",
      plural: "UMIs",
      perCell: "UMIs/Cell",
      panelTitle: "UMIs vs Reads",
    };
  }

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

  function metricsKeyPreferenceScore(key) {
    const lower = String(key).toLowerCase();
    let score = 0;
    if (lower.startsWith("multi_")) score += 100;
    else if (lower.includes("_multi_")) score += 60;
    if (lower.includes("raw_rpc_")) score += 25;
    else if (lower.includes("raw")) score += 8;
    if (lower.includes("conf_mapped") || lower.includes("mapped")) score -= 5;
    return score;
  }

  function collectFromMetricKeys(obj, keyRegex, valueTransform, keyScoreFn) {
    const byX = new Map();
    Object.keys(obj).forEach((key) => {
      const m = key.match(keyRegex);
      if (!m) return;
      const reads = Number(m[1]);
      let y = toNumber(obj[key]);
      if (!Number.isFinite(reads) || !Number.isFinite(y)) return;
      if (valueTransform) y = valueTransform(y);
      const score = typeof keyScoreFn === "function" ? keyScoreFn(key) : 0;
      const prev = byX.get(reads);
      if (!prev || score > prev.score) byX.set(reads, { x: reads, y, score, key });
    });
    return pairedSeries([...byX.values()].map(({ x, y }) => ({ x, y })));
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

  function extractEstimatedCellsFromMetrics(obj) {
    const exactKeys = [
      "estimated_number_of_cells",
      "estimated_cells",
      "filtered_bcs",
      "filtered_bcs_transcriptome_union",
    ];
    for (const key of exactKeys) {
      const v = toNumber(obj[key]);
      if (Number.isFinite(v) && v > 0) return v;
    }

    // Fall back to likely metric names while avoiding percentages/fractions.
    for (const key of Object.keys(obj)) {
      const lower = key.toLowerCase();
      if (
        (lower.includes("estimated") && lower.includes("cell")) ||
        lower === "filtered_bcs" ||
        lower === "filtered_bcs_transcriptome_union"
      ) {
        if (lower.includes("frac") || lower.includes("percent") || lower.includes("pct")) continue;
        const v = toNumber(obj[key]);
        if (Number.isFinite(v) && v > 0) return v;
      }
    }
    return null;
  }

  function extractCurrentSaturationFromMetrics(obj, currentReads) {
    const direct =
      toNumber(obj.sequencing_saturation) ??
      toNumber(obj.duplication_frac) ??
      toNumber(obj.dup_frac) ??
      toNumber(obj.percent_duplicates);
    if (direct !== null) return direct > 1 ? direct / 100 : direct;

    // Heuristic fallback across Cell Ranger versions / assay-specific prefixes.
    let best = null;
    let bestScore = -1;
    for (const key of Object.keys(obj)) {
      const lower = key.toLowerCase();
      // Skip subsampled/downsampling series keys; we want the current aggregate metric.
      if (lower.includes("subsampled") || lower.includes("raw_rpc_")) continue;

      let score = -1;
      if (lower.includes("sequencing_saturation")) score = 4;
      else if (lower.includes("duplication_frac") || lower.endsWith("dup_frac")) score = 3;
      else if (lower.includes("percent_duplicates")) score = 2;
      else if (lower.includes("duplicate") && (lower.includes("frac") || lower.includes("percent"))) score = 1;

      if (score < 0) continue;
      const v = toNumber(obj[key]);
      if (!Number.isFinite(v)) continue;
      score += metricsKeyPreferenceScore(key);
      if (score > bestScore) {
        best = v;
        bestScore = score;
      }
    }

    if (best !== null) return best > 1 ? best / 100 : best;

    // Final fallback: infer "current" saturation from the preferred raw_rpc subsampled series.
    const satSeries = [];
    for (const key of Object.keys(obj)) {
      const m = key.match(
        /raw_rpc_(\d+)_subsampled_.*(sequencing_saturation|duplication_frac|dup_frac|percent_duplicates)$/i
      );
      if (!m) continue;
      const reads = Number(m[1]);
      let v = toNumber(obj[key]);
      if (!Number.isFinite(reads) || !Number.isFinite(v)) continue;
      v = v > 1 ? v / 100 : v;
      if (!(v >= 0 && v <= 1)) continue;
      satSeries.push({ reads, v, score: metricsKeyPreferenceScore(key) });
    }
    if (satSeries.length === 0) return null;

    // Prefer the point nearest to current reads/cell if available, otherwise highest reads/cell.
    if (Number.isFinite(currentReads) && currentReads > 0) {
      satSeries.sort((a, b) => {
        const da = Math.abs(a.reads - currentReads);
        const db = Math.abs(b.reads - currentReads);
        if (da !== db) return da - db;
        if (a.score !== b.score) return b.score - a.score;
        return b.reads - a.reads;
      });
      return satSeries[0].v;
    }

    satSeries.sort((a, b) => {
      if (a.reads !== b.reads) return b.reads - a.reads;
      return b.score - a.score;
    });
    return satSeries[0].v;
  }

  function seriesFromWebPlot(plotWrapper, valueTransform) {
    const x = plotWrapper?.plot?.data?.[0]?.x;
    const y = plotWrapper?.plot?.data?.[0]?.y;
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length || x.length < 2) return null;

    const pairs = x.map((xv, i) => {
      let yv = Number(y[i]);
      if (typeof valueTransform === "function") yv = valueTransform(yv);
      return { x: Number(xv), y: yv };
    });
    const series = pairedSeries(pairs);
    return series.x.length >= 2 ? series : null;
  }

  function pickWebSummaryLowerSeries(summary) {
    const analysis = summary?.analysis_tab || {};
    const exactCandidates = [
      { key: "median_umi_plot", kind: "umi" },
      { key: "median_umis_plot", kind: "umi" },
      { key: "median_count_plot", kind: "umi" },
      { key: "median_counts_plot", kind: "umi" },
      { key: "transcripts_per_cell_plot", kind: "umi" },
      { key: "median_transcript_plot", kind: "umi" },
      { key: "median_gene_plot", kind: "gene" },
      { key: "median_genes_plot", kind: "gene" },
      { key: "genes_per_cell_plot", kind: "gene" },
    ];

    for (const c of exactCandidates) {
      const series = seriesFromWebPlot(analysis[c.key]);
      if (series) return { series, kind: c.kind, sourceKey: c.key };
    }

    const ranked = Object.entries(analysis)
      .map(([key, value]) => {
        if (!value || typeof value !== "object" || !value.plot) return null;
        const lower = key.toLowerCase();
        if (lower.includes("sat")) return null;
        if (lower.includes("umi") || lower.includes("transcript") || lower.includes("count")) {
          return { key, value, kind: "umi", score: 3 };
        }
        if (lower.includes("gene")) {
          return { key, value, kind: "gene", score: 2 };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    for (const c of ranked) {
      const series = seriesFromWebPlot(c.value);
      if (series) return { series, kind: c.kind, sourceKey: c.key };
    }

    return null;
  }

  function fromWebSummary(data) {
    const out = {
      sampleId: null,
      sourceType: "web_summary.html",
      currentCells: null,
      currentReads: null,
      currentUmis: null,
      currentSat: null,
      lowerMetricKind: "umi",
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
      if (key.includes("estimated number of cells")) out.currentCells = toNumber(row[1]);
      if (key.includes("mean reads per cell")) out.currentReads = toNumber(row[1]);
      if (key.includes("median umi") || key.includes("median counts")) out.currentUmis = toNumber(row[1]);
    }

    const lowerSeries = pickWebSummaryLowerSeries(summary);
    if (lowerSeries) {
      out.umiSeries = lowerSeries.series;
      out.lowerMetricKind = lowerSeries.kind;
    }

    return out;
  }

  function fromMetricsSummary(obj) {
    const out = {
      sampleId: obj.sample_id || "Unknown sample",
      sourceType: "metrics_summary.json",
      currentCells: extractEstimatedCellsFromMetrics(obj),
      currentReads: toNumber(obj.reads_per_cell),
      currentUmis: null,
      currentSat: null,
      lowerMetricKind: "umi",
      satSeries: null,
      umiSeries: null,
    };

    const umiCurrentKey = Object.keys(obj).find(
      (k) => k.includes("filtered_bcs_median_counts") && !k.includes("subsampled")
    );
    if (umiCurrentKey) out.currentUmis = toNumber(obj[umiCurrentKey]);

    const umiSeries = collectFromMetricKeys(
      obj,
      /raw_rpc_(\d+)_subsampled_filtered_bcs_median_counts$/i,
      null,
      metricsKeyPreferenceScore
    );
    if (umiSeries.x.length > 0) {
      const pairs = umiSeries.x.map((x, i) => ({ x, y: umiSeries.y[i] })).filter((d) => d.y > 0);
      out.umiSeries = pairedSeries(pairs);
    }

    const satSeries = collectFromMetricKeys(
      obj,
      /raw_rpc_(\d+)_subsampled_.*(sequencing_saturation|duplication_frac|dup_frac|percent_duplicates)$/i,
      (v) => (v > 1 && v <= 100 ? v / 100 : v),
      metricsKeyPreferenceScore
    );
    if (satSeries.x.length > 0) {
      const pairs = satSeries.x.map((x, i) => ({ x, y: satSeries.y[i] })).filter((d) => d.y > 0 && d.y < 1);
      out.satSeries = pairedSeries(pairs);
    }

    if (out.currentSat === null) out.currentSat = extractCurrentSaturationFromMetrics(obj, out.currentReads);

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

  function getPlotXMax(series, opts) {
    if (!series || !series.x || series.x.length < 1) return null;
    const xMaxData = Math.max(...series.x);
    const autoXMax = Math.max(xMaxData, opts?.targetX || 0) * (opts?.xBufferFactor || 1.15);
    const scale = Number.isFinite(opts?.xZoomScale) && opts.xZoomScale > 0 ? opts.xZoomScale : 1;
    return autoXMax * scale;
  }

  function drawTag(ctx, x, y, text, opts) {
    const padX = 6;
    const padY = 4;
    ctx.font = (opts && opts.font) || "12px Space Grotesk, sans-serif";
    const w = ctx.measureText(text).width + padX * 2;
    const h = 20;
    const rx = Math.max(2, x);
    const ry = Math.max(2, y);
    ctx.fillStyle = (opts && opts.bg) || "rgba(15, 23, 42, 0.92)";
    ctx.strokeStyle = (opts && opts.border) || "rgba(148, 163, 184, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(rx, ry, w, h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = (opts && opts.fg) || "#f8fafc";
    ctx.fillText(text, rx + padX, ry + 14);
    return { w, h };
  }

  function drawPlot(canvas, opts) {
    const ctx = resetCanvas(canvas);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const m = PLOT_MARGINS;
    const w = width - m.left - m.right;
    const h = height - m.top - m.bottom;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, width, height);

    if (!opts || !opts.x || opts.x.length < 2) {
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "14px Space Grotesk, sans-serif";
      ctx.fillText("No plottable data in this file.", 20, 30);
      return;
    }

    const xMax = getPlotXMax({ x: opts.x }, { targetX: opts.targetX, xZoomScale: opts.xZoomScale });
    if (!Number.isFinite(xMax) || xMax <= 0) return;
    const yMaxData = Math.max(...opts.y);
    const referenceY = Number.isFinite(opts.referenceY) ? opts.referenceY : null;
    const yCeiling = Math.max(yMaxData, opts.curveMaxY || yMaxData, referenceY || -Infinity);
    const yMax = yCeiling * (opts.yBufferFactor || 1.08);

    const xToPx = (x) => m.left + (x / xMax) * w;
    const yToPx = (y) => m.top + h - (y / yMax) * h;

    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(m.left, m.top);
    ctx.lineTo(m.left, m.top + h);
    ctx.lineTo(m.left + w, m.top + h);
    ctx.stroke();

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "12px Space Grotesk, sans-serif";
    ctx.fillText(opts.title || "", m.left, 18);
    ctx.fillText(opts.xLabel || "x", m.left + w - 80, m.top + h + 30);
    ctx.fillText(opts.yLabel || "y", 6, m.top + 14);

    ctx.fillStyle = "#cbd5e1";
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

    if (referenceY !== null && referenceY >= 0 && referenceY <= yMax) {
      const refYPx = yToPx(referenceY);
      ctx.save();
      ctx.strokeStyle = opts.referenceLineColor || "rgba(148, 163, 184, 0.8)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(m.left, refYPx);
      ctx.lineTo(m.left + w, refYPx);
      ctx.stroke();
      ctx.restore();

      const refDigits =
        typeof opts.referenceDigits === "number" ? opts.referenceDigits : referenceY <= 1.2 ? 2 : 0;
      const refText = `${opts.referenceLabelPrefix || "max"} ${prettyNum(referenceY, refDigits)}`;
      ctx.fillStyle = opts.referenceTextColor || "#e2e8f0";
      ctx.font = "12px Space Grotesk, sans-serif";
      const textX = Math.max(m.left + 6, m.left + w - 124);
      const textY = Math.max(m.top + 14, refYPx - 6);
      ctx.fillText(refText, textX, textY);
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

    if (Number.isFinite(opts.fixedCrosshairX) && Number.isFinite(opts.fixedCrosshairY)) {
      const cx = Math.max(0, Math.min(xMax, opts.fixedCrosshairX));
      const cy = Math.max(0, Math.min(yMax, opts.fixedCrosshairY));
      const cpx = xToPx(cx);
      const cpy = yToPx(cy);

      ctx.save();
      ctx.strokeStyle = opts.fixedCrosshairLineColor || "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(cpx, m.top + h);
      ctx.lineTo(cpx, cpy);
      ctx.lineTo(m.left, cpy);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = opts.fixedCrosshairPointColor || "rgba(255,255,255,0.75)";
      ctx.beginPath();
      ctx.arc(cpx, cpy, 3, 0, 2 * Math.PI);
      ctx.fill();

      if (opts.fixedCrosshairLabel) {
        ctx.fillStyle = opts.fixedCrosshairTextColor || "rgba(226, 232, 240, 0.9)";
        ctx.font = "11px Space Grotesk, sans-serif";
        ctx.fillText(
          opts.fixedCrosshairLabel,
          Math.min(cpx + 6, m.left + w - 70),
          Math.max(m.top + 12, cpy - 8)
        );
      }
    }

    if (Number.isFinite(opts.targetX) && Number.isFinite(opts.targetY)) {
      ctx.fillStyle = "#f43f5e";
      ctx.beginPath();
      ctx.arc(xToPx(opts.targetX), yToPx(opts.targetY), 4.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    if (Number.isFinite(opts.hoverX)) {
      const hoverX = Math.max(0, Math.min(xMax, opts.hoverX));
      let hoverY = null;
      if (typeof opts.fitFn === "function") {
        const y = opts.fitFn(hoverX);
        if (Number.isFinite(y)) hoverY = y;
      } else if (Array.isArray(opts.x) && opts.x.length) {
        let bestIdx = 0;
        let bestDist = Math.abs(opts.x[0] - hoverX);
        for (let i = 1; i < opts.x.length; i += 1) {
          const d = Math.abs(opts.x[i] - hoverX);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        hoverY = opts.y[bestIdx];
      }

      if (Number.isFinite(hoverY)) {
        hoverY = Math.max(0, Math.min(yMax, hoverY));
        const hx = xToPx(hoverX);
        const hy = yToPx(hoverY);

        ctx.save();
        ctx.strokeStyle = opts.hoverLineColor || "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(hx, m.top + h);
        ctx.lineTo(hx, hy);
        ctx.lineTo(m.left, hy);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = opts.hoverPointColor || "#f8fafc";
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, 2 * Math.PI);
        ctx.fill();

        const xLabel = `Reads/cell: ${prettyNum(hoverX)}`;
        const yLabel = typeof opts.hoverYFormatter === "function"
          ? opts.hoverYFormatter(hoverY)
          : `Y ${prettyNum(hoverY, yMax <= 1.2 ? 2 : 0)}`;

        const xTag = drawTag(ctx, Math.min(hx + 6, m.left + w - 110), m.top + h - 24, xLabel, {
          border: "rgba(34, 211, 238, 0.4)",
          fg: "#e0f2fe",
        });
        const yTagX = Math.min(Math.max(m.left + 4, hx + 8), m.left + w - 120);
        const yTagY = Math.max(m.top + 2, hy - 26);
        drawTag(ctx, yTagX, yTagY, yLabel, {
          border: "rgba(250, 204, 21, 0.4)",
          fg: "#fef3c7",
        });
      }
    }
  }

  function render() {
    const lowerMeta = lowerMetricMeta(state.lowerMetricKind);
    els.sampleId.textContent = state.sampleId || "-";
    els.sourceType.textContent = state.sourceType || "-";
    els.currentCells.textContent = prettyNum(state.currentCells);
    els.currentReads.textContent = prettyNum(state.currentReads);
    els.currentUmis.textContent = prettyNum(state.currentUmis);
    els.currentSat.textContent =
      state.currentSat !== null ? `${prettyNum(state.currentSat * 100, 2)}%` : "-";

    els.satA.textContent = state.satFit ? prettyNum(state.satFit.a) : "-";
    els.umiA.textContent = state.umiFit ? prettyNum(state.umiFit.a) : "-";
    els.umiB.textContent = state.umiFit ? prettyNum(state.umiFit.b) : "-";
    if (els.lowerFitLabelA) {
      els.lowerFitLabelA.textContent = `${lowerMeta.plural} HalfSat Point (reads/cell)`;
    }
    if (els.lowerFitLabelB) {
      els.lowerFitLabelB.textContent = `${lowerMeta.plural} Max (fitted)`;
    }
    if (els.lowerPlotTitle) els.lowerPlotTitle.textContent = lowerMeta.panelTitle;
    if (els.metricTargetLabel) els.metricTargetLabel.textContent = `${lowerMeta.plural} per cell`;

    const notes = [];
    if (!state.satFit) notes.push("Sequencing saturation fit unavailable from current file.");
    if (!state.umiFit) notes.push(`${lowerMeta.singular} fit unavailable from current file.`);
    if (state.lowerMetricKind === "gene" && state.umiFit) {
      notes.push("Using genes-per-cell downsampling fallback from web summary.");
    }
    if (notes.length === 0) notes.push("Fits computed successfully.");
    els.fitNotes.textContent = notes.join(" ");

    const halfSatReads = state.satFit ? state.satFit.readsForTargetSat(0.5) : null;
    const halfSatLowerY =
      state.umiFit && Number.isFinite(halfSatReads) ? state.umiFit.predict(halfSatReads) : null;

    drawPlot(els.satCanvas, {
      x: state.satSeries?.x,
      y: state.satSeries?.y,
      fitFn: state.satFit?.predict,
      title: "Saturation Curve",
      xLabel: "Reads/Cell",
      yLabel: "Saturation",
      curveMaxY: 1,
      referenceY: 1,
      referenceLabelPrefix: "max",
      referenceDigits: 2,
      yBufferFactor: 1.08,
      referenceLineColor: "rgba(248, 250, 252, 0.45)",
      hoverX: state.satHoverX,
      xZoomScale: state.satXZoomScale,
      hoverLineColor: "rgba(244, 114, 182, 0.6)",
      hoverPointColor: "#fdf2f8",
      hoverYFormatter: (y) => `Sat: ${prettyNum(y * 100, 1)}%`,
      fixedCrosshairX: halfSatReads,
      fixedCrosshairY: 0.5,
      fixedCrosshairLabel: "HalfSat",
      fixedCrosshairLineColor: "rgba(34, 211, 238, 0.28)",
      fixedCrosshairPointColor: "rgba(34, 211, 238, 0.85)",
      pointColor: "#22d3ee",
      lineColor: "#f472b6",
    });

    const lowerRefY =
      state.umiFit?.b ||
      (state.umiSeries?.y && state.umiSeries.y.length ? Math.max(...state.umiSeries.y) : null);
    drawPlot(els.umiCanvas, {
      x: state.umiSeries?.x,
      y: state.umiSeries?.y,
      fitFn: state.umiFit?.predict,
      title: `${lowerMeta.singular} Curve`,
      xLabel: "Reads/Cell",
      yLabel: lowerMeta.perCell,
      curveMaxY: state.umiFit?.b || undefined,
      referenceY: lowerRefY,
      referenceLabelPrefix: "max",
      yBufferFactor: 1.08,
      referenceLineColor: "rgba(250, 204, 21, 0.55)",
      hoverX: state.umiHoverX,
      xZoomScale: state.umiXZoomScale,
      hoverLineColor: "rgba(250, 204, 21, 0.6)",
      hoverPointColor: "#fef3c7",
      hoverYFormatter: (y) =>
        `${state.lowerMetricKind === "gene" ? "genes/cell" : "UMIs/cell"}: ${prettyNum(y)}`,
      fixedCrosshairX: halfSatReads,
      fixedCrosshairY: halfSatLowerY,
      fixedCrosshairLabel: "HalfSat",
      fixedCrosshairLineColor: "rgba(250, 204, 21, 0.22)",
      fixedCrosshairPointColor: "rgba(250, 204, 21, 0.8)",
      pointColor: "#a78bfa",
      lineColor: "#facc15",
    });

    const satXMax = getPlotXMax(state.satSeries, { xZoomScale: state.satXZoomScale });
    const umiXMax = getPlotXMax(state.umiSeries, { xZoomScale: state.umiXZoomScale });
    if (els.satZoomLabel) {
      els.satZoomLabel.textContent = Number.isFinite(satXMax)
        ? `Range ${state.satXZoomScale.toFixed(1)}x (to ${prettyNum(satXMax)})`
        : `Range ${state.satXZoomScale.toFixed(1)}x`;
    }
    if (els.umiZoomLabel) {
      els.umiZoomLabel.textContent = Number.isFinite(umiXMax)
        ? `Range ${state.umiXZoomScale.toFixed(1)}x (to ${prettyNum(umiXMax)})`
        : `Range ${state.umiXZoomScale.toFixed(1)}x`;
    }
  }

  function setFromParsed(parsed) {
    state.sampleId = parsed.sampleId;
    state.sourceType = parsed.sourceType;
    state.currentCells = parsed.currentCells;
    state.currentReads = parsed.currentReads;
    state.currentUmis = parsed.currentUmis;
    state.currentSat = parsed.currentSat;
    state.lowerMetricKind = parsed.lowerMetricKind || "umi";
    state.satSeries = parsed.satSeries;
    state.umiSeries = parsed.umiSeries;
    state.satFit = fitSaturationCurve(parsed.satSeries);
    state.umiFit = fitUmiCurve(parsed.umiSeries);
    render();
  }

  function runPredictions() {
    const lowerMeta = lowerMetricMeta(state.lowerMetricKind);
    const readsTarget = toNumber(els.readsTarget.value);
    const umiTarget = toNumber(els.umiTarget.value);
    const satPctTarget = toNumber(els.satTarget.value);
    const out = [];

    const appendTotalReadInfo = (readsPerCell) => {
      if (!Number.isFinite(readsPerCell) || readsPerCell <= 0) return;
      if (!Number.isFinite(state.currentCells) || state.currentCells <= 0) {
        out.push("<p>Estimated cell count unavailable; total reads required cannot be calculated.</p>");
        return;
      }
      const totalReads = readsPerCell * state.currentCells;
      out.push(`<p>Estimated total reads required: <strong>${prettyNum(totalReads)}</strong></p>`);

      if (Number.isFinite(state.currentReads) && state.currentReads > 0) {
        const currentTotal = state.currentReads * state.currentCells;
        const delta = totalReads - currentTotal;
        if (delta > 0) {
          out.push(`<p>Additional reads needed: <strong>${prettyNum(delta)}</strong></p>`);
        } else {
          out.push(`<p>Additional reads needed: <strong>0</strong> (already at or above target)</p>`);
        }
      }
    };

    if (Number.isFinite(readsTarget) && readsTarget > 0) {
      out.push(`<h3>From ${prettyNum(readsTarget)} reads/cell</h3>`);
      if (state.umiFit) {
        const predU = state.umiFit.predict(readsTarget);
        out.push(`<p>Predicted ${lowerMeta.plural}/cell: <strong>${prettyNum(predU)}</strong></p>`);
      }
      if (state.satFit) {
        const predS = state.satFit.predict(readsTarget) * 100;
        out.push(`<p>Predicted saturation: <strong>${prettyNum(predS, 2)}%</strong></p>`);
      }
      appendTotalReadInfo(readsTarget);
    }

    if (Number.isFinite(umiTarget) && umiTarget > 0) {
      out.push(`<h3>For target ${prettyNum(umiTarget)} ${lowerMeta.plural}/cell</h3>`);
      if (!state.umiFit) {
        out.push(`<p>${lowerMeta.singular} model unavailable for current file.</p>`);
      } else if (umiTarget >= state.umiFit.b) {
        out.push(
          `<p>Target exceeds fitted ${lowerMeta.singular} max (${prettyNum(state.umiFit.b)}). Reads required are undefined.</p>`
        );
      } else {
        const r = state.umiFit.readsForTargetUmi(umiTarget);
        out.push(`<p>Required reads/cell: <strong>${prettyNum(r)}</strong></p>`);
        appendTotalReadInfo(r);
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
        appendTotalReadInfo(r);
      }
    }

    if (out.length === 0) {
      out.push("<p>Enter at least one target value and click Run Predictions.</p>");
    }
    els.results.innerHTML = out.join("");
  }

  function parseLoadedText(text, fileName) {
    if (fileName.toLowerCase().endsWith(".json")) {
      return fromMetricsSummary(JSON.parse(text));
    }
    if (fileName.toLowerCase().endsWith(".html") || fileName.toLowerCase().endsWith(".htm")) {
      return fromWebSummary(extractJsonFromWebSummary(text));
    }
    try {
      return fromMetricsSummary(JSON.parse(text));
    } catch (_jsonErr) {
      return fromWebSummary(extractJsonFromWebSummary(text));
    }
  }

  async function handleFile(file) {
    els.status.textContent = `Reading ${file.name}...`;
    try {
      const text = await file.text();
      const parsed = parseLoadedText(text, file.name);

      setFromParsed(parsed);
      els.status.textContent = `Loaded ${file.name}`;
      els.results.innerHTML = "";
    } catch (err) {
      els.status.textContent = "Unable to parse this file.";
      els.results.innerHTML = `<p>${String(err.message || err)}</p>`;
    }
  }

  async function handleExampleLoad(examplePath, label) {
    els.status.textContent = `Loading example ${label}...`;
    try {
      const resp = await fetch(examplePath, { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${label}`);
      const text = await resp.text();
      const parsed = parseLoadedText(text, label);
      setFromParsed(parsed);
      els.status.textContent = `Loaded example ${label}`;
      els.results.innerHTML = "";
    } catch (err) {
      els.status.textContent = "Unable to load example file.";
      els.results.innerHTML = `<p>${String(err.message || err)}</p>`;
    }
  }

  els.fileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleFile(file);
  });

  if (els.loadExampleWeb) {
    els.loadExampleWeb.addEventListener("click", () =>
      handleExampleLoad("./test_files/Cellranger_9.0.0_3p_GEX/web_summary.html", "web_summary.html")
    );
  }
  if (els.loadExampleMetrics) {
    els.loadExampleMetrics.addEventListener("click", () =>
      handleExampleLoad(
        "./test_files/Cellranger_9.0.0_3p_GEX/metrics_summary_json.json",
        "metrics_summary_json.json"
      )
    );
  }

  function attachHover(canvas, getSeries, stateKey, getXZoomScale) {
    canvas.addEventListener("mousemove", (e) => {
      const series = getSeries();
      if (!series || !series.x || series.x.length < 2) return;
      const rect = canvas.getBoundingClientRect();
      const xPx = e.clientX - rect.left;
      const width = canvas.clientWidth || rect.width;
      const m = PLOT_MARGINS;
      const w = width - m.left - m.right;
      if (w <= 0) return;
      if (xPx < m.left || xPx > m.left + w) {
        if (state[stateKey] !== null) {
          state[stateKey] = null;
          render();
        }
        return;
      }
      const xMax = getPlotXMax(series, { xZoomScale: getXZoomScale ? getXZoomScale() : 1 });
      if (!Number.isFinite(xMax) || xMax <= 0) return;
      const hoverX = ((xPx - m.left) / w) * xMax;
      state[stateKey] = hoverX;
      render();
    });
    canvas.addEventListener("mouseleave", () => {
      if (state[stateKey] !== null) {
        state[stateKey] = null;
        render();
      }
    });
  }

  function clampZoom(v) {
    return Math.min(12, Math.max(0.5, Math.round(v * 10) / 10));
  }

  function bindZoomControls(prefix, stateKey) {
    const btnOut = els[`${prefix}ZoomOut`];
    const btnIn = els[`${prefix}ZoomIn`];
    const btnReset = els[`${prefix}ZoomReset`];

    const setZoom = (next) => {
      state[stateKey] = clampZoom(next);
      render();
    };

    if (btnOut) btnOut.addEventListener("click", () => setZoom(state[stateKey] / 1.25));
    if (btnIn) btnIn.addEventListener("click", () => setZoom(state[stateKey] * 1.25));
    if (btnReset) btnReset.addEventListener("click", () => setZoom(1));
  }

  function bindWheelZoom(canvas, stateKey) {
    if (!canvas) return;
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const direction = e.deltaY < 0 ? 1 / 1.12 : 1.12;
        state[stateKey] = clampZoom(state[stateKey] * direction);
        render();
      },
      { passive: false }
    );
  }

  bindZoomControls("sat", "satXZoomScale");
  bindZoomControls("umi", "umiXZoomScale");
  bindWheelZoom(els.satCanvas, "satXZoomScale");
  bindWheelZoom(els.umiCanvas, "umiXZoomScale");

  attachHover(els.satCanvas, () => state.satSeries, "satHoverX", () => state.satXZoomScale);
  attachHover(els.umiCanvas, () => state.umiSeries, "umiHoverX", () => state.umiXZoomScale);

  els.runPredictions.addEventListener("click", runPredictions);
  window.addEventListener("resize", render);
  render();
})();
