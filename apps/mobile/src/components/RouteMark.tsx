import { memo } from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** The Datalink node mark, matched to scripts/brand.mjs for native screens. */
export const RouteMark = memo(function RouteMark({ size = 56 }: { size?: number }) {
  const cream = '#F5F0E6';
  const clay = '#D09A74';
  const transform = 'matrix(0.74 0 0 0.74 133.12 133.12)';
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024" accessibilityRole="image" accessibilityLabel="Datalink">
      <Defs>
        <LinearGradient id="datalink" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#4B483F" />
          <Stop offset="1" stopColor="#282722" />
        </LinearGradient>
      </Defs>
      <Rect width="1024" height="1024" rx="232" fill="url(#datalink)" />
      <Path transform={transform} d="M 300 260 V 764 M 300 260 H 490 C 681 260 772 356 772 512 C 772 668 681 764 490 764 H 300" stroke={cream} strokeWidth={72} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path transform={transform} d="M 300 512 H 725" stroke={clay} strokeWidth={56} strokeLinecap="round" fill="none" />
      {[[300, 260], [300, 764], [725, 512]].map(([cx, cy]) => (
        <Circle key={`${cx}-${cy}`} transform={transform} cx={cx} cy={cy} r={38} fill={clay} />
      ))}
    </Svg>
  );
});
