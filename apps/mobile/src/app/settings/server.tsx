import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAware } from '../../components/KeyboardAware';
import { PageHeader, Section } from '../../components/SettingsUI';
import { row, scriptStyle, useI18n } from '../../i18n';
import { checkConnection, normalizeBaseUrl, type ServerConfig } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { leave } from '../../lib/nav';
import { useSettings } from '../../state/settings';
import { card, layout, type, useChartPalette, usePalette, weight } from '../../theme';

type Check = { state: 'idle' } | { state: 'checking' } | { state: 'ok' | 'warn' | 'fail'; message: string };

export default function ServerScreen() {
  const { server, save, ready } = useSettings();
  const p = usePalette();
  // Mount the form only once stored values are loaded, so it initializes from them directly.
  if (!ready) return <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} />;
  return <ServerForm initial={server} save={save} />;
}

function ServerForm({ initial, save }: { initial: ServerConfig; save: (next: ServerConfig) => Promise<void> }) {
  const p = usePalette();
  const c = useChartPalette();
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

  const input = [type.body, styles.input, { color: p.text }];
  const statusIcon = check.state === 'ok' ? 'check-circle' : check.state === 'warn' ? 'alert-triangle' : 'x-circle';
  const statusColor = check.state === 'ok' ? c.good : check.state === 'warn' ? p.muted : c.bad;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} edges={['top', 'bottom']}>
      <KeyboardAware>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <PageHeader
            title={t.server}
            onBack={leave}
            back
            action={
              <Pressable accessibilityRole="button" accessibilityLabel="Save settings" onPress={done} hitSlop={8} style={[styles.save, { backgroundColor: p.primary }]}>
                <Text style={[scriptStyle(t.save, { ...type.label, ...weight.semibold }, 'bold'), { color: p.onPrimary }]}>{t.save}</Text>
              </Pressable>
            }
          />

          <Section title={t.serverAddress} footer={t.serverHint}>
            <TextInput
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.1.20:3000"
              autoFocus={!initial.baseUrl}
              placeholderTextColor={p.muted}
              accessibilityLabel="Server address"
              style={input}
            />
          </Section>

          <Section title={t.apiKey} footer={t.keychain}>
            <TextInput
              value={key}
              onChangeText={setKey}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholder={t.optional}
              placeholderTextColor={p.muted}
              accessibilityLabel="API key"
              style={input}
            />
          </Section>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Test connection"
            onPress={test}
            disabled={check.state === 'checking'}
            style={({ pressed }) => [styles.test, row(rtl), card(p), pressed && { backgroundColor: p.sunken }]}
          >
            {check.state === 'checking' ? (
              <ActivityIndicator color={p.muted} />
            ) : (
              <>
                <Feather name="activity" size={16} color={p.text} />
                <Text style={[scriptStyle(t.testConnection, type.label), { color: p.text }]}>{t.testConnection}</Text>
              </>
            )}
          </Pressable>
          {'message' in check && (
            <View style={[styles.status, row(rtl)]}>
              <Feather name={statusIcon} size={16} color={statusColor} />
              <Text style={[scriptStyle(check.message, type.meta), styles.flex, { color: check.state === 'fail' ? p.danger : p.text }]} accessibilityLiveRegion="polite">
                {check.message}
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAware>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  body: { paddingBottom: 32, gap: 24, maxWidth: layout.formWidth, width: '100%', alignSelf: 'center', paddingHorizontal: layout.gutter },
  input: { paddingHorizontal: 14, paddingVertical: 13, outlineStyle: 'none' } as never,
  save: { paddingHorizontal: 16, height: 40, borderRadius: 20, justifyContent: 'center' },
  test: { borderRadius: 16, height: 48, alignItems: 'center', justifyContent: 'center', gap: 8 },
  status: { alignItems: 'flex-start', gap: 8, paddingHorizontal: 4 },
});
