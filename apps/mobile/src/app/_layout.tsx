// Per-weight imports: the package roots would bundle every weight (~5 MB of unused fonts).
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold';
import { NotoNastaliqUrdu_400Regular } from '@expo-google-fonts/noto-nastaliq-urdu/400Regular';
import { NotoNastaliqUrdu_700Bold } from '@expo-google-fonts/noto-nastaliq-urdu/700Bold';
import { SourceSerif4_400Regular } from '@expo-google-fonts/source-serif-4/400Regular';
import { SourceSerif4_400Regular_Italic } from '@expo-google-fonts/source-serif-4/400Regular_Italic';
import { SourceSerif4_600SemiBold } from '@expo-google-fonts/source-serif-4/600SemiBold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ChatProvider } from '../state/chats';
import { ReportsProvider } from '../state/reports';
import { I18nProvider, SettingsProvider } from '../state/settings';
import { usePalette } from '../theme';

export default function RootLayout() {
  const p = usePalette();
  const [loaded, error] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    SourceSerif4_400Regular,
    SourceSerif4_400Regular_Italic,
    SourceSerif4_600SemiBold,
    NotoNastaliqUrdu_400Regular,
    NotoNastaliqUrdu_700Bold,
  });
  // Fonts ship inside the bundle, so this is a few frames; on failure, fall back to system fonts.
  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <I18nProvider>
          <ChatProvider>
            <ReportsProvider>
              <StatusBar style="auto" />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
              </Stack>
            </ReportsProvider>
          </ChatProvider>
        </I18nProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
