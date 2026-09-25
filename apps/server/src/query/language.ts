/** Languages the system reads and answers in. `ur-Latn` = Roman Urdu (Urdu typed in Latin letters). */
export type Lang = 'en' | 'ur' | 'ur-Latn';

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/u;

/**
 * High-frequency Roman Urdu function words that are not English words, so
 * English questions never trip the detector ("main", "to", "the" excluded).
 */
const ROMAN_URDU = new Set(
  (
    'hai hain tha thi hay kya kia kitne kitna kitni kis kaun kon konsa kaunsa kaunse kab kahan kyun kyon ' +
    'ka ki ke ko se mein mai aur ya nahi nahin batao batain bataen batayein bataiye dikhao dikhain dikhaen dikhayein ' +
    'wala wali wale sab sabse zyada ziada kam abhi tak hue hua hui gaye gaya gayi karo karein kijiye liye lie har ' +
    'saal mahine mahina aaj hamare humare hamara humara mera mere apne apna unke iske uske jo jab agar lekin bhi sirf ' +
    'darmiyan naam bike bika biki bikne kamaya diye kiye kuch koi wapas pichle agle kul jitne jitni ' +
    'aaye aaya aayi aye aya ayi yeh ye woh wo kabhi rahe raha rahi hota hoti hote gayi hogi hoga chahiye sakta sakti ' +
    'nahin mujhe hum aap unhon inhon zaroor bohat bahut'
  ).split(' '),
);

export function detectLanguage(text: string): Lang {
  let letters = 0;
  let arabic = 0;
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    letters++;
    if (ARABIC_SCRIPT.test(ch)) arabic++;
  }
  if (letters > 0 && arabic / letters >= 0.3) return 'ur';
  // Capitalized words are mostly names and data values (Gizmo, Karachi); they say nothing about the language.
  const words = (text.match(/[A-Za-z]+/g) ?? [])
    .filter((w) => w.length > 1 && !/^[A-Z]/.test(w))
    .map((w) => w.toLowerCase());
  const hits = words.filter((w) => ROMAN_URDU.has(w)).length;
  return hits >= 2 && hits / words.length >= 0.2 ? 'ur-Latn' : 'en';
}

export const LANGUAGE_NAME: Record<Lang, string> = {
  en: 'English',
  ur: 'Urdu (in Urdu script)',
  'ur-Latn': 'Roman Urdu (Urdu in Latin letters, the casual way Pakistanis text, e.g. "Ap k 20 customers hain")',
};

/** Fixed phrases the server writes itself, so they never cost a model call. */
export const PHRASES: Record<Lang, { noRows: string; cannotAnswer: string; found: string; noAnswer: string }> = {
  en: {
    noRows: 'The query returned no rows.',
    cannotAnswer: "I can't answer that from this database:",
    found: 'Here is what I found.',
    noAnswer: "I couldn't put an answer together. Try asking it another way.",
  },
  ur: {
    noRows: 'اس سوال کے لیے کوئی ریکارڈ نہیں ملا۔',
    cannotAnswer: 'اس ڈیٹا بیس سے اس سوال کا جواب نہیں دیا جا سکتا:',
    found: 'یہ رہا نتیجہ۔',
    noAnswer: 'میں اس کا جواب تیار نہیں کر سکا۔ براہِ کرم سوال دوسرے انداز میں پوچھیں۔',
  },
  'ur-Latn': {
    noRows: 'Is sawal ka koi record nahi mila.',
    cannotAnswer: 'Ye database is sawal ka jawab nahi de sakta:',
    found: 'Ye raha result.',
    noAnswer: 'Main iska jawab nahi bana saka. Sawal thora aur tarah se puchein.',
  },
};
