import { Stack } from 'expo-router';
import { usePalette } from '../../theme';

export default function SettingsLayout() {
  const p = usePalette();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }} />;
}
