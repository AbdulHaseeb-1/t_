import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Chart } from '../../components/Chart';
import { DataPanel } from '../../components/DataPanel';
import { Markdown } from '../../components/Markdown';
import { PageHeader } from '../../components/SettingsUI';
import { row, scriptStyle, useI18n } from '../../i18n';
import { getInboxReport, type InboxReport, markInboxRead } from '../../lib/api';
import { inferChart } from '../../lib/chart';
import { describeError } from '../../lib/errors';
import { formatWhen } from '../../lib/format';
import { leave } from '../../lib/nav';
import { useChatActions } from '../../state/chats';
import { useReports } from '../../state/reports';
import { useSettings } from '../../state/settings';
import { type, usePalette } from '../../theme';

/** One delivered report: summary, chart, data, where it was sent. Opening it marks it read. */
export default function InboxReportScreen() {
  const p = usePalette();
  const { t, lang, rtl } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { server, showSql } = useSettings();
  const { refreshInbox } = useReports();
  const actions = useChatActions();
  const [report, setReport] = useState<InboxReport>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    getInboxReport(server, id).then(
      (r) => {
        if (!live) return;
        setReport(r);
        if (!r.read) void markInboxRead(server, id).then(refreshInbox, () => undefined);
      },
      (e) => live && setError(describeError(e, t, server.baseUrl)),
    );
    return () => {
      live = false;
    };
  }, [id, server, t, refreshInbox]);

  const res = report?.response;
  const chart = useMemo(() => (res?.result ? inferChart(res.result, res.question, lang) : null), [res, lang]);
  const again = () => {
    const tpl = res?.template;
    if (!tpl) return;
    actions.newChat();
    actions.runReport(tpl.id, tpl.params, `📊 ${report!.title}`);
    router.dismissTo('/');
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <PageHeader title={report?.title ?? t.inbox} onBack={leave} back />
        {!!error && <Text style={[scriptStyle(error, type.meta), { color: p.danger }]}>{error}</Text>}
        {!report && !error && <ActivityIndicator color={p.muted} />}
        {report && (
          <View style={styles.content}>
            <Text style={[type.meta, { color: p.muted, textAlign: rtl ? 'right' : 'left' }]}>
              {[formatWhen(report.createdAt, lang), res?.template?.period, t.rowsCount(report.rows)].filter(Boolean).join(' · ')}
            </Text>
            {report.status === 'failed' && (
              <Text style={[scriptStyle(report.error ?? '', type.body), styles.failed, { color: p.danger, backgroundColor: p.dangerSoft }]}>{`${t.reportFailed}: ${report.error ?? ''}`}</Text>
            )}
            {!!res?.answer && <Markdown text={res.answer} />}
            {chart && <Chart spec={chart} />}
            {res?.result && res.sql && <DataPanel sql={showSql ? res.sql : undefined} result={res.result} />}
            {report.deliveries.some((d) => d.channel === 'whatsapp') && (
              <View style={styles.deliveries}>
                {report.deliveries
                  .filter((d) => d.channel === 'whatsapp')
                  .map((d) => (
                    <View key={d.to} style={[row(rtl), styles.delivery]}>
                      <Feather name={d.status === 'sent' ? 'check' : 'x'} size={14} color={d.status === 'sent' ? p.muted : p.danger} />
                      <Text style={[scriptStyle(t.sentTo(d.to ?? ''), type.meta), { color: d.status === 'sent' ? p.muted : p.danger, flexShrink: 1 }]}>
                        {t.sentTo(d.to ?? '')}
                        {d.error ? ` — ${d.error}` : ''}
                      </Text>
                    </View>
                  ))}
              </View>
            )}
            {res?.template && (
              <Pressable accessibilityRole="button" accessibilityLabel={t.runReport} onPress={again} style={({ pressed }) => [styles.again, row(rtl), { borderColor: p.border }, pressed && { backgroundColor: p.sunken }]}>
                <Feather name="refresh-cw" size={15} color={p.text} />
                <Text style={[scriptStyle(t.runReport, type.label), { color: p.text }]}>{t.runReport}</Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center', paddingHorizontal: 12 },
  content: { gap: 14, paddingHorizontal: 8 },
  failed: { borderRadius: 12, padding: 12 },
  deliveries: { gap: 4 },
  delivery: { alignItems: 'center', gap: 6 },
  again: { alignSelf: 'flex-start', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 14, height: 36 },
});
