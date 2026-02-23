#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");

const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {
    fixture: path.join(repoRoot, "test_files/Cellranger_9.0.0_3p_GEX/web_summary.html"),
    expectLowerKind: "gene",
    headed: false,
    timeoutMs: 15000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--fixture" && argv[i + 1]) args.fixture = path.resolve(argv[++i]);
    else if (a === "--expect-lower-kind" && argv[i + 1]) args.expectLowerKind = argv[++i];
    else if (a === "--headed") args.headed = true;
    else if (a === "--timeout-ms" && argv[i + 1]) args.timeoutMs = Number(argv[++i]) || args.timeoutMs;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/smoke-test.js [options]

Options:
  --fixture <path>              web_summary.html to upload
  --expect-lower-kind <gene|umi>
  --headed                      Run browser in headed mode
  --timeout-ms <n>              Wait timeout (default: 15000)
`);
      process.exit(0);
    }
  }
  return args;
}

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (_e1) {
    try {
      return require(path.join(os.homedir(), "node_modules", "playwright"));
    } catch (_e2) {
      throw new Error(
        "Cannot load `playwright`. Install it with `npm install -D playwright` and run `npx playwright install`."
      );
    }
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html" || ext === ".htm") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function startStaticServer(root) {
  const server = http.createServer((req, res) => {
    const reqPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let rel = reqPath === "/" ? "/index.html" : reqPath;
    // Prevent path traversal.
    rel = path.posix.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
    const filePath = path.join(root, rel);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(err.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(err.code === "ENOENT" ? "Not found" : "Server error");
        return;
      }
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.fixture)) {
    throw new Error(`Fixture not found: ${args.fixture}`);
  }

  const { chromium } = loadPlaywright();
  const { server, baseUrl } = await startStaticServer(repoRoot);
  let browser;
  let page;

  try {
    browser = await chromium.launch({ headless: !args.headed });
    page = await browser.newPage();
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: args.timeoutMs });

    await page.setInputFiles("#fileInput", args.fixture);
    const fixtureName = path.basename(args.fixture);
    await page.waitForFunction(
      (name) => {
        const el = document.querySelector("#status");
        return !!el && el.textContent.includes(`Loaded ${name}`);
      },
      fixtureName,
      { timeout: args.timeoutMs }
    );

    const text = async (sel) => ((await page.textContent(sel)) || "").trim();
    const sourceType = await text("#sourceType");
    const sampleId = await text("#sampleId");
    const currentReads = await text("#currentReads");
    const currentSat = await text("#currentSat");
    const lowerPlotTitle = await text("#lowerPlotTitle");
    const metricTargetLabel = await text("#metricTargetLabel");
    const lowerFitLabelA = await text("#lowerFitLabelA");
    const fitNotes = await text("#fitNotes");

    assert(sourceType === "web_summary.html", `Unexpected sourceType: ${sourceType}`);
    assert(sampleId && sampleId !== "-", "Sample ID not populated");
    assert(currentReads && currentReads !== "-", "Current reads/cell not populated");
    assert(currentSat && currentSat.includes("%"), `Current saturation looks wrong: ${currentSat}`);

    if (args.expectLowerKind === "gene") {
      assert(lowerPlotTitle === "Genes vs Reads", `Expected gene fallback title, got: ${lowerPlotTitle}`);
      assert(metricTargetLabel === "Genes per cell", `Expected gene target label, got: ${metricTargetLabel}`);
      assert(lowerFitLabelA.includes("Gene half-saturation"), `Unexpected fit label: ${lowerFitLabelA}`);
      assert(
        fitNotes.toLowerCase().includes("genes-per-cell downsampling fallback"),
        `Gene fallback note missing: ${fitNotes}`
      );
    } else if (args.expectLowerKind === "umi") {
      assert(lowerPlotTitle === "UMIs vs Reads", `Expected UMI title, got: ${lowerPlotTitle}`);
      assert(metricTargetLabel === "UMIs per cell", `Expected UMI target label, got: ${metricTargetLabel}`);
    }

    await page.fill("#readsTarget", "40000");
    await page.click("#runPredictions");
    const results = await text("#results");
    if (args.expectLowerKind === "gene") {
      assert(results.includes("Predicted Genes/cell"), "Results missing gene prediction text");
    } else {
      assert(results.includes("Predicted UMIs/cell"), "Results missing UMI prediction text");
    }
    assert(results.includes("Predicted saturation"), "Results missing saturation prediction text");

    console.log("SMOKE TEST PASS");
    console.log(
      JSON.stringify(
        {
          fixture: path.relative(repoRoot, args.fixture),
          sampleId,
          sourceType,
          currentReads,
          currentSat,
          lowerPlotTitle,
          metricTargetLabel,
        },
        null,
        2
      )
    );
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error("SMOKE TEST FAIL");
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
