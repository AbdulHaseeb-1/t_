import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { row, scriptStyle, useI18n } from '../i18n';
import type { ParamValues, ReportTemplate, TemplateParam } from '../lib/api';
import { CATEGORY_ICON, datePresets, defaultParams, paramLabel, resolveDate, templateDescription, templateTitle, validDate } from '../lib/reports';
import { fonts, type, usePalette } from '../theme';
import { Sheet } from './Sheet';

type Icon = React.ComponentProps<typeof Feather>['name'];

export function Chip({ label, selected, onPress, icon, testID }: { label: string; selected?: boolean; onPress: () => void; icon?: Icon; testID?: string }) {
  const p = usePalette();
  const { rtl } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        row(rtl),
        { borderColor: selected ? p.text : p.border, backgroundColor: selected ? p.text : p.surface },
        pressed && { opacity: 0.8 },
      ]}
    >
      {icon && <Feather name={icon} size={14} color={selected ? p.bg : p.text} />}
      <Text style={[scriptStyle(label, type.meta), { color: selected ? p.bg : p.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** One editor per parameter: preset chips plus a typed date, or a number. */
export function ParamFields({ report, values, onChange, today }: { report: ReportTemplate; values: ParamValues; onChange: (v: ParamValues) => void; today?: string }) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  if (!report.params.length) return null;
  const set = (name: string, v: string | number) => onChange({ ...values, [name]: v });
  return (
    <View style={styles.fields}>
      {report.params.map((param) => (
        <ParamField key={param.name} param={param} value={values[param.name] ?? param.default} onChange={(v) => set(param.name, v)} today={today} />
      ))}
      {today && (
        <Text style={[scriptStyle(t.presetToday, type.meta), { color: p.faint, textAlign: rtl ? 'right' : 'left' }]}>
          {`${t.presetToday}: ${today}`}
        </Text>
      )}
    </View>
  );
}

function ParamField({ param, value, onChange, today }: { param: TemplateParam; value: string | number; onChange: (v: string | number) => void; today?: string }) {
  const p = usePalette();
  const { t, lang, rtl } = useI18n();
  const label = paramLabel(param, lang);
  const [text, setText] = useState(param.type === 'date' && validDate(String(value)) ? String(value) : '');
  if (param.type === 'number') {
    const n = Number(value);
    const clamp = (x: number) => Math.max(param.min ?? -Infinity, Math.min(param.max ?? Infinity, x));
    return (
      <View style={styles.field}>
        <Text style={[scriptStyle(label, type.label), { color: p.text, textAlign: rtl ? 'right' : 'left' }]}>{label}</Text>
        <View style={[row(rtl), styles.stepper]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${label} −`} onPress={() => onChange(clamp(n - 1))} style={[styles.step, { borderColor: p.border }]}>
            <Feather name="minus" size={16} color={p.text} />
          </Pressable>
          <TextInput
            value={String(value)}
            onChangeText={(s) => {
              const x = Number(s.replace(/[^\d]/g, ''));
              if (Number.isFinite(x)) onChange(clamp(x));
            }}
            keyboardType="number-pad"
            accessibilityLabel={label}
            style={[type.body, styles.numInput, { color: p.text, borderColor: p.border }]}
          />
          <Pressable accessibilityRole="button" accessibilityLabel={`${label} +`} onPress={() => onChange(clamp(n + 1))} style={[styles.step, { borderColor: p.border }]}>
            <Feather name="plus" size={16} color={p.text} />
          </Pressable>
        </View>
      </View>
    );
  }
  const presets = datePresets(param, t);
  const shown = today ? resolveDate(String(value), today) : String(value);
  return (
    <View style={styles.field}>
      <View style={[row(rtl), styles.labelRow]}>
        <Text style={[scriptStyle(label, type.label), { color: p.text }]}>{label}</Text>
        <Text style={[type.meta, { color: p.muted, fontVariant: ['tabular-nums'] }]}>{shown}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, row(rtl)]}>
        {presets.map((pr) => (
          <Chip
            key={pr.value}
            label={pr.label}
            selected={value === pr.value}
            onPress={() => {
              setText('');
              onChange(pr.value);
            }}
          />
        ))}
      </ScrollView>
      <TextInput
        value={text}
        onChangeText={(s) => {
          setText(s);
          if (validDate(s)) onChange(s);
        }}
        placeholder={t.customDate}
        placeholderTextColor={p.faint}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={`${label}: ${t.customDate}`}
        style={[type.body, styles.dateInput, { color: p.text, borderColor: text && !validDate(text) ? p.danger : p.border }]}
      />
    </View>
  );
}

/** Report details, its parameters, and the two things to do with it: run now or schedule. */
export function ReportSheet({
  report,
  today,
  onClose,
  onRun,
  onSchedule,
}: {
  report: ReportTemplate;
  today?: string;
  onClose: () => void;
  onRun: (values: ParamValues) => void;
  onSchedule: (values: ParamValues) => void;
}) {
  const p = usePalette();
  const { t, lang, rtl } = useI18n();
  const [values, setValues] = useState<ParamValues>(() => defaultParams(report));
  const description = templateDescription(report, lang);
  const title = templateTitle(report, lang);
  return (
    <Sheet visible title={title} onClose={onClose} testID="report-sheet">
      <View style={styles.sheetBody}>
        {!!description && <Text style={[scriptStyle(description, type.body), { color: p.muted, textAlign: rtl ? 'right' : 'left' }]}>{description}</Text>}
        <ParamFields report={report} values={values} onChange={setValues} today={today} />
        <View style={[row(rtl), styles.buttons]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.runReport}
            onPress={() => onRun(values)}
            style={({ pressed }) => [styles.primary, row(rtl), { backgroundColor: p.primary }, pressed && { opacity: 0.85 }]}
          >
            <Feather name="play" size={16} color={p.onPrimary} />
            <Text style={[scriptStyle(t.runReport, { ...type.label, fontFamily: fonts.sansSemibold }, 'bold'), { color: p.onPrimary }]}>{t.runReport}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.scheduleIt}
            onPress={() => onSchedule(values)}
            style={({ pressed }) => [styles.secondary, row(rtl), { borderColor: p.border }, pressed && { backgroundColor: p.sunken }]}
          >
            <Feather name="clock" size={16} color={p.text} />
            <Text style={[scriptStyle(t.scheduleIt, type.label), { color: p.text }]}>{t.scheduleIt}</Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

/** Reports first on the empty chat: alerts and today's numbers are what people check most. */
export function ReportChips({ templates, onPick, onAll }: { templates: ReportTemplate[]; onPick: (r: ReportTemplate) => void; onAll: () => void }) {
  const { t, lang, rtl } = useI18n();
  if (!templates.length) return null;
  // Two alerts, then today's numbers: a mix of "what needs attention" and "how are we doing".
  const alerts = templates.filter((r) => r.alert).slice(0, 2);
  const rest = templates.filter((r) => !r.alert && r.params.every((p) => p.type !== 'number')).slice(0, 4 - alerts.length);
  return (
    <View style={[styles.quick, row(rtl)]} accessibilityLabel={t.quickReports}>
      {[...alerts, ...rest].map((r) => (
        <Chip key={r.id} label={templateTitle(r, lang)} icon={(r.icon ?? CATEGORY_ICON[r.category]) as Icon} onPress={() => onPick(r)} testID={`report-chip-${r.id}`} />
      ))}
      <Chip label={t.allReports} icon="grid" onPress={onAll} testID="report-chip-all" />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 12, height: 32, maxWidth: 240 },
  chips: { gap: 8, paddingVertical: 2 },
  fields: { gap: 18 },
  field: { gap: 8 },
  labelRow: { justifyContent: 'space-between', alignItems: 'baseline' },
  stepper: { alignItems: 'center', gap: 8 },
  step: { width: 40, height: 40, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  numInput: { minWidth: 72, height: 40, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, textAlign: 'center', paddingHorizontal: 8 },
  dateInput: { height: 40, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, fontVariant: ['tabular-nums'] },
  sheetBody: { gap: 18, paddingBottom: 8 },
  buttons: { gap: 10 },
  primary: { flex: 1, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondary: { height: 46, borderRadius: 23, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18 },
  quick: { marginTop: 18, flexWrap: 'wrap', justifyContent: 'center', gap: 8, maxWidth: 520 },
});

/** Name a chat answer and keep it as a one-tap report (its SQL is reused, no model needed next time). */
export function SaveReportSheet({ question, onClose, onSave }: { question: string; onClose: () => void; onSave: (title: string) => Promise<void> }) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  const [title, setTitle] = useState(question.replace(/^📊\s*/, '').slice(0, 80));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onSave(title.trim());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Sheet visible title={t.saveAsReport} onClose={onClose} testID="save-report-sheet">
      <View style={styles.sheetBody}>
        <Text style={[scriptStyle(t.reportName, type.label), { color: p.text, textAlign: rtl ? 'right' : 'left' }]}>{t.reportName}</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          autoFocus
          accessibilityLabel={t.reportName}
          style={[scriptStyle(title, type.body), styles.dateInput, { color: p.text, borderColor: p.border, textAlign: rtl ? 'right' : 'left' }]}
        />
        {!!error && <Text style={[scriptStyle(error, type.meta), { color: p.danger }]}>{error}</Text>}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.save}
          disabled={busy || title.trim().length < 2}
          onPress={save}
          style={({ pressed }) => [styles.primary, row(rtl), { backgroundColor: p.primary, opacity: busy || title.trim().length < 2 ? 0.5 : pressed ? 0.85 : 1 }]}
        >
          <Feather name="bookmark" size={16} color={p.onPrimary} />
          <Text style={[scriptStyle(t.save, { ...type.label, fontFamily: fonts.sansSemibold }, 'bold'), { color: p.onPrimary }]}>{t.save}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
