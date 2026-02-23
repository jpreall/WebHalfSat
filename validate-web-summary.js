#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const rootDir = process.argv[2] || "test_files";
const jsonMode = process.argv.includes("--json");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function extractJsonFromWebSummary(htmlText) {
  const marker = "const data";
  const markerIdx = htmlText.indexOf(marker);
  if (markerIdx < 0) throw new Error("Could not find `const data` marker");

  const firstBrace = htmlText.indexOf("{", markerIdx);
  if (firstBrace < 0) throw new Error("Could not locate JSON object start");

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = firstBrace; i < htmlText.length; i += 1) {
    const ch = htmlText[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) {
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
      if (depth === 0) return JSON.parse(htmlText.slice(firstBrace, i + 1));
    }
  }
  throw new Error("Failed to parse embedded JSON object");
}

function hasPlotSeries(plotWrapper) {
  const x = plotWrapper?.plot?.data?.[0]?.x;
  const y = plotWrapper?.plot?.data?.[0]?.y;
  return Array.isArray(x) && Array.isArray(y) && x.length >= 2 && x.length === y.length;
}

function pickLowerSeries(summary) {
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
    if (hasPlotSeries(analysis[c.key])) return { sourceKey: c.key, kind: c.kind, mode: "exact" };
  }

  const ranked = Object.entries(analysis)
    .map(([key, value]) => {
      if (!value || typeof value !== "object" || !value.plot || !hasPlotSeries(value)) return null;
      const lower = key.toLowerCase();
      if (lower.includes("sat")) return null;
      if (lower.includes("umi") || lower.includes("transcript") || lower.includes("count")) {
        return { key, kind: "umi", score: 3 };
      }
      if (lower.includes("gene")) {
        return { key, kind: "gene", score: 2 };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (ranked.length) return { sourceKey: ranked[0].key, kind: ranked[0].kind, mode: "heuristic" };
  return null;
}

function getPipelineVersion(summary) {
  const rows = summary?.summary_tab?.pipeline_info_table?.rows || [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    if (String(row[0]).toLowerCase().includes("pipeline version")) return String(row[1]);
  }
  return null;
}

function getSampleId(summary, data) {
  return summary?.sample?.id || data?.sample?.id || null;
}

function statusFor(record) {
  if (record.error) return "Fail";
  if (!record.hasSeqSaturationPlot) return "Fail";
  if (!record.lowerPlot) return "Partial";
  if (record.lowerPlot.kind === "umi") return "Pass";
  return "Partial";
}

function analyzeWebSummary(filePath) {
  const folder = path.dirname(filePath);
  const record = {
    file: filePath,
    folder,
    metricsSummaryPresent: fs.existsSync(path.join(folder, "metrics_summary.json")),
  };

  try {
    const text = fs.readFileSync(filePath, "utf8");
    const data = extractJsonFromWebSummary(text);
    const summary = data?.summary || null;
    const analysisKeys = Object.keys(summary?.analysis_tab || {});
    const lowerPlot = pickLowerSeries(summary);

    record.sampleId = getSampleId(summary, data);
    record.pipelineVersion = getPipelineVersion(summary);
    record.hasSeqSaturationPlot = hasPlotSeries(summary?.analysis_tab?.seq_saturation_plot);
    record.lowerPlot = lowerPlot;
    record.analysisKeys = analysisKeys;
    record.status = statusFor(record);
  } catch (err) {
    record.error = String(err && err.message ? err.message : err);
    record.status = "Fail";
  }

  return record;
}

function printMarkdown(records) {
  console.log("| Folder | Web Summary | Metrics JSON | Pipeline Version | Seq Sat Plot | Lower Plot Source | Status |");
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of records) {
    const folder = r.folder;
    const web = path.basename(r.file);
    const metrics = r.metricsSummaryPresent ? "Yes" : "No";
    const version = r.pipelineVersion || "-";
    const sat = r.error ? "Error" : r.hasSeqSaturationPlot ? "Yes" : "No";
    const lower = r.error
      ? `Error: ${r.error}`
      : r.lowerPlot
        ? `${r.lowerPlot.sourceKey} (${r.lowerPlot.kind})`
        : "None";
    console.log(`| \`${folder}\` | ${web} | ${metrics} | ${version} | ${sat} | ${lower} | ${r.status} |`);
  }

  console.log("");
  console.log("Status heuristic: `Pass` = seq saturation plot + UMI/transcript lower plot, `Partial` = loadable but fallback/missing lower plot, `Fail` = parse error or missing seq saturation plot.");
}

function main() {
  if (!fs.existsSync(rootDir)) {
    console.error(`Directory not found: ${rootDir}`);
    process.exit(1);
  }

  const webSummaries = walk(rootDir).filter((p) => path.basename(p).toLowerCase() === "web_summary.html");
  if (webSummaries.length === 0) {
    console.error(`No web_summary.html files found under ${rootDir}`);
    process.exit(1);
  }

  const records = webSummaries.sort().map(analyzeWebSummary);
  if (jsonMode) {
    console.log(JSON.stringify(records, null, 2));
  } else {
    printMarkdown(records);
  }
}

main();
