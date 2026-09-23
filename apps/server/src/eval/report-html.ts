import { readFile } from 'node:fs/promises';
import type { Flip, VariantSummary } from './metrics.js';
import type { RunInfo } from './report-markdown.js';
import type { CaseResult } from './runner.js';

/** Self-contained interactive report: one HTML file, data embedded, no build step. */
export async function renderHtml(
  info: RunInfo,
  summaries: VariantSummary[],
  flipList: Flip[],
  results: CaseResult[],
): Promise<string> {
  const template = await readFile(new URL('./report-template.html', import.meta.url), 'utf8');
  const name = info.dataset.charAt(0).toUpperCase() + info.dataset.slice(1);
  const title = `${name} accuracy scorecard`;
  // `<` escaped so embedded SQL/text can never close the script element.
  const data = JSON.stringify({ info: { ...info, title }, summaries, flips: flipList, results }).replace(
    /</g,
    '\\u003c',
  );
  return template.replace('__TITLE__', title).replace('__DATA__', () => data);
}
