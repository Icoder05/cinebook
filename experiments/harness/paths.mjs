// Single source of truth for the research layout of the repository.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CONFIG = resolve(ROOT, 'experiments/configs/experiments.json');
export const RAW = resolve(ROOT, 'data/raw'); //               raw event logs (the dataset)
export const PROCESSED = resolve(ROOT, 'data/processed'); //   plot-ready CSVs
export const LOGS = resolve(ROOT, 'experiments/logs'); //      run manifests + LATEST pointer
export const RESULTS = resolve(ROOT, 'experiments/results'); // hypothesis tests, data quality
export const FIGURES = resolve(ROOT, 'figures');
export const REPORT_SRC = resolve(ROOT, 'docs/report-source');
export const REPORT_PDF = resolve(ROOT, 'docs/research-report.pdf');

export const ensure = (dir) => (mkdirSync(dir, { recursive: true }), dir);
