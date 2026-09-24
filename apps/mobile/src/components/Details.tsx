import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { row, scriptStyle, useI18n } from '../i18n';
import { formatCost, formatMs, formatTokens } from '../lib/format';
import type { AnswerDetails, usageTotals } from '../state/chat-reducer';
import { type, useChartPalette, usePalette } from '../theme';
import { Group, Sheet, Stat } from './Sheet';

/** 0.4% reads as "<1%", not a misleading 0%. */
function sharePct(part: number, sum: number): string {
  const v = (part / sum) * 100;
  return v > 0 && v < 1 ? '<1%' : `${Math.round(v)}%`;
}

/** Where the time went: model vs database vs voice/photo, as one stacked bar with a legend. */
export function TimeSplit({ totalMs, modelMs, dbMs, mediaMs = 0 }: { totalMs: number; modelMs: number; dbMs: number; mediaMs?: number }) {
  const p = usePalette();
  const c = useChartPalette();
  const { t, lang, rtl } = useI18n();
  // Media time is counted inside model time on the server; show it separately.
  const model = Math.max(0, modelMs - mediaMs);
  const other = Math.max(0, totalMs - model - dbMs - mediaMs);
  const parts = [
    { key: 'model', label: t.modelTime, ms: model, color: c.series[0] },
    { key: 'db', label: t.dbTime, ms: dbMs, color: c.series[1] },
    { key: 'media', label: t.mediaTime, ms: mediaMs, color: c.series[2] },
    { key: 'other', label: t.otherTime, ms: other, color: c.context },
  ].filter((x) => x.ms > 0);
  const sum = parts.reduce((s, x) => s + x.ms, 0) || 1;
  return (
    <View style={styles.split} testID="time-split">
      <View style={[styles.track, row(rtl)]}>
        {parts.map((x, i) => (
          <View key={x.key} style={{ flex: x.ms / sum, backgroundColor: x.color, marginEnd: i < parts.length - 1 ? 2 : 0, borderRadius: 3 }} />
        ))}
      </View>
      {parts.map((x) => (
        <View key={x.key} style={[styles.splitRow, row(rtl)]}>
          <View style={[styles.swatch, { backgroundColor: x.color }]} />
          <Text style={[scriptStyle(x.label, type.body), styles.flex, { color: p.text }]}>{x.label}</Text>
          <Text style={[type.body, { color: p.text, fontVariant: ['tabular-nums'] }]}>{formatMs(x.ms, lang)}</Text>
          <Text style={[type.meta, styles.pct, { color: p.muted }]}>{sharePct(x.ms, sum)}</Text>
        </View>
      ))}
    </View>
  );
}

export const AnswerDetailsSheet = memo(function AnswerDetailsSheet({ details, visible, onClose }: { details?: AnswerDetails; visible: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  if (!details) return null;
  const d = details;
  const cacheText = d.cache === 'answer' ? t.cacheAnswer : d.cache === 'sql' ? t.cacheSql : t.cacheNone;
  const tok = d.tokens;
  return (
    <Sheet visible={visible} title={t.answerDetails} onClose={onClose} testID="answer-details">
      <Group title={`${t.time} · ${formatMs(d.timings.totalMs, lang)}`}>
        <TimeSplit totalMs={d.timings.totalMs} modelMs={d.timings.llmMs} dbMs={d.timings.dbMs} mediaMs={d.timings.mediaMs} />
      </Group>

      <Group title={t.tokens}>
        <Stat label={t.inputTokens} value={formatTokens(tok.prompt)} sub={tok.cached ? t.cachedTokens(formatTokens(tok.cached)) : undefined} />
        <Stat label={t.outputTokens} value={formatTokens(tok.completion)} />
        <Stat label={t.cost} value={formatCost(d.costUsd)} last />
      </Group>

      <Group title={t.cache} footer={t.attempts(d.attempts)}>
        <Stat label={cacheText} value="" last />
      </Group>

      {(d.schema || d.context) && (
        <Group title={t.context}>
          {d.schema?.tableCount !== undefined && (
            <Stat
              label={d.schema.full ? t.schemaFull(d.schema.tableCount, formatTokens(d.schema.approxTokens ?? 0)) : t.schemaRetrieved(d.schema.tableCount, formatTokens(d.schema.approxTokens ?? 0))}
              value=""
            />
          )}
          {d.context && <Stat label={t.turnsSent(d.context.turns)} value="" />}
          {d.context && <Stat label={d.context.engine === 'duckdb' ? t.engineDuckdb : t.engineMssql} value="" last={!d.speech} />}
          {d.speech && <Stat label={t.heardBy(d.speech.model)} value="" last />}
        </Group>
      )}

      {d.calls.length > 0 && (
        <Group title={t.modelCalls}>
          {d.calls.map((call, i) => (
            <Stat
              key={i}
              label={t.purpose[call.purpose] ?? call.purpose}
              value={formatMs(call.latencyMs, lang)}
              sub={`${call.model.replace(/^[a-z]+:/, '')} · ${formatTokens(call.promptTokens + call.completionTokens)} ${t.tokens}`}
              last={i === d.calls.length - 1}
            />
          ))}
        </Group>
      )}
    </Sheet>
  );
});

export const UsageSheet = memo(function UsageSheet({ totals, visible, onClose }: { totals: ReturnType<typeof usageTotals>; visible: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const u = totals;
  return (
    <Sheet visible={visible} title={t.conversationUsage} onClose={onClose} testID="usage-sheet">
      <Group title={t.tokens}>
        <Stat label={t.inputTokens} value={formatTokens(u.prompt)} sub={u.cached ? t.cachedTokens(formatTokens(u.cached)) : undefined} />
        <Stat label={t.outputTokens} value={formatTokens(u.completion)} />
        <Stat label={t.cost} value={formatCost(u.costUsd)} sub={t.questionsCount(u.answers)} last />
      </Group>
      {u.answers > 0 && (
        <Group title={`${t.time} · ${t.averageTime} ${formatMs(u.totalMs / u.answers, lang)}`}>
          <TimeSplit totalMs={u.totalMs} modelMs={u.modelMs} dbMs={u.dbMs} />
        </Group>
      )}
    </Sheet>
  );
});

const styles = StyleSheet.create({
  split: { padding: 14, gap: 10 },
  track: { height: 10, borderRadius: 3, overflow: 'hidden' },
  splitRow: { alignItems: 'center', gap: 10 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  flex: { flex: 1 },
  pct: { minWidth: 36, textAlign: 'right' },
});
