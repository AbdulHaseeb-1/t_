import { Platform, useColorScheme } from 'react-native';

/** Datalink's warm stone surfaces with a restrained clay accent. */
const light = {
  bg: '#F6F4EF',
  surface: '#FDFCF8',
  userBubble: '#E9E5DA',
  sunken: '#EFEEE8',
  border: '#D9D5CA',
  text: '#292821',
  prose: '#39372F',
  muted: '#706D63',
  faint: '#969287',
  primary: '#423E35',
  onPrimary: '#FFFDF7',
  accent: '#9B6647',
  danger: '#B3261E',
  dangerSoft: '#F9E3E1',
  scrim: 'rgba(32, 29, 24, 0.34)',
  /** Cards float on a soft, warm two-layer shadow instead of a border. */
  shadow: '0px 1px 2px rgba(55, 48, 36, 0.05), 0px 4px 16px rgba(55, 48, 36, 0.07)',
  /** Small controls (chips): a lighter lift. */
  shadowSm: '0px 1px 2px rgba(55, 48, 36, 0.06), 0px 2px 8px rgba(55, 48, 36, 0.05)',
};

const dark: typeof light = {
  bg: '#1E1D1A',
  surface: '#292824',
  userBubble: '#34322C',
  sunken: '#181714',
  border: '#403E37',
  text: '#ECE9E1',
  prose: '#D9D5CB',
  muted: '#B2ADA1',
  faint: '#858176',
  primary: '#E8E3D7',
  onPrimary: '#292721',
  accent: '#D09A74',
  danger: '#F2B8B5',
  dangerSoft: '#3B2628',
  scrim: 'rgba(0, 0, 0, 0.5)',
  // Dark surfaces are lighter than the page, so a deeper shadow only adds depth.
  shadow: '0px 1px 2px rgba(0, 0, 0, 0.22), 0px 6px 18px rgba(0, 0, 0, 0.20)',
  shadowSm: '0px 1px 2px rgba(0, 0, 0, 0.20), 0px 2px 8px rgba(0, 0, 0, 0.16)',
};

export type Palette = typeof light;

/**
 * Chart colors: the validated categorical order (fixed, never cycled; checked
 * with the dataviz validator against this app's surfaces in both modes), a
 * de-emphasis gray for "context" marks, and status colors reserved for
 * up/down deltas (always shown with an arrow and a sign, never color alone).
 */
const chartLight = {
  series: ['#96543A', '#536B3B', '#A07722', '#785687', '#3F7564', '#A4515E'],
  context: '#D5D0C5',
  grid: '#E8E5DD',
  good: '#367344',
  bad: '#B3261E',
};
const chartDark: typeof chartLight = {
  series: ['#D49270', '#AFC484', '#DFB664', '#C0A0CE', '#82B9A3', '#DC9AA2'],
  context: '#5B5850',
  grid: '#3B3933',
  good: '#8FCE91',
  bad: '#F2A6A0',
};
export type ChartPalette = typeof chartLight;

export function useChartPalette(): ChartPalette {
  return useColorScheme() === 'dark' ? chartDark : chartLight;
}

/**
 * Latin text uses the system font (no fontFamily), so weights come from
 * fontWeight. Urdu keeps Nastaliq: phones render Urdu in Naskh by default,
 * which reads as Arabic to Urdu readers.
 */
export const fonts = {
  urdu: 'NotoNastaliqUrdu_400Regular',
  urduBold: 'NotoNastaliqUrdu_700Bold',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }),
} as const;

export const weight = {
  regular: { fontWeight: '400' },
  medium: { fontWeight: '500' },
  semibold: { fontWeight: '600' },
  bold: { fontWeight: '700' },
} as const;

/** Type roles shared by chat, charts, navigation, and forms. */
export const type = {
  display: { ...weight.semibold, fontSize: 28, lineHeight: 36 },
  page: { ...weight.semibold, fontSize: 26, lineHeight: 34 },
  heading: { ...weight.semibold, fontSize: 21, lineHeight: 29 },
  subheading: { ...weight.semibold, fontSize: 19, lineHeight: 27 },
  title: { ...weight.semibold, fontSize: 17, lineHeight: 24 },
  prose: { ...weight.regular, fontSize: 16, lineHeight: 26 },
  body: { ...weight.regular, fontSize: 16, lineHeight: 24 },
  label: { ...weight.medium, fontSize: 15, lineHeight: 22 },
  meta: { ...weight.regular, fontSize: 14, lineHeight: 20 },
  caption: { ...weight.regular, fontSize: 12, lineHeight: 17 },
  code: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 20 },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const layout = { pageWidth: 760, formWidth: 640, gutter: 16 } as const;

/** A borderless, softly shadowed card: continuous (squircle) corners on iOS. */
export function card(p: Palette, size: 'md' | 'sm' = 'md') {
  return { backgroundColor: p.surface, boxShadow: size === 'sm' ? p.shadowSm : p.shadow, borderCurve: 'continuous' as const };
}

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
