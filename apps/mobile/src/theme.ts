import { createContext, useContext } from 'react';
import { Platform, useColorScheme } from 'react-native';

/** Clean white surfaces, near-black ink, one blue for status and links: a calm chat canvas. */
const light = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  /** Drawer and grouped backgrounds: a whisper off the page. */
  sidebar: '#F9F9F9',
  userBubble: '#F4F4F4',
  /** Pressed rows, icon wells, table headers, inline code. */
  sunken: '#F4F4F4',
  /** The current row in a list (the open conversation). */
  selected: '#ECECEC',
  border: '#E5E5E5',
  text: '#0D0D0D',
  prose: '#0D0D0D',
  muted: '#5D5D5D',
  faint: '#8F8F8F',
  primary: '#0D0D0D',
  onPrimary: '#FFFFFF',
  /** Links, switches, checkmarks, unread badges (5.2:1 on white). */
  accent: '#2563EB',
  danger: '#D1242F',
  dangerSoft: '#FDECEC',
  scrim: 'rgba(0, 0, 0, 0.32)',
  /** Cards are drawn by their hairline border; the shadow only lifts them a touch. */
  shadow: '0px 1px 2px rgba(0, 0, 0, 0.04), 0px 4px 14px rgba(0, 0, 0, 0.04)',
  shadowSm: '0px 1px 2px rgba(0, 0, 0, 0.05)',
};

const dark: typeof light = {
  bg: '#212121',
  surface: '#2A2A2A',
  sidebar: '#171717',
  userBubble: '#303030',
  sunken: '#303030',
  selected: '#383838',
  border: '#3A3A3A',
  text: '#ECECEC',
  prose: '#E3E3E3',
  muted: '#B4B4B4',
  faint: '#8F8F8F',
  primary: '#ECECEC',
  onPrimary: '#0D0D0D',
  accent: '#6EA2FF',
  danger: '#FF8A80',
  dangerSoft: '#3D2426',
  scrim: 'rgba(0, 0, 0, 0.55)',
  shadow: '0px 1px 2px rgba(0, 0, 0, 0.25), 0px 6px 18px rgba(0, 0, 0, 0.22)',
  shadowSm: '0px 1px 2px rgba(0, 0, 0, 0.25)',
};

export type Palette = typeof light;
export type Scheme = 'light' | 'dark';
/** What the person picked in Settings; `system` follows the phone. */
export type Appearance = Scheme | 'system';

/** The color scheme in effect, resolved from the Appearance setting (see SettingsProvider). */
export const SchemeContext = createContext<Appearance>('light');

export function useScheme(): Scheme {
  const appearance = useContext(SchemeContext);
  const system = useColorScheme();
  return appearance === 'system' ? (system === 'dark' ? 'dark' : 'light') : appearance;
}

/**
 * Chart colors: a validated categorical order (fixed, never cycled; run through
 * the dataviz validator against #FFFFFF and #212121: every hard gate passes in
 * both modes, worst adjacent CVD ΔE 9.1 light / 8.4 dark), a neutral gray for
 * "context" marks, and status colors reserved for up/down deltas (always with
 * an arrow and a sign, never color alone). Three light slots sit under 3:1 on
 * white, so every chart keeps its table view one tap away.
 */
const chartLight = {
  series: ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300'],
  context: '#D4D4D4',
  grid: '#EDEDED',
  good: '#006300',
  bad: '#D03B3B',
  /** Washes behind a delta (the text on them stays in the ink color). */
  goodSoft: '#E6F4E8',
  badSoft: '#FBEAEA',
};
const chartDark: typeof chartLight = {
  series: ['#3987E5', '#D95926', '#199E70', '#C98500', '#D55181', '#008300'],
  context: '#4A4A4A',
  grid: '#333333',
  good: '#0CA30C',
  bad: '#E66767',
  goodSoft: '#1B3320',
  badSoft: '#3D2426',
};
export type ChartPalette = typeof chartLight;

export function useChartPalette(): ChartPalette {
  return useScheme() === 'dark' ? chartDark : chartLight;
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

/** A card drawn by a hairline border with the faintest lift: continuous (squircle) corners on iOS. */
export function card(p: Palette, size: 'md' | 'sm' = 'md') {
  return {
    backgroundColor: p.surface,
    borderWidth: 1,
    borderColor: p.border,
    boxShadow: size === 'sm' ? p.shadowSm : p.shadow,
    borderCurve: 'continuous' as const,
  };
}

export function usePalette(): Palette {
  return useScheme() === 'dark' ? dark : light;
}
