import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconButton } from '../components/IconButton';
import { ApiError, checkConnection, normalizeBaseUrl, type ServerConfig } from '../lib/api';
import { useSettings } from '../state/settings';
import { fonts, type, usePalette } from '../theme';

type Check = { state: 'idle' } | { state: 'checking' } | { state: 'ok' | 'warn' | 'fail'; message: string };

export default function SettingsScreen() {
  const { server, save, ready } = useSettings();
  const p = usePalette();
  // Mount the form only once stored values are loaded, so it initializes from them directly.
  if (!ready) return <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} />;
  return <SettingsForm initial={server} save={save} />;
}

function SettingsForm({ initial, save }: { initial: ServerConfig; save: (next: ServerConfig) => Promise<void> }) {
  const p = usePalette();
  const [url, setUrl] = useState(initial.baseUrl);
  const [key, setKey] = useState(initial.apiKey ?? '');
  const [check, setCheck] = useState<Check>({ state: 'idle' });

  const draft = { baseUrl: normalizeBaseUrl(url || initial.baseUrl), apiKey: key.trim() || undefined };

  const test = async () => {
    setCheck({ state: 'checking' });
    try {
      const r = await checkConnection(draft);
      if (!r.authorized) setCheck({ state: 'fail', message: 'Connected, but the API key was rejected.' });
      else if (!r.db.ok) setCheck({ state: 'warn', message: `Connected, but the database is unreachable: ${r.db.error ?? 'unknown error'}` });
      else if (!r.llm.configured) setCheck({ state: 'warn', message: 'Connected, but the server has no language model key configured.' });
      else setCheck({ state: 'ok', message: `Connected. Database is up; model routing: ${r.llm.mode}.` });
    } catch (err) {
      setCheck({ state: 'fail', message: err instanceof ApiError ? err.message : 'Connection failed.' });
    }
  };

  const done = async () => {
    await save(draft);
    router.back();
  };

  const field = [type.body, styles.input, { color: p.text, backgroundColor: p.surface, borderColor: p.border }];
  const tone = check.state === 'ok' ? p.text : check.state === 'warn' ? p.muted : p.danger;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} edges={['top', 'bottom']}>
      <View style={styles.bar}>
        <IconButton name="x" label="Close settings" onPress={() => router.back()} />
        <Text style={[type.title, styles.title, { color: p.text }]} accessibilityRole="header">
          Settings
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Save settings" onPress={done} hitSlop={8} style={styles.save}>
          <Text style={[type.label, { color: p.text, fontFamily: fonts.sansSemibold }]}>Save</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.group}>
          <Text style={[type.meta, { color: p.muted }]} nativeID="url-label">
            Server address
          </Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.20:3000"
            placeholderTextColor={p.faint}
            accessibilityLabelledBy="url-label"
            accessibilityLabel="Server address"
            style={field}
          />
          <Text style={[type.meta, { color: p.faint }]}>{"On a phone, use your computer's network address, not localhost."}</Text>
        </View>

        <View style={styles.group}>
          <Text style={[type.meta, { color: p.muted }]} nativeID="key-label">
            API key (if the server requires one)
          </Text>
          <TextInput
            value={key}
            onChangeText={setKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="Optional"
            placeholderTextColor={p.faint}
            accessibilityLabelledBy="key-label"
            accessibilityLabel="API key"
            style={field}
          />
          <Text style={[type.meta, { color: p.faint }]}>Stored in the device keychain.</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Test connection"
          onPress={test}
          disabled={check.state === 'checking'}
          style={({ pressed }) => [styles.test, { borderColor: p.border }, pressed && { backgroundColor: p.sunken }]}
        >
          {check.state === 'checking' ? <ActivityIndicator color={p.muted} /> : <Text style={[type.label, { color: p.text }]}>Test connection</Text>}
        </Pressable>
        {'message' in check && (
          <Text style={[type.meta, { color: tone }]} accessibilityLiveRegion="polite">
            {check.message}
          </Text>
        )}
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
  test: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, height: 46, alignItems: 'center', justifyContent: 'center' },
});
