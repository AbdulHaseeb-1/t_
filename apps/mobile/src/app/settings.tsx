import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton } from '../components/IconButton';
import { checkConnection, normalizeBaseUrl, type ReplyLanguage, type ServerConfig } from '../lib/api';
import { describeError } from '../lib/errors';
import { row, scriptStyle, type UiLanguage, useI18n } from '../i18n';
import { useSettings } from '../state/settings';
import { fonts, type, usePalette } from '../theme';

/** Back to the chat, also when Settings was opened directly (deep link, first run). */
function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

type Check = { state: 'idle' } | { state: 'checking' } | { state: 'ok' | 'warn' | 'fail'; message: string };

export default function SettingsScreen() {
  const { server, save, ready } = useSettings();
  const p = usePalette();
  // Mount the form only once stored values are loaded, so it initializes from them directly.
  if (!ready) return <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} />;
  return <SettingsForm initial={server} save={save} />;
}

function Segment<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  const p = usePalette();
  const { rtl } = useI18n();
  return (
    <View style={styles.group}>
      <Text style={[scriptStyle(label, type.meta), { color: p.muted }]}>{label}</Text>
      <View
        style={[styles.segment, row(rtl), options.length > 3 && styles.grid, { borderColor: p.border }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
      >
        {options.map((o) => {
          const on = value === o.value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              accessibilityLabel={o.label}
              onPress={() => onChange(o.value)}
              style={[styles.segmentItem, options.length > 3 && styles.gridItem, on && { backgroundColor: p.primary }]}
            >
              <Text numberOfLines={1} style={[scriptStyle(o.label, type.label), { color: on ? p.onPrimary : p.text, textAlign: 'center' }]}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {!!hint && <Text style={[scriptStyle(hint, type.meta), { color: p.faint }]}>{hint}</Text>}
    </View>
  );
}

function Preferences() {
  const p = usePalette();
  const { language, setLanguage, replyLanguage, setReplyLanguage, sounds, setSounds } = useSettings();
  const { t, rtl } = useI18n();
  return (
    <>
      <Segment<UiLanguage>
        label={t.language}
        value={language}
        onChange={setLanguage}
        options={[
          { value: 'ur', label: 'اردو' },
          { value: 'en', label: 'English' },
        ]}
      />
      <Segment<ReplyLanguage>
        label={t.replyLanguage}
        value={replyLanguage}
        onChange={setReplyLanguage}
        hint={t.replyAutoHint}
        options={[
          { value: 'auto', label: t.replyAuto },
          { value: 'ur', label: 'اردو' },
          { value: 'ur-Latn', label: t.romanUrdu },
          { value: 'en', label: 'English' },
        ]}
      />
      <View style={styles.group}>
        <View style={[row(rtl), styles.switchRow]}>
          <Text style={[scriptStyle(t.sounds, type.label), styles.flex, { color: p.text }]}>{t.sounds}</Text>
          <Switch
            value={sounds}
            onValueChange={setSounds}
            accessibilityLabel={t.sounds}
            trackColor={{ true: p.accent, false: p.border }}
            thumbColor={p.surface}
            // react-native-web colours the "on" thumb separately.
            {...({ activeThumbColor: p.surface } as object)}
          />
        </View>
        <Text style={[scriptStyle(t.soundsHint, type.meta), { color: p.faint }]}>{t.soundsHint}</Text>
      </View>
    </>
  );
}

function SettingsForm({ initial, save }: { initial: ServerConfig; save: (next: ServerConfig) => Promise<void> }) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  const [url, setUrl] = useState(initial.baseUrl);
  const [key, setKey] = useState(initial.apiKey ?? '');
  const [check, setCheck] = useState<Check>({ state: 'idle' });

  const draft = { baseUrl: url.trim() ? normalizeBaseUrl(url) : '', apiKey: key.trim() || undefined };

  const test = async () => {
    setCheck({ state: 'checking' });
    try {
      const r = await checkConnection(draft);
      if (!r.authorized) setCheck({ state: 'fail', message: t.connKey });
      else if (!r.db.ok) setCheck({ state: 'warn', message: t.connDb(r.db.error ?? '?') });
      else if (!r.llm.configured) setCheck({ state: 'warn', message: t.connLlm });
      else setCheck({ state: 'ok', message: t.connOk(r.llm.mode) });
    } catch (err) {
      setCheck({ state: 'fail', message: describeError(err, t, draft.baseUrl) });
    }
  };

  const done = async () => {
    await save(draft);
    leave();
  };

  const field = [type.body, styles.input, { color: p.text, backgroundColor: p.surface, borderColor: p.border }];
  const tone = check.state === 'ok' ? p.text : check.state === 'warn' ? p.muted : p.danger;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} edges={['top', 'bottom']}>
      <View style={[styles.bar, row(rtl)]}>
        <IconButton name="x" label={t.closeSettings} onPress={leave} />
        <Text style={[scriptStyle(t.settingsTitle, type.title), styles.title, { color: p.text, textAlign: 'center' }]} accessibilityRole="header">
          {t.settingsTitle}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Save settings" onPress={done} hitSlop={8} style={styles.save}>
          <Text style={[scriptStyle(t.save, { ...type.label, fontFamily: fonts.sansSemibold }, 'bold'), { color: p.text }]}>{t.save}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.group}>
          <Text style={[scriptStyle(t.serverAddress, type.meta), { color: p.muted }]} nativeID="url-label">
            {t.serverAddress}
          </Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.20:3000"
            autoFocus={!initial.baseUrl}
            placeholderTextColor={p.faint}
            accessibilityLabelledBy="url-label"
            accessibilityLabel="Server address"
            style={field}
          />
          <Text style={[scriptStyle(t.serverHint, type.meta), { color: p.faint }]}>{t.serverHint}</Text>
        </View>

        <View style={styles.group}>
          <Text style={[scriptStyle(t.apiKey, type.meta), { color: p.muted }]} nativeID="key-label">
            {t.apiKey}
          </Text>
          <TextInput
            value={key}
            onChangeText={setKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder={t.optional}
            placeholderTextColor={p.faint}
            accessibilityLabelledBy="key-label"
            accessibilityLabel="API key"
            style={field}
          />
          <Text style={[scriptStyle(t.keychain, type.meta), { color: p.faint }]}>{t.keychain}</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Test connection"
          onPress={test}
          disabled={check.state === 'checking'}
          style={({ pressed }) => [styles.test, { borderColor: p.border }, pressed && { backgroundColor: p.sunken }]}
        >
          {check.state === 'checking' ? (
            <ActivityIndicator color={p.muted} />
          ) : (
            <Text style={[scriptStyle(t.testConnection, type.label), { color: p.text }]}>{t.testConnection}</Text>
          )}
        </Pressable>
        {'message' in check && (
          <Text style={[scriptStyle(check.message, type.meta), { color: tone }]} accessibilityLiveRegion="polite">
            {check.message}
          </Text>
        )}
        <View style={[styles.divider, { backgroundColor: p.border }]} />
        <Preferences />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: 52 },
  title: { flex: 1, textAlign: 'center' },
  save: { paddingHorizontal: 12, height: 40, justifyContent: 'center' },
  body: { padding: 20, gap: 22, maxWidth: 560, width: '100%', alignSelf: 'center' },
  group: { gap: 8 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  segment: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 3, gap: 3 },
  segmentItem: { flex: 1, borderRadius: 9, paddingVertical: 6, paddingHorizontal: 4, alignItems: 'center' },
  grid: { flexWrap: 'wrap' },
  // Two per row: long labels ("Roman Urdu") stay whole on small phones.
  gridItem: { flexBasis: '48%', flexGrow: 1 },
  switchRow: { alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  test: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, height: 46, alignItems: 'center', justifyContent: 'center' },
});
