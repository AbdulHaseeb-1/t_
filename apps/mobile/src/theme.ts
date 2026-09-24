import { Platform, useColorScheme } from 'react-native';

/**
 * Calm, warm-neutral conversation UI. Two roles for type, as in the
 * reference design: a serif for the assistant's prose, a sans for
 * everything the user types and taps.
 */
const light = {
  bg: '#FAF9F5',
  surface: '#FFFFFF',
  userBubble: '#F0EEE6',
  sunken: '#F2F0E8',
  border: '#E3E0D6',
  text: '#1F1E1D',
  prose: '#29261F',
  muted: '#73716A',
  faint: '#A29F95',
  primary: '#1F1E1D',
  onPrimary: '#FAF9F5',
  accent: '#C96442',
  danger: '#B3261E',
  dangerSoft: '#F9E3E1',
  scrim: 'rgba(20, 19, 17, 0.32)',
};

const dark: typeof light = {
  bg: '#262624',
  surface: '#30302E',
  userBubble: '#141413',
  sunken: '#1F1E1D',
  border: '#3D3C38',
  text: '#F5F4EE',
  prose: '#E9E7DF',
  muted: '#A6A399',
  faint: '#76746C',
  primary: '#F5F4EE',
  onPrimary: '#1F1E1D',
  accent: '#D97757',
  danger: '#F2B8B5',
  dangerSoft: '#3B2322',
  scrim: 'rgba(0, 0, 0, 0.5)',
};

export type Palette = typeof light;

export const fonts = {
  sans: 'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansSemibold: 'DMSans_600SemiBold',
  serif: 'SourceSerif4_400Regular',
  serifItalic: 'SourceSerif4_400Regular_Italic',
  serifSemibold: 'SourceSerif4_600SemiBold',
  urdu: 'NotoNastaliqUrdu_400Regular',
  urduBold: 'NotoNastaliqUrdu_700Bold',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }),
} as const;

/** One scale, used everywhere. */
export const type = {
  prose: { fontFamily: fonts.serif, fontSize: 16.5, lineHeight: 26 },
  body: { fontFamily: fonts.sans, fontSize: 16, lineHeight: 23 },
  title: { fontFamily: fonts.sansSemibold, fontSize: 16, lineHeight: 22 },
  label: { fontFamily: fonts.sansMedium, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 18 },
  code: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 19 },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
