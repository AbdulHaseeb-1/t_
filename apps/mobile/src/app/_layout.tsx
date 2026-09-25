// Latin text uses the system font; only Urdu's Nastaliq is bundled. Per-weight imports:
// the package root would bundle every weight.
import { NotoNastaliqUrdu_400Regular } from '@expo-google-fonts/noto-nastaliq-urdu/400Regular';
import { NotoNastaliqUrdu_700Bold } from '@expo-google-fonts/noto-nastaliq-urdu/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ChatProvider, useChatState } from '../state/chats';
import { ReportsProvider } from '../state/reports';
import { I18nProvider, SettingsProvider, useSettings } from '../state/settings';
import { usePalette } from '../theme';

// Keep the native splash visible until the first screen can render with local state restored.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: 240, fade: true });

export default function RootLayout() {
  const p = usePalette();
  const [loaded, error] = useFonts({ NotoNastaliqUrdu_400Regular, NotoNastaliqUrdu_700Bold });
  // Fonts are bundled; keep the native splash up during the brief load and fall back if needed.
  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <I18nProvider>
          <ChatProvider>
            <ReportsProvider>
              <StartupSplashGate />
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

function StartupSplashGate() {
  const { ready: settingsReady } = useSettings();
  const { hydrated } = useChatState();
  const splashHidden = useRef(false);

  useEffect(() => {
    if (!settingsReady || !hydrated || splashHidden.current) return;
    splashHidden.current = true;
    void SplashScreen.hideAsync().catch(() => undefined);
  }, [settingsReady, hydrated]);

  return null;
}
