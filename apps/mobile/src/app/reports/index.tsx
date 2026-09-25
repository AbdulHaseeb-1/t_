import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PressableCard } from '../../components/PressableCard';
import { PageHeader } from '../../components/SettingsUI';
import { useOpenReport } from '../../components/useOpenReport';
import { row, scriptStyle, useI18n } from '../../i18n';
import { deleteTemplate, type ReportTemplate } from '../../lib/api';
import { leave } from '../../lib/nav';
import { CATEGORY_ICON, CATEGORY_ORDER, categoryLabel, templateDescription, templateTitle } from '../../lib/reports';
import { useReports } from '../../state/reports';
import { useSettings } from '../../state/settings';
import { fonts, type, usePalette } from '../../theme';

type Icon = React.ComponentProps<typeof Feather>['name'];

/** Report gallery: one tap runs a report in the chat; long press on a saved one deletes it. */
export default function ReportsScreen() {
  const p = usePalette();
  const { t, lang, rtl } = useI18n();
  const { server } = useSettings();
  const { templates, loading, error, reload, unread } = useReports();
  const [query, setQuery] = useState('');
  const { openReport, sheet } = useOpenReport({ fresh: true, after: () => router.dismissTo('/') });

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (r: ReportTemplate) =>
      !q || [r.title, r.titleUr, r.description, r.descriptionUr].some((s) => s?.toLowerCase().includes(q));
    return CATEGORY_ORDER.map((c) => ({ c, items: templates.filter((r) => r.category === c && match(r)) })).filter((g) => g.items.length);
  }, [templates, query]);

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
              <HeaderLink icon="inbox" label={t.inboxButton(unread)} badge={unread} onPress={() => router.push('/inbox')} />
            </View>
          }
        />
        <View style={[styles.search, row(rtl), { backgroundColor: p.sunken }]}>
          <Feather name="search" size={16} color={p.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t.searchReports}
            placeholderTextColor={p.faint}
            accessibilityLabel={t.searchReports}
            style={[type.body, styles.searchInput, { color: p.text, textAlign: rtl ? 'right' : 'left' }]}
          />
        </View>
        {loading && !templates.length && <ActivityIndicator color={p.muted} style={styles.pad} />}
        {!!error && <Text style={[scriptStyle(error, type.meta), styles.pad, { color: p.danger }]}>{error}</Text>}
        {!loading && !error && !templates.length && (
          <Text style={[scriptStyle(t.noReports, type.body), styles.pad, { color: p.muted, textAlign: rtl ? 'right' : 'left' }]}>{t.noReports}</Text>
        )}
        {groups.map(({ c, items }) => (
          <View key={c} style={styles.group}>
            <Text style={[scriptStyle(categoryLabel(c, t), { ...type.meta, fontFamily: fonts.sansMedium }), styles.groupTitle, { color: p.muted, textAlign: rtl ? 'right' : 'left' }]}>
              {categoryLabel(c, t)}
            </Text>
            <View style={styles.grid}>
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

function ReportCard({ r, onPress, onLongPress }: { r: ReportTemplate; onPress: () => void; onLongPress?: () => void }) {
  const p = usePalette();
  const { lang, rtl } = useI18n();
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
      style={styles.card}
    >
      <View style={[row(rtl), styles.cardTop]}>
        <View style={[styles.icon, { backgroundColor: r.alert ? p.dangerSoft : p.sunken }]}>
          <Feather name={(r.icon ?? CATEGORY_ICON[r.category]) as Icon} size={16} color={r.alert ? p.danger : p.text} />
        </View>
        {r.params.length > 0 && <Feather name="sliders" size={13} color={p.faint} />}
      </View>
      <Text style={[scriptStyle(title, { ...type.label, fontFamily: fonts.sansSemibold }, 'bold'), { color: p.text, textAlign: rtl ? 'right' : 'left' }]} numberOfLines={2}>
        {title}
      </Text>
      {!!description && (
        <Text style={[scriptStyle(description, type.meta), { color: p.muted, textAlign: rtl ? 'right' : 'left' }]} numberOfLines={3}>
          {description}
        </Text>
      )}
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center', paddingHorizontal: 12, gap: 8 },
  headerActions: { gap: 4, alignItems: 'center' },
  headerLink: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 4, right: 2, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#fff', fontSize: 10, fontFamily: fonts.sansSemibold },
  search: { alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, height: 42, marginHorizontal: 4 },
  searchInput: { flex: 1, outlineStyle: 'none' } as never,
  pad: { padding: 16 },
  group: { gap: 8, marginTop: 14 },
  groupTitle: { paddingHorizontal: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 4, paddingBottom: 4 },
  // Two per row on phones and tablets alike; a lone last card keeps its width.
  card: { flexGrow: 1, flexBasis: '45%', maxWidth: '49%', minHeight: 116, borderRadius: 20, padding: 14, gap: 8 },
  cardTop: { justifyContent: 'space-between', alignItems: 'center' },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
