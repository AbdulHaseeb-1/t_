import { createContext, useContext } from 'react';
import { card, type Palette } from '../theme';

/** True inside a card: controls there sit flat (filled) instead of lifting a second shadow off the card. */
export const OnCard = createContext(false);

/** Background for a small button or chip: a soft lift on the page, a flat fill inside a card. */
export function useControlSurface(p: Palette) {
  return useContext(OnCard) ? { backgroundColor: p.sunken } : card(p, 'sm');
}
