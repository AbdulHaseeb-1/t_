import type { Flip, VariantSummary } from './metrics.js';
import type { CaseResult } from './runner.js';

export interface RunInfo {
  dataset: string;
  database: string;
  startedAt: string;
  durationS: number;
  repeats: number;
  cases: number;
  models: string[];
  withAnswers: boolean;
}

const p = (x: number) => `${(x * 100).toFixed(1)}%`;
const usd = (x: number) => `$${x < 0.01 ? x.toFixed(5) : x.toFixed(4)}`;
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown(
  info: RunInfo,
  summaries: VariantSummary[],
  flipList: Flip[],
  results: CaseResult[],
): string {
  const out: string[] = [];
  out.push(`# Evaluation: ${info.dataset}`, '');
  out.push(
    `${info.cases} cases × ${info.repeats} repeat(s) × ${summaries.length} variant(s) on \`${info.database}\` · ` +
      `models: ${info.models.join(', ') || 'n/a'} · ${info.startedAt} · ${info.durationS.toFixed(0)}s`,
    '',
  );
  out.push(
    'Accuracy is **execution accuracy**: the generated SQL must return the same rows as the gold query ' +
      '(column names/order and extra columns ignored; row order checked only for ordered questions).',
    '',
  );

  const infra = summaries.filter((s) => s.infraErrors > 0);
  if (infra.length) {
    out.push(
      `> **Warning:** ${infra.map((s) => `${s.variant}: ${s.infraErrors}`).join(', ')} run(s) failed on provider errors (rate limits/outages) after retries and are excluded from accuracy. Re-run with lower --concurrency for a complete measurement.`,
      '',
    );
  }
  out.push('## Summary', '');
  out.push(
    '| Variant | Accuracy | ± sd | First try | pass@k | pass^k | Stable | p50 | p95 | $/question | $/correct | LLM calls |',
  );
  out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const s of summaries) {
    out.push(
      `| **${s.variant}** | ${p(s.accuracy)} | ${(s.accuracyStdDev * 100).toFixed(1)} | ${p(s.firstTryAccuracy)} | ${p(s.passAtK)} | ${p(s.passAllK)} | ${p(s.stability)} | ${(s.latency.p50Ms / 1000).toFixed(1)}s | ${(s.latency.p95Ms / 1000).toFixed(1)}s | ${usd(s.cost.perQuestionUsd)} | ${usd(s.cost.perCorrectUsd)} | ${s.tokens.llmCalls} |`,
    );
  }
  out.push('');
  const overrides = summaries.filter((s) => Object.keys(s.overrides).length);
  if (overrides.length) {
    out.push('Variant settings:', '');
    for (const s of overrides) {
      out.push(
        `- **${s.variant}**: ${Object.entries(s.overrides)
          .map(([k, v]) => `\`${k}=${v}\``)
          .join(' ')}`,
      );
    }
    out.push('');
  }

  const table = (
    title: string,
    pick: (s: VariantSummary) => Record<string, { correct: number; total: number; accuracy: number }>,
  ) => {
    const keys = [...new Set(summaries.flatMap((s) => Object.keys(pick(s))))].sort();
    out.push(`## ${title}`, '');
    out.push(`| ${title.split(' ').at(-1)} | n | ${summaries.map((s) => s.variant).join(' | ')} |`);
    out.push(`|---|---:|${summaries.map(() => '---:').join('|')}|`);
    for (const k of keys) {
      const n = pick(summaries[0])[k]?.total ?? 0;
      out.push(
        `| ${k} | ${n / summaries[0].repeats} | ${summaries.map((s) => (pick(s)[k] ? p(pick(s)[k].accuracy) : '–')).join(' | ')} |`,
      );
    }
    out.push('');
  };
  table('Accuracy by difficulty', (s) => s.byDifficulty);
  table('Accuracy by tag', (s) => s.byTag);

  const cats = [...new Set(summaries.flatMap((s) => Object.keys(s.categories)))]
    .filter((c) => c !== 'correct')
    .sort();
  if (cats.length) {
    out.push('## Failure categories', '');
    out.push(`| Variant | ${cats.join(' | ')} |`);
    out.push(`|---|${cats.map(() => '---:').join('|')}|`);
    for (const s of summaries) {
      out.push(
        `| ${s.variant} | ${cats.map((c) => s.categories[c as keyof typeof s.categories] ?? 0).join(' | ')} |`,
      );
    }
    out.push('');
  }

  out.push('## Rescues (correct only because of a recovery step)', '');
  out.push(
    '| Variant | Repair loop | Empty-result recheck | Smart-tier escalation | Vote overruled a candidate |',
  );
  out.push('|---|---:|---:|---:|---:|');
  for (const s of summaries) {
    out.push(
      `| ${s.variant} | ${s.rescues.repair} | ${s.rescues.emptyRecheck} | ${s.rescues.escalation} | ${s.rescues.vote} |`,
    );
  }
  out.push('');

  if (flipList.length) {
    out.push(`## Changes vs \`${summaries[0].variant}\``, '');
    for (const f of flipList)
      out.push(
        `- ${f.change === 'fixed' ? '✅ fixed' : '❌ broken'} in **${f.to}**: \`${f.id}\` ${cell(f.question)}`,
      );
    out.push('');
  }

  const failures = results.filter((r) => r.verdict !== 'correct');
  if (failures.length) {
    out.push('## Failures', '');
    out.push('| Variant | Case | Category | Question | Detail |');
    out.push('|---|---|---|---|---|');
    for (const r of failures) {
      out.push(
        `| ${r.variant}${r.repeat ? ` #${r.repeat + 1}` : ''} | \`${r.id}\` | ${r.category} | ${cell(r.question)} | ${cell((r.detail ?? '').slice(0, 160))} |`,
      );
    }
    out.push('');
  }
  return out.join('\n');
}
