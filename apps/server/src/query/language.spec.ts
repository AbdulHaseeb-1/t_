import { detectLanguage } from './language.js';

describe('detectLanguage', () => {
  it.each([
    ['پاکستان میں ہمارے کتنے گاہک ہیں؟', 'ur'],
    ['2025 میں کتنے آرڈر منسوخ ہوئے؟', 'ur'],
    ['Web چینل سے کتنے فیصد orders آئے؟', 'ur'],
    ['Pakistan mein hamare kitne customers hain?', 'ur-Latn'],
    ['Kitne orders abhi tak pending hain?', 'ur-Latn'],
    ['Wo products ke naam batao jo kabhi nahi bike', 'ur-Latn'],
    ['How many customers are based in Pakistan?', 'en'],
    ['Show the main products by revenue in 2025', 'en'],
    ['What is the total for Karachi and Lahore?', 'en'],
    ['12345', 'en'],
    ['50 percent orders web channel se aaye.', 'ur-Latn'],
    ['Kabhi na bikne wale products yeh hain: Shirt F45, Dress F46, Puzzle F47, Phone F48', 'ur-Latn'],
    ['Karachi mein Gizmo aur Widget sab se zyada bike.', 'ur-Latn'],
    ['Is the Web channel growing faster than Store?', 'en'],
  ])('%s -> %s', (text, lang) => {
    expect(detectLanguage(text)).toBe(lang);
  });
});
