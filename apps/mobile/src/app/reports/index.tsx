import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PressableCard } from '../../components/PressableCard';
import { PageHeader } from '../../components/SettingsUI';
import { useOpenReport } from '../../components/useOpenReport';
import { row, scriptStyle, useI18n } from '../../i18n';
import { deleteTemplate, type ReportCategory, type ReportTemplate } from '../../lib/api';
import { leave } from '../../lib/nav';
import { CATEGORY_ICON, CATEGORY_ORDER, categoryLabel, templateDescription, templateTitle } from '../../lib/reports';
import { useReports } from '../../state/reports';
import { useSettings } from '../../state/settings';
import { layout, type, usePalette, weight } from '../../theme';

type Icon = React.ComponentProps<typeof Feather>['name'];
type ReportFilter = 'all' | ReportCategory;

/** Mobile report library: search or filter, then tap a full-width row to run it. */
export default function ReportsScreen() {
  const p = usePalette();
  const { t, lang, rtl } = useI18n();
  const { server } = useSettings();
  const { templates, loading, error, reload, unread } = useReports();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ReportFilter>('all');
  const { openReport, sheet } = useOpenReport({ fresh: true, after: () => router.dismissTo('/') });

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (r: ReportTemplate) =>
      !q || [r.title, r.titleUr, r.description, r.descriptionUr].some((s) => s?.toLowerCase().includes(q));
    return CATEGORY_ORDER
      .filter((category) => filter === 'all' || category === filter)
      .map((category) => ({ category, items: templates.filter((r) => r.category === category && match(r)) }))
      .filter((group) => group.items.length > 0);
  }, [filter, templates, query]);

  const remove = (r: ReportTemplate) => {
    const go = () => void deleteTemplate(server, r.id).then(reload, () => undefined);
    if (Platform.OS === 'web') go();
    else Alert.alert(t.deleteReport, templateTitle(r, lang), [{ text: t.cancel, style: 'cancel' }, { text: t.delete, style: 'destructive', onPress: go }]);
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <PageHeader
          title={t.reports}
          onBack={leave}
          back
          action={
            <View style={[row(rtl), styles.headerActions]}>
              <HeaderLink icon="clock" label={t.schedules} onPress={() => router.push('/schedules')} />
              <HeaderLink icon="inbox" label={t.inboxButton(unread)} onPress={() => router.push('/inbox')} badge={unread} />
            </View>
          }
        />

        <Text style={[scriptStyle(t.reportsHint, type.body), styles.intro, { color: p.muted, textAlign: rtl ? 'right' : 'left' }]}>
          {t.reportsHint}
        </Text>

        <View style={[styles.search, row(rtl), { backgroundColor: p.surface, borderColor: p.border }]}>
          <Feather name="search" size={17} color={p.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t.searchReports}
            placeholderTextColor={p.muted}
            accessibilityLabel={t.searchReports}
            returnKeyType="search"
            style={[type.body, styles.searchInput, { color: p.text, textAlign: rtl ? 'right' : 'left' }]}
          />
          {!!query && (
            <Pressable accessibilityRole="button" accessibilityLabel={t.clearSearch} onPress={() => setQuery('')} hitSlop={8}>
              <Feather name="x-circle" size={17} color={p.muted} />
            </Pressable>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.filters, row(rtl)]}>
          <FilterChip label={t.allReports} selected={filter === 'all'} onPress={() => setFilter('all')} />
          {CATEGORY_ORDER.map((category) => (
            <FilterChip
              key={category}
              label={categoryLabel(category, t)}
              selected={filter === category}
              onPress={() => setFilter(category)}
            />
          ))}
        </ScrollView>

        {loading && !templates.length && <ActivityIndicator color={p.muted} style={styles.state} />}
        {!!error && <Text style={[scriptStyle(error, type.meta), styles.state, { color: p.danger }]}>{error}</Text>}
        {!loading && !error && !templates.length && (
          <Text style={[scriptStyle(t.noReports, type.body), styles.state, { color: p.muted, textAlign: rtl ? 'right' : 'left' }]}>{t.noReports}</Text>
        )}
        {!loading && !error && templates.length > 0 && groups.length === 0 && (
          <Text style={[scriptStyle(t.noMatchingReports, type.body), styles.state, { color: p.muted, textAlign: rtl ? 'right' : 'left' }]}>{t.noMatchingReports}</Text>
        )}

        {groups.map(({ category, items }) => (
          <View key={category} style={styles.group}>
            <View style={[row(rtl), styles.groupHeading]}>
              <Feather name={CATEGORY_ICON[category] as Icon} size={16} color={p.accent} />
              <Text style={[scriptStyle(categoryLabel(category, t), { ...type.label, ...weight.semibold }), { color: p.text }]}>
                {categoryLabel(category, t)}
              </Text>
              <View style={[styles.count, { backgroundColor: p.sunken }]}>
                <Text style={[type.caption, { color: p.muted }]}>{items.length}</Text>
              </View>
            </View>
            <View style={styles.list}>
              {items.map((r) => (
                <ReportCard key={r.id} r={r} onPress={() => openReport(r)} onLongPress={r.builtIn ? undefined : () => remove(r)} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      {sheet}
    </SafeAreaView>
  );
}

function HeaderLink({ icon, label, onPress, badge = 0 }: { icon: Icon; label: string; onPress: () => void; badge?: number }) {
  const p = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.headerLink, pressed && { backgroundColor: p.sunken }]}>
      <Feather name={icon} size={20} color={p.text} />
      {badge > 0 && (
        <View style={[styles.badge, { backgroundColor: p.accent }]}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        { backgroundColor: selected ? p.primary : p.surface, borderColor: selected ? p.primary : p.border },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[scriptStyle(label, type.meta, selected ? 'bold' : undefined), { color: selected ? p.onPrimary : p.text }]}>{label}</Text>
    </Pressable>
  );
}

function ReportCard({ r, onPress, onLongPress }: { r: ReportTemplate; onPress: () => void; onLongPress?: () => void }) {
  const p = usePalette();
  const { lang, rtl, t } = useI18n();
  const title = templateTitle(r, lang);
  const description = templateDescription(r, lang);
  return (
    <PressableCard
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={description}
      onPress={onPress}
      onLongPress={onLongPress}
      testID={`report-${r.id}`}
      style={[styles.card, row(rtl)]}
    >
      <View style={[styles.icon, { backgroundColor: r.alert ? p.dangerSoft : p.sunken }]}>
        <Feather name={(r.icon ?? CATEGORY_ICON[r.category]) as Icon} size={18} color={r.alert ? p.danger : p.text} />
      </View>
      <View style={styles.cardCopy}>
        <Text style={[scriptStyle(title, type.title, 'bold'), { color: p.text, textAlign: rtl ? 'right' : 'left' }]} numberOfLines={1}>
          {title}
        </Text>
        {!!description && (
          <Text style={[scriptStyle(description, type.meta), { color: p.muted, textAlign: rtl ? 'right' : 'left' }]} numberOfLines={2}>
            {description}
          </Text>
        )}
        {r.alert && (
          <Text style={[scriptStyle(t.needsAttention, type.caption, 'bold'), styles.alertLabel, { color: p.danger, textAlign: rtl ? 'right' : 'left' }]}>
            {t.needsAttention}
          </Text>
        )}
      </View>
      <View style={[row(rtl), styles.cardEnd]}>
        {r.params.length > 0 && <Feather name="sliders" size={15} color={p.faint} />}
        <Feather name={rtl ? 'chevron-left' : 'chevron-right'} size={18} color={p.faint} />
      </View>
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { paddingBottom: 40, maxWidth: layout.pageWidth, width: '100%', alignSelf: 'center', paddingHorizontal: layout.gutter, gap: 14 },
  headerActions: { gap: 4, alignItems: 'center' },
  headerLink: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 4, right: 2, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#fff', fontSize: 11, lineHeight: 14, ...weight.semibold },
  intro: { paddingHorizontal: 4 },
  search: { alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, paddingHorizontal: 14, height: 50 },
  searchInput: { flex: 1, outlineStyle: 'none' } as never,
  filters: { gap: 8, paddingHorizontal: 2, paddingVertical: 2 },
  filterChip: { minHeight: 38, borderWidth: StyleSheet.hairlineWidth, borderRadius: 19, paddingHorizontal: 14, justifyContent: 'center' },
  pressed: { opacity: 0.82 },
  state: { padding: 16 },
  group: { gap: 10, marginTop: 8 },
  groupHeading: { alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  count: { minWidth: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  list: { gap: 10 },
  card: { minHeight: 82, alignItems: 'center', borderRadius: 18, padding: 14, gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1, gap: 3 },
  alertLabel: { marginTop: 2 },
  cardEnd: { alignItems: 'center', gap: 8 },
});
