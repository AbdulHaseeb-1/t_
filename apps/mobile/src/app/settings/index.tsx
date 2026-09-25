import Constants from 'expo-constants';
import { router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageHeader, Section, SettingsRow } from '../../components/SettingsUI';
import { useI18n } from '../../i18n';
import { leave } from '../../lib/nav';
import { useSettings } from '../../state/settings';
import { layout, usePalette } from '../../theme';

export default function SettingsScreen() {
  const p = usePalette();
  const { t } = useI18n();
  const { server, language, replyLanguage, sounds, setSounds, showSql, setShowSql, ready } = useSettings();
  if (!ready) return <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} />;

  const host = server.baseUrl ? server.baseUrl.replace(/^https?:\/\//, '') : t.notConnected;
  const reply = { auto: t.replyAuto, ur: 'اردو', 'ur-Latn': t.romanUrdu, en: 'English' }[replyLanguage];

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <PageHeader title={t.settingsTitle} onBack={leave} />
        <Section title={t.sectionConnection}>
          <SettingsRow icon="server" label={t.server} value={host} onPress={() => router.push('/settings/server')} last testID="row-server" />
        </Section>
        <Section title={t.sectionLanguage} footer={t.replyAutoHint}>
          <SettingsRow
            icon="globe"
            label={t.interfaceLanguage}
            value={language === 'ur' ? 'اردو' : 'English'}
            onPress={() => router.push({ pathname: '/settings/choose', params: { kind: 'ui' } })}
          />
          <SettingsRow icon="message-circle" label={t.replyLanguage} value={reply} onPress={() => router.push({ pathname: '/settings/choose', params: { kind: 'reply' } })} last />
        </Section>
        <Section title={t.sectionChat} footer={t.showSqlHint}>
          <SettingsRow icon="code" label={t.showSql} toggle={{ value: showSql, onChange: setShowSql }} />
          <SettingsRow icon="volume-2" label={t.sounds} toggle={{ value: sounds, onChange: setSounds }} last />
        </Section>
        <Section title={t.sectionAbout}>
          <SettingsRow icon="info" label={t.version} value={Constants.expoConfig?.version ?? '1.0.0'} last />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { paddingBottom: 32, gap: 24, maxWidth: layout.formWidth, width: '100%', alignSelf: 'center', paddingHorizontal: layout.gutter },
});
