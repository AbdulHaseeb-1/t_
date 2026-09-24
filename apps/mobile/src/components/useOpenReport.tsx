import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ReportSheet } from './ReportParts';
import { useI18n } from '../i18n';
import type { ParamValues, ReportTemplate } from '../lib/api';
import { reportLabel } from '../lib/reports';
import { useChatActions } from '../state/chats';
import { useReports } from '../state/reports';

/**
 * Opening a report: no parameters -> it runs at once in the chat; otherwise a
 * sheet asks for them first (with Run and Schedule). `fresh` starts a new chat.
 */
export function useOpenReport(opts: { fresh?: boolean; after?: () => void } = {}) {
  const { t, lang } = useI18n();
  const actions = useChatActions();
  const { today } = useReports();
  const [open, setOpen] = useState<ReportTemplate>();

  const run = useCallback(
    (r: ReportTemplate, values: ParamValues) => {
      setOpen(undefined);
      if (opts.fresh) actions.newChat();
      actions.runReport(r.id, values, reportLabel(r, values, t, lang));
      opts.after?.();
    },
    [actions, opts, t, lang],
  );

  const openReport = useCallback((r: ReportTemplate) => (r.params.length ? setOpen(r) : run(r, {})), [run]);

  const sheet = open ? (
    <ReportSheet
      report={open}
      today={today}
      onClose={() => setOpen(undefined)}
      onRun={(v) => run(open, v)}
      onSchedule={(v) => {
        setOpen(undefined);
        router.push({ pathname: '/schedules/edit', params: { template: open.id, params: JSON.stringify(v) } });
      }}
    />
  ) : null;

  return { openReport, sheet };
}
