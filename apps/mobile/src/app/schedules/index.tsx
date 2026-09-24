import Feather from '@expo/vector-icons/Feather';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageHeader } from '../../components/SettingsUI';
import { row, scriptStyle, useI18n } from '../../i18n';
import { listSchedules, type Schedule, saveSchedule } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { formatWhen } from '../../lib/format';
import { leave } from '../../lib/nav';
import { describeFrequency } from '../../lib/reports';
import { useSettings } from '../../state/settings';
import { fonts, type, usePalette } from '../../theme';

/** Everything scheduled, with a quick on/off switch; tap to edit. */
export default function SchedulesScreen() {
  const p = usePalette();
  const { t, lang, rtl } = useI18n();
  const { server } = useSettings();
  const [schedules, setSchedules] = useState<Schedule[]>();
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    listSchedules(server).then(
      (r) => {
        setSchedules(r.schedules);
        setError(undefined);
      },
      (e) => setError(describeError(e, t, server.baseUrl)),
    );
  }, [server, t]);
  useFocusEffect(load);

  const toggle = async (s: Schedule, enabled: boolean) => {
    setSchedules((list) => list?.map((x) => (x.id === s.id ? { ...x, enabled } : x)));
    const { id, timezone: _tz, description: _d, nextRunAt: _n, lastRunAt: _l, lastStatus: _s, lastError: _e, lastReportId: _r, ...input } = s;
    try {
      await saveSchedule(server, { ...input, enabled }, id);
      load();
    } catch (e) {
      setError(describeError(e, t, server.baseUrl));
      load();
    }
  };

  const status = (s: Schedule) =>
    s.lastStatus && s.lastRunAt
      ? t.lastRun({ ok: t.statusOk, skipped: t.statusSkipped, failed: t.statusFailed, missed: t.statusMissed }[s.lastStatus], formatWhen(s.lastRunAt, lang))
      : undefined;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <PageHeader
          title={t.schedules}
          onBack={leave}
          back
          action={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.newSchedule}
              onPress={() => router.push('/schedules/edit')}
              style={({ pressed }) => [styles.add, row(rtl), { backgroundColor: p.primary }, pressed && { opacity: 0.85 }]}
            >
              <Feather name="plus" size={16} color={p.onPrimary} />
              <Text style={[scriptStyle(t.newSchedule, { ...type.label, fontFamily: fonts.sansSemibold }, 'bold'), { color: p.onPrimary }]}>{t.newSchedule}</Text>
            </Pressable>
          }
        />
        {!!error && <Text style={[scriptStyle(error, type.meta), styles.pad, { color: p.danger }]}>{error}</Text>}
        {!schedules && !error && <ActivityIndicator color={p.muted} style={styles.pad} />}
        {schedules?.length === 0 && (
          <Text style={[scriptStyle(t.noSchedules, type.body), styles.pad, { color: p.muted, textAlign: rtl ? 'right' : 'left' }]}>{t.noSchedules}</Text>
        )}
        {schedules?.map((s) => (
          <Pressable
            key={s.id}
            accessibilityRole="button"
            accessibilityLabel={`${s.name}, ${describeFrequency(s.frequency, t, lang)}`}
            onPress={() => router.push({ pathname: '/schedules/edit', params: { id: s.id } })}
            style={({ pressed }) => [styles.card, { backgroundColor: p.surface, borderColor: p.border }, pressed && { backgroundColor: p.sunken }]}
          >
            <View style={[row(rtl), styles.cardTop]}>
              <View style={styles.flex}>
                <Text style={[scriptStyle(s.name, { ...type.label, fontFamily: fonts.sansSemibold }, 'bold'), { color: p.text, textAlign: rtl ? 'right' : 'left' }]} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={[scriptStyle(describeFrequency(s.frequency, t, lang), type.meta), { color: p.muted, textAlign: rtl ? 'right' : 'left' }]}>{describeFrequency(s.frequency, t, lang)}</Text>
              </View>
              <Switch value={s.enabled} onValueChange={(v) => void toggle(s, v)} accessibilityLabel={`${t.enabled}: ${s.name}`} trackColor={{ true: p.accent, false: p.border }} thumbColor={p.surface} {...({ activeThumbColor: p.surface } as object)} />
            </View>
            <View style={[row(rtl), styles.meta]}>
              {s.deliver.app && <Feather name="smartphone" size={13} color={p.muted} />}
              {s.deliver.whatsapp.length > 0 && <Feather name="message-circle" size={13} color={p.muted} />}
              {s.enabled && s.nextRunAt && <Text style={[scriptStyle(t.nextRun(''), type.meta), { color: p.muted }]}>{t.nextRun(formatWhen(s.nextRunAt, lang))}</Text>}
            </View>
            {!!status(s) && (
              <Text style={[scriptStyle(status(s)!, type.meta), { color: s.lastStatus === 'failed' ? p.danger : p.faint, textAlign: rtl ? 'right' : 'left' }]} numberOfLines={2}>
                {status(s)}
                {s.lastStatus === 'failed' && s.lastError ? ` — ${s.lastError}` : ''}
              </Text>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, gap: 2 },
  body: { paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center', paddingHorizontal: 12, gap: 10 },
  add: { alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 34, borderRadius: 17, marginHorizontal: 4 },
  pad: { padding: 16 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  cardTop: { alignItems: 'center', gap: 12 },
  meta: { alignItems: 'center', gap: 8 },
});
