import Feather from '@expo/vector-icons/Feather';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { row, scriptStyle, useI18n } from '../i18n';
import { card, type, usePalette, weight } from '../theme';

const starters = [
  {
    icon: 'list' as const,
    en: { title: 'Top products', detail: 'Rank by net sales', prompt: 'List the top 10 products by net sales this month. Show product name, net sales, and units sold in a table, sorted by net sales descending.' },
    ur: { title: 'اہم مصنوعات', detail: 'نیٹ سیلز کے لحاظ سے', prompt: 'اس مہینے نیٹ سیلز کے لحاظ سے 10 اہم ترین مصنوعات کی فہرست دکھائیں۔ جدول میں مصنوعات کا نام، نیٹ سیلز اور فروخت شدہ یونٹس دیں، زیادہ سیلز سے کم کی ترتیب میں۔' },
  },
  {
    icon: 'trending-up' as const,
    en: { title: 'Sales trend', detail: 'Monthly view', prompt: 'Show monthly net sales for this year as a chart. Include the invoice count for each month and explain the largest month-to-month change.' },
    ur: { title: 'سیلز کا رجحان', detail: 'ماہانہ جائزہ', prompt: 'اس سال کی ماہانہ نیٹ سیلز کا چارٹ دکھائیں۔ ہر مہینے کی انوائسز کی تعداد بھی شامل کریں اور سب سے بڑی ماہانہ تبدیلی بتائیں۔' },
  },
  {
    icon: 'alert-circle' as const,
    en: { title: 'Stock at risk', detail: 'Next 7 days', prompt: 'List products with less than 7 days of stock at the last 30 days\' sales rate. Show product name, units in stock, units sold in 30 days, and estimated days left in a table.' },
    ur: { title: 'کم اسٹاک', detail: 'اگلے 7 دن', prompt: 'پچھلے 30 دن کی فروخت کی رفتار پر ایسی مصنوعات کی فہرست دیں جن کا اسٹاک 7 دن سے کم چلے گا۔ جدول میں نام، موجودہ یونٹس، 30 دن کی فروخت اور اندازاً باقی دن دکھائیں۔' },
  },
];

/** Editable examples for the installed sales dataset; tap fills the composer. */
export const PromptStarters = memo(function PromptStarters({ onPick }: { onPick: (prompt: string) => void }) {
  const p = usePalette();
  const { lang, rtl } = useI18n();
  return (
    <View style={styles.group}>
      <Text style={[type.caption, styles.kicker, { color: p.muted, textAlign: rtl ? 'right' : 'left' }]}>{lang === 'ur' ? 'سوال کے نمونے' : 'START WITH A QUESTION'}</Text>
      <View style={styles.list}>
        {starters.map((starter) => {
          const copy = starter[lang];
          return (
            <Pressable
              key={starter.icon}
              accessibilityRole="button"
              accessibilityLabel={`${copy.title}: ${copy.detail}`}
              onPress={() => onPick(copy.prompt)}
              style={({ pressed }) => [styles.item, row(rtl), card(p, 'sm'), pressed && { backgroundColor: p.sunken }]}
            >
              <View style={[styles.icon, { backgroundColor: p.sunken }]}><Feather name={starter.icon} size={16} color={p.accent} /></View>
              <View style={[styles.copy, { alignItems: rtl ? 'flex-end' : 'flex-start' }]}>
                <Text style={[scriptStyle(copy.title, { ...type.label, ...weight.semibold }), { color: p.text }]}>{copy.title}</Text>
                <Text style={[scriptStyle(copy.detail, type.meta), { color: p.muted }]}>{copy.detail}</Text>
              </View>
              <Feather name={rtl ? 'arrow-up-left' : 'arrow-up-right'} size={15} color={p.muted} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  group: { width: '100%', maxWidth: 500, gap: 10, marginTop: 18 },
  kicker: { ...weight.semibold, letterSpacing: 1.2, paddingHorizontal: 4 },
  list: { gap: 8 },
  item: { alignItems: 'center', gap: 12, minHeight: 62, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9 },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 0 },
});
