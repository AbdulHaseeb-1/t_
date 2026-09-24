import { memo } from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** The app's route logo (same geometry as scripts/brand.mjs), drawn natively at any size. */
export const RouteMark = memo(function RouteMark({ size = 56 }: { size?: number }) {
  const cream = '#FAF6EE';
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024" accessibilityRole="image" accessibilityLabel="Ask Data">
      <Defs>
        <LinearGradient id="clay" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#E08A68" />
          <Stop offset="1" stopColor="#C25B3C" />
        </LinearGradient>
      </Defs>
      <Rect width="1024" height="1024" rx="232" fill="url(#clay)" />
      {/* translate(512 512) scale(.74) translate(-512 -498) folded into one matrix */}
      <Path
        transform="matrix(0.74 0 0 0.74 133.12 143.48)"
        d="M 334 760 H 640 A 116 116 0 0 0 640 528 H 400 A 116 116 0 0 1 400 296 H 604"
        stroke={cream}
        strokeWidth={64}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Circle transform="matrix(0.74 0 0 0.74 133.12 143.48)" cx="262" cy="760" r="54" stroke={cream} strokeWidth={50} fill="none" />
      <Path
        transform="matrix(0.74 0 0 0.74 133.12 143.48)"
        fillRule="evenodd"
        fill={cream}
        d="M 760 424 C 760 424 648 318 648 238 A 112 112 0 0 1 872 238 C 872 318 760 424 760 424 Z M 760 196 A 44 44 0 1 0 760.1 196 Z"
      />
    </Svg>
  );
});
