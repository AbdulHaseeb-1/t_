import Feather from '@expo/vector-icons/Feather';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PressableCard } from '../../components/PressableCard';
import { PageHeader } from '../../components/SettingsUI';
import { row, scriptStyle, useI18n } from '../../i18n';
import { type InboxEntry, listInbox, markInboxRead } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { formatWhen } from '../../lib/format';
import { leave } from '../../lib/nav';
import { useReports } from '../../state/reports';
import { useSettings } from '../../state/settings';
import { fonts, type, usePalette } from '../../theme';

/** Scheduled reports as they arrive, newest first. */
export default function InboxScreen() {
  const p = usePalette();
  const { t, lang, rtl } = useI18n();
  const { server } = useSettings();
  const { refreshInbox } = useReports();
  const [reports, setReports] = useState<InboxEntry[]>();
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    listInbox(server).then(
      (r) => setReports(r.reports),
      (e) => setError(describeError(e, t, server.baseUrl)),
    );
  }, [server, t]);
  useFocusEffect(load);

  const readAll = async () => {
    await markInboxRead(server).catch(() => undefined);
    load();
    void refreshInbox();
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <PageHeader
          title={t.inbox}
          onBack={leave}
          back
          action={
            reports?.some((r) => !r.read) ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t.markAllRead} onPress={readAll} hitSlop={8} style={styles.action}>
                <Text style={[scriptStyle(t.markAllRead, type.label), { color: p.accent }]}>{t.markAllRead}</Text>
              </Pressable>
            ) : undefined
          }
        />
        {!!error && <Text style={[scriptStyle(error, type.meta), styles.pad, { color: p.danger }]}>{error}</Text>}
        {!reports && !error && <ActivityIndicator color={p.muted} style={styles.pad} />}
        {reports?.length === 0 && <Text style={[scriptStyle(t.noInbox, type.body), styles.pad, { color: p.muted, textAlign: rtl ? 'right' : 'left' }]}>{t.noInbox}</Text>}
        {reports?.map((r) => {
          const line = r.status === 'failed' ? `${t.reportFailed}: ${r.error ?? ''}` : (r.summary ?? t.rowsCount(r.rows)).replace(/\*\*/g, '');
          return (
            <PressableCard
              key={r.id}
              accessibilityRole="button"
              accessibilityLabel={`${r.read ? '' : '• '}${r.title}, ${formatWhen(r.createdAt, lang)}`}
              onPress={() => router.push(`/inbox/${r.id}`)}
              style={[styles.item, row(rtl)]}
            >
              <View style={[styles.dot, { backgroundColor: r.read ? 'transparent' : p.accent }]} />
              <View style={[styles.icon, { backgroundColor: r.status === 'failed' ? p.dangerSoft : p.sunken }]}>
                <Feather name={r.status === 'failed' ? 'alert-triangle' : 'bar-chart-2'} size={16} color={r.status === 'failed' ? p.danger : p.text} />
              </View>
              <View style={styles.flex}>
                <View style={[row(rtl), styles.titleRow]}>
                  <Text style={[scriptStyle(r.title, { ...type.label, fontFamily: r.read ? fonts.sans : fonts.sansSemibold }, r.read ? undefined : 'bold'), styles.flex, { color: p.text, textAlign: rtl ? 'right' : 'left' }]} numberOfLines={1}>
                    {r.title}
                  </Text>
                  <Text style={[type.meta, { color: p.faint }]}>{formatWhen(r.createdAt, lang)}</Text>
                </View>
                <Text style={[scriptStyle(line, type.meta), { color: r.status === 'failed' ? p.danger : p.muted, textAlign: rtl ? 'right' : 'left' }]} numberOfLines={2}>
                  {line}
                </Text>
              </View>
            </PressableCard>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, gap: 2 },
  body: { paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center', paddingHorizontal: 14, gap: 10 },
  action: { paddingHorizontal: 10, height: 34, justifyContent: 'center' },
  pad: { padding: 16 },
  item: { alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 18 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  titleRow: { alignItems: 'baseline', gap: 8 },
});
