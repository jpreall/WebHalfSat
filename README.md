# HalfSat Explorer

HalfSat Explorer is a static browser app for exploring sequencing depth tradeoffs from 10x outputs.

It loads a local `web_summary.html` or `metrics_summary.json`, fits simple saturation/UMI curves, and predicts:
- Saturation and UMIs at a target reads-per-cell
- Required reads-per-cell for a target UMIs-per-cell
- Required reads-per-cell for a target saturation

No backend is required. Data stays local in your browser.

## Features

- File upload UI for local 10x summary files
- Automatic parsing of:
  - `metrics_summary.json`
  - `web_summary.html` / `.htm` (extracts embedded `const data` payload)
- Two fitted models:
  - Sequencing saturation: Michaelis-Menten style one-parameter fit
  - UMIs per cell: two-parameter saturating fit
- Interactive prediction panel for forward and inverse calculations
- Canvas plots for raw points plus fitted curves

## Supported Inputs

### `metrics_summary.json`
The app reads fields such as:
- `sample_id`
- `reads_per_cell`
- per-depth subsampling keys (for example `raw_rpc_<N>_subsampled_...`)
- saturation-like metrics (`sequencing_saturation`, `duplication_frac`, `percent_duplicates`)
- median UMI/count metrics (`filtered_bcs_median_counts`, subsampled variants)

### `web_summary.html`
The app extracts the JSON object assigned to `const data`, then reads:
- sample ID
- sequencing summary table values
- analysis tab saturation plot points
- cell summary table values

For the lower-right depth-response plot, the app prefers UMI/transcript downsampling data when available. If a `web_summary.html` only provides gene-level downsampling (common in some Cell Ranger web summaries), it automatically falls back to genes-per-cell/median-gene downsampling.

## Compatibility Matrix

This table tracks examples in `test_files/` that have been manually checked against the parser.

| Cell Ranger Version | Assay / Example Folder | `metrics_summary.json` | `web_summary.html` | Lower-right plot source | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 9.0.0 | `test_files/Cellranger_9.0.0_3p_GEX` | Not yet added | Yes | `median_gene_plot` fallback (genes) | Partial | Saturation + gene fallback confirmed from web summary; add matching `metrics_summary.json` example next. |
| TBD | `test_files/...` | TBD | TBD | TBD | Planned | Add legacy versions (e.g. v7, v6, v5, v4, v3) as examples are collected. |

### Matrix Status Definitions

- `Pass`: parsing + plotting + predictions work with expected metric source(s)
- `Partial`: file loads, but one or more fitted series depend on fallback or are missing
- `Fail`: parse error or unusable output
- `Planned`: test fixture not added yet

## Modeling

### Saturation model
The fitted curve is:

$$
s(R) = \frac{R}{R + a}
$$

where:
- $R$ = reads per cell
- $s$ = sequencing saturation in $[0,1]$
- $a$ = fitted half-saturation parameter

Inverse form used for predictions:

$$
R = \frac{a s}{1-s}
$$

### UMI model
The fitted curve is:

$$
U(R) = \frac{bR}{R+a}
$$

where:
- $U$ = UMIs per cell
- $a$ = half-saturation-style parameter
- $b$ = fitted maximum UMI asymptote

Inverse form used for predictions:

$$
R = \frac{aU}{b-U}
$$

## Run Locally

Because browsers restrict local file/module behavior, serve the folder with a simple static server.

### Option 1: Python
```bash
python3 -m http.server 8000
```
Open `http://localhost:8000`.

### Option 2: Node
```bash
npx serve .
```
Open the URL printed in your terminal.

## Project Structure

- `index.html`: page layout and controls
- `styles.css`: visual design and responsive layout
- `app.js`: parsing, fitting, rendering, and predictions

## How To Use

1. Open the app in your browser.
2. Click **Choose local file** and select a 10x summary file.
3. Confirm sample info and fit parameters appear.
4. Enter one or more targets in **Interactive Targets**.
5. Click **Run Predictions**.

## Notes and Limitations

- Fits require enough subsampled points; sparse files may show unavailable models.
- Saturation targets must be below 100%.
- UMI inverse prediction is undefined at or above fitted max $b$.
- This is a lightweight heuristic fit for planning/exploration, not a replacement for full pipeline QC analysis.

## License

Add your preferred license in this repository (for example MIT).
