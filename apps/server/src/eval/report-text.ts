import type { Flip, Rate, VariantSummary } from './metrics.js';
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
  /** Database engine the run used (older reports: unset = mssql). */
  engine?: 'mssql' | 'duckdb';
  /** Where the run was started from. */
  source?: 'cli' | 'web';
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const usd = (x: number) => x.toFixed(6);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Left-aligned first column, right-aligned numbers, two-space gutters. */
function table(header: string[], rows: string[][]): string[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const fmt = (r: string[]) =>
    r
      .map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i])))
      .join('  ')
      .trimEnd();
  return [fmt(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(fmt)];
}

function rateTable(
  title: string,
  summaries: VariantSummary[],
  pick: (s: VariantSummary) => Record<string, Rate>,
  order?: string[],
) {
  const keys = order ?? [...new Set(summaries.flatMap((s) => Object.keys(pick(s))))].sort();
  const reps = summaries[0].repeats;
  return [
    title,
    ...table(
      ['', 'n', ...summaries.map((s) => s.variant)],
      keys.map((k) => [
        k,
        String((pick(summaries[0])[k]?.total ?? 0) / reps),
        ...summaries.map((s) => (pick(s)[k] ? `${Math.round(pick(s)[k].accuracy * 100)}%` : '-')),
      ]),
    ),
  ];
}

/**
 * Plain-text report: readable in a terminal, a chat message or a log, with no
 * tooling. Everything a decision needs, nothing decorative.
 */
export function renderText(
  info: RunInfo,
  summaries: VariantSummary[],
  flipList: Flip[],
  results: CaseResult[],
): string {
  const out: string[] = [];
  const when = new Date(info.startedAt).toISOString().slice(0, 16).replace('T', ' ');
  out.push(`EVALUATION: ${info.dataset} (${info.database})`);
  out.push(
    `${info.cases} questions x ${info.repeats} repeat(s) x ${summaries.length} variant(s) | ${info.models.join(', ') || 'no model'} | ${when} UTC | ${Math.round(info.durationS)}s`,
  );
  out.push(
    'Accuracy = execution accuracy: the generated SQL must return the same rows as the verified gold query.',
  );

  const infra = summaries.filter((s) => s.infraErrors > 0);
  if (infra.length) {
    out.push(
      '',
      `WARNING: ${infra.map((s) => `${s.variant} ${s.infraErrors}`).join(', ')} run(s) failed on provider errors (rate limits/outages) and are excluded. Re-run with lower --concurrency.`,
    );
  }

  out.push('', 'SUMMARY');
  out.push(
    ...table(
      [
        'variant',
        'accuracy',
        '± sd',
        'first try',
        'pass^k',
        'stable',
        'p50',
        'p95',
        '$/question',
        '$/correct',
        'calls',
      ],
      summaries.map((s) => [
        s.variant,
        pct(s.accuracy),
        (s.accuracyStdDev * 100).toFixed(1),
        pct(s.firstTryAccuracy),
        pct(s.passAllK),
        pct(s.stability),
        secs(s.latency.p50Ms),
        secs(s.latency.p95Ms),
        usd(s.cost.perQuestionUsd),
        usd(s.cost.perCorrectUsd),
        String(s.tokens.llmCalls),
      ]),
    ),
  );
  if (summaries.some((s) => s.answerLanguage)) {
    out.push('', 'ANSWER LANGUAGE (answers written in the expected language)');
    out.push(
      ...table(
        ['variant', 'correct language'],
        summaries
          .filter((s) => s.answerLanguage)
          .map((s) => [
            s.variant,
            `${pct(s.answerLanguage!.accuracy)} (${s.answerLanguage!.correct}/${s.answerLanguage!.total})`,
          ]),
      ),
    );
  }

  const withSettings = summaries.filter((s) => Object.keys(s.overrides).length);
  if (withSettings.length) {
    out.push('', 'SETTINGS');
    for (const s of withSettings)
      out.push(
        `  ${s.variant}: ${Object.entries(s.overrides)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`,
      );
  }

  out.push('', ...rateTable('BY DIFFICULTY', summaries, (s) => s.byDifficulty, ['easy', 'medium', 'hard']));
  const best = summaries.reduce((a, b) => (b.accuracy > a.accuracy ? b : a), summaries[0]);
  const tagOrder = Object.keys(best.byTag).sort(
    (a, b) => best.byTag[a].accuracy - best.byTag[b].accuracy || a.localeCompare(b),
  );
  out.push(
    '',
    ...rateTable(`BY CAPABILITY (weakest first for ${best.variant})`, summaries, (s) => s.byTag, tagOrder),
  );

  const cats = [...new Set(summaries.flatMap((s) => Object.keys(s.categories)))]
    .filter((c) => c !== 'correct')
    .sort();
  if (cats.length) {
    out.push('', 'FAILURE CAUSES (runs)');
    out.push(
      ...table(
        ['', ...summaries.map((s) => s.variant)],
        cats.map((c) => [
          c,
          ...summaries.map((s) => String(s.categories[c as keyof typeof s.categories] ?? 0)),
        ]),
      ),
    );
  }

  out.push('', 'RESCUES (correct only because of a recovery step)');
  out.push(
    ...table(
      ['variant', 'repair', 'empty recheck', 'escalation', 'vote'],
      summaries.map((s) => [
        s.variant,
        String(s.rescues.repair),
        String(s.rescues.emptyRecheck),
        String(s.rescues.escalation),
        String(s.rescues.vote),
      ]),
    ),
  );

  if (flipList.length) {
    out.push('', `CHANGES VS ${summaries[0].variant}`);
    for (const f of flipList)
      out.push(`  ${f.change.padEnd(6)}  ${f.to}  ${f.id}  ${oneLine(f.question, 90)}`);
  }

  const failures = results.filter((r) => r.verdict !== 'correct');
  out.push('', failures.length ? `FAILURES (${failures.length})` : 'FAILURES: none');
  for (const r of failures) {
    out.push(
      `  ${r.variant}  ${r.id}${r.repeat ? ` #${r.repeat + 1}` : ''}  ${r.category}${r.detail ? `: ${oneLine(r.detail, 100)}` : ''}`,
    );
    out.push(`    Q    ${oneLine(r.question, 110)}`);
    if (r.sql) out.push(`    SQL  ${oneLine(r.sql, 160)}`);
  }
  return `${out.join('\n')}\n`;
}
