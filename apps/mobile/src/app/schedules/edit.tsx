import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Chip, ParamFields } from '../../components/ReportParts';
import { PageHeader, Section } from '../../components/SettingsUI';
import { row, scriptStyle, useI18n } from '../../i18n';
import { deleteSchedule, type Frequency, listSchedules, type ParamValues, runSchedule, type ScheduleInput, saveSchedule } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { leave } from '../../lib/nav';
import { ensureNotificationPermission } from '../../lib/notifications';
import { defaultParams, templateTitle } from '../../lib/reports';
import { useReports } from '../../state/reports';
import { useSettings } from '../../state/settings';
import { card, layout, type, usePalette, weight } from '../../theme';

type Kind = 'daily' | 'weekly' | 'monthly';
const TIMES = ['08:00', '09:00', '13:00', '18:00', '21:00'];
const MONTH_DAYS: (number | 'last')[] = [1, 5, 10, 15, 20, 25, 'last'];

/**
 * Create or edit a schedule: which report (or question), when, where to send
 * it, and whether to stay quiet when there is nothing to report.
 */
export default function ScheduleEditor() {
  const p = usePalette();
  const { t, lang, rtl } = useI18n();
  const { server, replyLanguage } = useSettings();
  const { templates, today, refreshInbox } = useReports();
  const params = useLocalSearchParams<{ id?: string; template?: string; params?: string; question?: string }>();
  const editing = params.id;

  const [loaded, setLoaded] = useState(!editing);
  const [whatsappReady, setWhatsappReady] = useState(true);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'report' | 'question'>(params.question ? 'question' : 'report');
  const [templateId, setTemplateId] = useState(params.template ?? '');
  const [values, setValues] = useState<ParamValues>(() => {
    try {
      return params.params ? (JSON.parse(params.params) as ParamValues) : {};
    } catch {
      return {};
    }
  });
  const [question, setQuestion] = useState(params.question ?? '');
  const [kind, setKind] = useState<Kind>('daily');
  const [time, setTime] = useState('09:00');
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [monthDay, setMonthDay] = useState<number | 'last'>(1);
  // Unset until chosen: follows the reply language (or the app language), which may still be loading.
  const [pickedLanguage, setLanguage] = useState<ScheduleInput['language']>();
  const language = pickedLanguage ?? (replyLanguage === 'auto' ? lang : replyLanguage);
  const [customTime, setCustomTime] = useState(false);
  const [app, setApp] = useState(true);
  const [phones, setPhones] = useState('');
  const [onlyIfRows, setOnlyIfRows] = useState<boolean | undefined>(undefined);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string }>();

  const template = templates.find((x) => x.id === templateId);
  // A new schedule for a report is named after it until the user types a name.
  const shownName = name || (template && !editing ? templateTitle(template, lang) : '');

  useEffect(() => {
    let live = true;
    listSchedules(server).then(
      (r) => {
        if (!live) return;
        setWhatsappReady(r.whatsapp);
        const s = editing ? r.schedules.find((x) => x.id === editing) : undefined;
        if (s) {
          setName(s.name);
          if ('templateId' in s.target) {
            setMode('report');
            setTemplateId(s.target.templateId);
            setValues(s.target.params ?? {});
          } else {
            setMode('question');
            setQuestion(s.target.question);
          }
          const f = s.frequency;
          if (f.type !== 'cron') {
            setKind(f.type);
            setTime(f.time);
            if (f.type === 'weekly') setWeekdays(f.weekdays);
            if (f.type === 'monthly') setMonthDay(f.day);
          }
          setLanguage(s.language);
          setApp(s.deliver.app);
          setPhones(s.deliver.whatsapp.join('\n'));
          setOnlyIfRows(s.onlyIfRows);
          setEnabled(s.enabled);
        }
        setLoaded(true);
      },
      (e) => live && setMessage({ kind: 'error', text: describeError(e, t, server.baseUrl) }),
    );
    return () => {
      live = false;
    };
    // Load once for this screen.
  }, [editing, server, t]);

  // A picked report names the schedule and brings its parameter defaults.
  const pick = (id: string) => {
    const r = templates.find((x) => x.id === id);
    if (!r) return;
    if (!name || templates.some((x) => templateTitle(x, lang) === name)) setName(templateTitle(r, lang));
    setTemplateId(id);
    setValues(defaultParams(r));
    setOnlyIfRows(undefined);
  };

  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const numbers = phones
    .split(/[\n,;]+/)
    .map((s) => s.replace(/[\s()+-]/g, ''))
    .filter(Boolean);
  const numbersOk = numbers.every((n) => /^\d{8,15}$/.test(n));
  const canSave =
    loaded && !!shownName.trim() && timeOk && numbersOk && (app || numbers.length > 0) && (mode === 'report' ? !!template : question.trim().length >= 3) && (kind !== 'weekly' || weekdays.length > 0);

  const input = (): ScheduleInput => {
    const frequency: Frequency = kind === 'daily' ? { type: 'daily', time } : kind === 'weekly' ? { type: 'weekly', time, weekdays } : { type: 'monthly', time, day: monthDay };
    return {
      name: shownName.trim(),
      target: mode === 'report' ? { templateId, params: values } : { question: question.trim() },
      frequency,
      language,
      deliver: { app, whatsapp: numbers },
      ...(onlyIfRows !== undefined ? { onlyIfRows } : {}),
      enabled,
    };
  };

  const save = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      await saveSchedule(server, input(), editing);
      if (app) await ensureNotificationPermission().catch(() => false);
      leave();
    } catch (e) {
      setMessage({ kind: 'error', text: describeError(e, t, server.baseUrl) });
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    if (!editing) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const r = await runSchedule(server, editing);
      setMessage({ kind: 'ok', text: 'skipped' in r ? t.ranSkipped : r.status === 'failed' ? `${t.reportFailed}: ${r.error}` : t.ranNow });
      void refreshInbox();
    } catch (e) {
      setMessage({ kind: 'error', text: describeError(e, t, server.baseUrl) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    await deleteSchedule(server, editing).then(leave, (e) => setMessage({ kind: 'error', text: describeError(e, t, server.baseUrl) }));
  };

  const alertDefault = template?.alert ?? false;
  const rowsOnly = onlyIfRows ?? alertDefault;
  const sortedTemplates = useMemo(() => [...templates].sort((a, b) => Number(b.alert) - Number(a.alert)), [templates]);
  const text = (s: string, extra = {}) => [scriptStyle(s, type.body), { color: p.text, textAlign: rtl ? ('right' as const) : ('left' as const) }, extra];

  if (!loaded) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]}>
        <ActivityIndicator color={p.muted} style={{ marginTop: 80 }} />
        {message && <Text style={[type.meta, { color: p.danger, padding: 16 }]}>{message.text}</Text>}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <PageHeader
          title={editing ? t.editSchedule : t.newSchedule}
          onBack={leave}
          back
          action={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.save}
              disabled={!canSave || busy}
              onPress={save}
              style={({ pressed }) => [styles.save, { backgroundColor: p.primary, opacity: !canSave || busy ? 0.4 : pressed ? 0.85 : 1 }]}
            >
              <Text style={[scriptStyle(t.save, { ...type.label, ...weight.semibold }, 'bold'), { color: p.onPrimary }]}>{t.save}</Text>
            </Pressable>
          }
        />

        {message && (
          <Text style={[scriptStyle(message.text, type.meta), styles.message, { color: message.kind === 'error' ? p.danger : p.text, backgroundColor: message.kind === 'error' ? p.dangerSoft : p.sunken }]}>
            {message.text}
          </Text>
        )}

        <Section title={t.scheduleName}>
          <TextInput value={shownName} onChangeText={setName} accessibilityLabel={t.scheduleName} placeholder={t.scheduleName} placeholderTextColor={p.muted} style={[text(shownName, styles.input)]} />
        </Section>

        <Section title={t.whatToRun}>
          <View style={styles.inner}>
            <View style={[row(rtl), styles.wrap]}>
              <Chip label={t.reports} icon="grid" selected={mode === 'report'} onPress={() => setMode('report')} />
              <Chip label={t.orQuestion} icon="message-square" selected={mode === 'question'} onPress={() => setMode('question')} />
            </View>
            {mode === 'report' ? (
              <>
                <View style={[row(rtl), styles.wrap]} accessibilityLabel={t.pickReport}>
                  {sortedTemplates.map((r) => (
                    <Chip key={r.id} label={templateTitle(r, lang)} selected={r.id === templateId} onPress={() => pick(r.id)} testID={`pick-${r.id}`} />
                  ))}
                </View>
                {template && <ParamFields key={template.id} report={template} values={values} onChange={setValues} today={today} />}
              </>
            ) : (
              <TextInput
                value={question}
                onChangeText={setQuestion}
                multiline
                accessibilityLabel={t.orQuestion}
                placeholder={t.placeholder}
                placeholderTextColor={p.muted}
                style={[text(question, [styles.input, styles.multiline, { backgroundColor: p.sunken }])]}
              />
            )}
          </View>
        </Section>

        <Section title={t.when}>
          <View style={styles.inner}>
            <View style={[row(rtl), styles.wrap]}>
              {(['daily', 'weekly', 'monthly'] as Kind[]).map((k) => (
                <Chip key={k} label={t[k]} selected={kind === k} onPress={() => setKind(k)} />
              ))}
            </View>
            {kind === 'weekly' && (
              <View style={[row(rtl), styles.wrap]} accessibilityLabel={t.onDays}>
                {t.weekdaysShort.map((d, i) => (
                  <Chip key={d} label={d} selected={weekdays.includes(i)} onPress={() => setWeekdays(weekdays.includes(i) ? weekdays.filter((x) => x !== i) : [...weekdays, i].sort())} />
                ))}
              </View>
            )}
            {kind === 'monthly' && (
              <View style={[row(rtl), styles.wrap]} accessibilityLabel={t.dayOfMonth}>
                {MONTH_DAYS.map((d) => (
                  <Chip key={String(d)} label={d === 'last' ? t.lastDay : String(d)} selected={monthDay === d} onPress={() => setMonthDay(d)} />
                ))}
              </View>
            )}
            <Text style={[scriptStyle(t.atTime, type.meta), { color: p.muted, textAlign: rtl ? 'right' : 'left' }]}>{t.atTime}</Text>
            <View style={[row(rtl), styles.wrap]}>
              {TIMES.map((x) => (
                <Chip
                  key={x}
                  label={x}
                  selected={time === x && !customTime}
                  onPress={() => {
                    setCustomTime(false);
                    setTime(x);
                  }}
                />
              ))}
              <Chip label={t.customTime} icon="edit-2" selected={customTime || !TIMES.includes(time)} onPress={() => setCustomTime(true)} />
            </View>
            {(customTime || !TIMES.includes(time)) && (
              <TextInput
                value={time}
                onChangeText={setTime}
                autoFocus={customTime}
                accessibilityLabel={t.atTime}
                placeholder="HH:MM"
                placeholderTextColor={p.muted}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                style={[type.body, styles.time, { color: p.text, backgroundColor: timeOk ? p.sunken : p.dangerSoft }]}
              />
            )}
          </View>
        </Section>

        <Section title={t.deliverTo} footer={whatsappReady ? t.whatsappHint : t.whatsappOff}>
          <View style={[styles.switchRow, row(rtl)]}>
            <Feather name="smartphone" size={16} color={p.text} />
            <Text style={[text(t.deliverApp), styles.flex]}>{t.deliverApp}</Text>
            <Switch value={app} onValueChange={setApp} accessibilityLabel={t.deliverApp} trackColor={{ true: p.accent, false: p.border }} thumbColor={p.surface} {...({ activeThumbColor: p.surface } as object)} />
          </View>
          <View style={[styles.inner, { borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.border }]}>
            <View style={[row(rtl), styles.labelRow]}>
              <Feather name="message-circle" size={16} color={whatsappReady ? p.text : p.faint} />
              <Text style={[scriptStyle(t.deliverWhatsApp, type.body), { color: whatsappReady ? p.text : p.faint }]}>{t.deliverWhatsApp}</Text>
            </View>
            <TextInput
              value={phones}
              onChangeText={setPhones}
              editable={whatsappReady}
              multiline
              keyboardType="phone-pad"
              accessibilityLabel={t.deliverWhatsApp}
              placeholder="923001234567"
              placeholderTextColor={p.muted}
              style={[type.body, styles.input, styles.multiline, { color: p.text, backgroundColor: numbersOk ? p.sunken : p.dangerSoft, fontVariant: ['tabular-nums'] }]}
            />
          </View>
        </Section>

        <Section footer={t.onlyIfRowsHint}>
          <View style={[styles.switchRow, row(rtl)]}>
            <Text style={[text(t.onlyIfRows), styles.flex]}>{t.onlyIfRows}</Text>
            <Switch value={rowsOnly} onValueChange={setOnlyIfRows} accessibilityLabel={t.onlyIfRows} trackColor={{ true: p.accent, false: p.border }} thumbColor={p.surface} {...({ activeThumbColor: p.surface } as object)} />
          </View>
          <View style={[styles.switchRow, row(rtl), { borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.border }]}>
            <Text style={[text(t.enabled), styles.flex]}>{t.enabled}</Text>
            <Switch value={enabled} onValueChange={setEnabled} accessibilityLabel={t.enabled} trackColor={{ true: p.accent, false: p.border }} thumbColor={p.surface} {...({ activeThumbColor: p.surface } as object)} />
          </View>
        </Section>

        <Section title={t.replyIn}>
          <View style={[row(rtl), styles.wrap, styles.inner]}>
            {(
              [
                ['ur', 'اردو'],
                ['en', 'English'],
                ['ur-Latn', t.romanUrdu],
              ] as const
            ).map(([v, label]) => (
              <Chip key={v} label={label} selected={language === v} onPress={() => setLanguage(v)} />
            ))}
          </View>
        </Section>

        {editing && (
          <View style={[row(rtl), styles.bottom]}>
            <Pressable accessibilityRole="button" accessibilityLabel={t.runNow} disabled={busy} onPress={runNow} style={({ pressed }) => [styles.secondary, row(rtl), card(p, 'sm'), pressed && { backgroundColor: p.sunken }]}>
              {busy ? <ActivityIndicator color={p.muted} /> : <Feather name="play" size={16} color={p.text} />}
              <Text style={[scriptStyle(t.runNow, type.label), { color: p.text }]}>{t.runNow}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t.deleteSchedule} onPress={remove} style={({ pressed }) => [styles.secondary, row(rtl), card(p, 'sm'), pressed && { backgroundColor: p.dangerSoft }]}>
              <Feather name="trash-2" size={16} color={p.danger} />
              <Text style={[scriptStyle(t.deleteSchedule, type.label), { color: p.danger }]}>{t.deleteSchedule}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  body: { paddingBottom: 48, gap: 24, maxWidth: layout.formWidth, width: '100%', alignSelf: 'center', paddingHorizontal: layout.gutter },
  save: { paddingHorizontal: 16, height: 40, borderRadius: 20, justifyContent: 'center' },
  message: { borderRadius: 12, padding: 12, marginHorizontal: 4 },
  input: { paddingHorizontal: 14, paddingVertical: 12, outlineStyle: 'none' } as never,
  multiline: { minHeight: 76, borderRadius: 12, textAlignVertical: 'top' },
  inner: { padding: 14, gap: 12 },
  wrap: { flexWrap: 'wrap', gap: 8 },
  time: { width: 76, height: 32, borderRadius: 16, textAlign: 'center', fontVariant: ['tabular-nums'] },
  switchRow: { alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 52 },
  labelRow: { alignItems: 'center', gap: 12 },
  bottom: { gap: 10, flexWrap: 'wrap', paddingHorizontal: 4 },
  secondary: { height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18 },
});
