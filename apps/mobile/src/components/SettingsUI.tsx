import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { row, scriptStyle, useI18n } from '../i18n';
import { card, type, usePalette, weight } from '../theme';
import { OnCard } from './surface';
import { IconButton } from './IconButton';

type Icon = ComponentProps<typeof Feather>['name'];

/**
 * Settings building blocks in the style of a calm, native settings screen:
 * a close/back bar, a large page title, and grouped inset cards whose rows
 * carry an icon, a label, the current value and a chevron.
 */
export function PageHeader({ title, onBack, back, action }: { title: string; onBack: () => void; back?: boolean; action?: ReactNode }) {
  const p = usePalette();
  const { t, rtl } = useI18n();
  return (
    <View>
      <View style={[styles.bar, row(rtl)]}>
        <IconButton
          name={back ? (rtl ? 'chevron-right' : 'chevron-left') : 'x'}
          label={back ? t.back : t.closeSettings}
          onPress={onBack}
          size={back ? 24 : 22}
        />
        <View style={styles.flex} />
        {action}
      </View>
      <Text style={[scriptStyle(title, styles.bigTitle, 'bold'), { color: p.text }]} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

export function Section({ title, children, footer }: { title?: string; children: ReactNode; footer?: string }) {
  const p = usePalette();
  return (
    <View style={styles.section}>
      {!!title && <Text style={[scriptStyle(title, { ...type.meta, ...weight.medium }), styles.sectionTitle, { color: p.muted }]}>{title}</Text>}
      <View style={[styles.shell, card(p)]}>
        <View style={styles.card}>
          <OnCard.Provider value>{children}</OnCard.Provider>
        </View>
      </View>
      {!!footer && <Text style={[scriptStyle(footer, type.meta), styles.footer, { color: p.muted }]}>{footer}</Text>}
    </View>
  );
}

interface RowProps {
  icon?: Icon;
  label: string;
  value?: string;
  onPress?: () => void;
  toggle?: { value: boolean; onChange: (v: boolean) => void };
  checked?: boolean;
  last?: boolean;
  testID?: string;
}

export function SettingsRow({ icon, label, value, onPress, toggle, checked, last, testID }: RowProps) {
  const p = usePalette();
  const { rtl } = useI18n();
  const body = (
    <>
      {icon && (
        <View style={[styles.iconWrap, { backgroundColor: p.sunken }]}>
          <Feather name={icon} size={16} color={p.text} />
        </View>
      )}
      <Text style={[scriptStyle(label, type.body), styles.flex, { color: p.text }]} numberOfLines={2}>
        {label}
      </Text>
      {!!value && (
        <Text style={[scriptStyle(value, type.meta), styles.value, { color: p.muted }]} numberOfLines={1}>
          {value}
        </Text>
      )}
      {toggle && (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          accessibilityLabel={label}
          trackColor={{ true: p.accent, false: p.border }}
          thumbColor={p.surface}
          {...({ activeThumbColor: p.surface } as object)}
        />
      )}
      {checked !== undefined && <Feather name="check" size={18} color={checked ? p.accent : 'transparent'} />}
      {onPress && checked === undefined && <Feather name={rtl ? 'chevron-left' : 'chevron-right'} size={18} color={p.faint} />}
    </>
  );
  const divider = !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: p.border };
  if (!onPress) {
    return (
      <View style={[styles.row, row(rtl), divider]} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole={checked !== undefined ? 'radio' : 'button'}
      accessibilityState={checked !== undefined ? { checked } : undefined}
      aria-checked={checked}
      accessibilityLabel={value ? `${label}, ${value}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, row(rtl), divider, pressed && { backgroundColor: p.sunken }]}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: { alignItems: 'center', height: 56 },
  bigTitle: { ...type.page, paddingHorizontal: 4, paddingTop: 4, paddingBottom: 12 },
  section: { gap: 8 },
  sectionTitle: { paddingHorizontal: 12 },
  shell: { borderRadius: 18 },
  card: { borderRadius: 18, overflow: 'hidden' },
  footer: { paddingHorizontal: 12 },
  row: { alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 56, paddingVertical: 10 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  value: { maxWidth: '45%' },
});
