import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PageHeader, Section, SettingsRow } from '../../components/SettingsUI';
import { type UiLanguage, useI18n } from '../../i18n';
import type { ReplyLanguage } from '../../lib/api';
import { leave } from '../../lib/nav';
import { useSettings } from '../../state/settings';
import { usePalette } from '../../theme';

/** One choice per page, checkmark on the current one; picking applies instantly. */
export default function ChooseScreen() {
  const p = usePalette();
  const { t } = useI18n();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const { language, setLanguage, replyLanguage, setReplyLanguage } = useSettings();

  const reply = kind === 'reply';
  const options: { value: string; label: string }[] = reply
    ? [
        { value: 'auto', label: t.replyAuto },
        { value: 'ur', label: 'اردو' },
        { value: 'ur-Latn', label: t.romanUrdu },
        { value: 'en', label: 'English' },
      ]
    : [
        { value: 'ur', label: 'اردو' },
        { value: 'en', label: 'English' },
      ];
  const current = reply ? replyLanguage : language;
  const pick = (v: string) => (reply ? setReplyLanguage(v as ReplyLanguage) : setLanguage(v as UiLanguage));

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <PageHeader title={reply ? t.replyLanguage : t.interfaceLanguage} onBack={leave} back />
        <Section footer={reply ? t.replyAutoHint : undefined}>
          {options.map((o, i) => (
            <SettingsRow key={o.value} label={o.label} checked={current === o.value} onPress={() => pick(o.value)} last={i === options.length - 1} />
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { paddingBottom: 32, gap: 22, maxWidth: 640, width: '100%', alignSelf: 'center', paddingHorizontal: 12 },
});
