import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertReadOnlySql } from '../database/sql-guard.js';
import {
  addDays,
  dateLiteral,
  periodLabel,
  renderQuestion,
  renderSql,
  resolveDate,
  resolveParams,
  sqlFor,
  templateFileSchema,
  todayIn,
  type ReportTemplate,
} from './template.js';

const TODAY = '2026-09-24'; // a Thursday

describe('report template parameters', () => {
  it('resolves date tokens relative to today', () => {
    expect(
      ['today', 'yesterday', 'week_start', 'month_start', 'prev_month_start', 'prev_month_end', 'year_start', '-7d', '+90d', '2026-02-28'].map(
        (t) => resolveDate(t, TODAY),
      ),
    ).toEqual(['2026-09-24', '2026-09-23', '2026-09-21', '2026-09-01', '2026-08-01', '2026-08-31', '2026-01-01', '2026-09-17', '2026-12-23', '2026-02-28']);
    expect(resolveDate('prev_month_start', '2026-01-15')).toBe('2025-12-01');
    expect(resolveDate('week_start', '2026-09-21')).toBe('2026-09-21'); // Monday stays
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('rejects anything that is not a real date or a known token', () => {
    for (const bad of ['2026-02-30', "2026-09-24'; DROP TABLE x--", 'next week', '24/09/2026']) {
      expect(() => resolveDate(bad, TODAY)).toThrow(/not a date/);
    }
  });

  it('computes today in the report time zone, not the server clock', () => {
    const lateUtc = new Date('2026-09-24T20:30:00Z');
    expect(todayIn('Asia/Karachi', lateUtc)).toBe('2026-09-25');
    expect(todayIn('UTC', lateUtc)).toBe('2026-09-24');
  });

  it('fills defaults, validates numbers and refuses unknown parameters', () => {
    const t = {
      params: [
        { name: 'from', label: 'From', type: 'date' as const, default: 'month_start' },
        { name: 'limit', label: 'How many', type: 'number' as const, default: 10, min: 1, max: 100 },
      ],
    };
    expect(resolveParams(t, {}, TODAY)).toEqual({ today: TODAY, from: '2026-09-01', limit: 10 });
    expect(resolveParams(t, { from: 'yesterday', limit: '25' }, TODAY)).toEqual({ today: TODAY, from: '2026-09-23', limit: 25 });
    expect(() => resolveParams(t, { limit: 500 }, TODAY)).toThrow(/at most 100/);
    expect(() => resolveParams(t, { limit: '1; DELETE' }, TODAY)).toThrow(/whole number/);
    expect(() => resolveParams(t, { limit: 2.5 }, TODAY)).toThrow(/whole number/);
    expect(() => resolveParams(t, { evil: 1 }, TODAY)).toThrow(/Unknown parameter/);
  });

  it('renders dialect-safe literals, shifted dates and numbers', () => {
    const v = { today: TODAY, day: '2026-09-23', days: 30, limit: 5 };
    const sql = 'x >= {{day}} AND x < {{day+1}} AND y >= {{today-30}} AND z < {{today-days}} LIMIT {{limit}}';
    expect(renderSql(sql, v, 'duckdb')).toBe(
      "x >= DATE '2026-09-23' AND x < DATE '2026-09-24' AND y >= DATE '2026-08-25' AND z < DATE '2026-08-25' LIMIT 5",
    );
    // SQL Server: unambiguous basic ISO format regardless of DATEFORMAT / language.
    expect(renderSql('x >= {{day}}', v, 'tsql')).toBe("x >= '20260923'");
    expect(dateLiteral('2026-01-02', 'tsql')).toBe("'20260102'");
    expect(() => renderSql('{{missing}}', v, 'tsql')).toThrow(/no such parameter/);
    expect(() => renderSql('{{limit+1}}', v, 'tsql')).toThrow(/only dates/);
  });

  it('fills questions and labels periods', () => {
    const t = { params: [{ name: 'from', label: 'From', type: 'date' as const, default: 'month_start' }, { name: 'to', label: 'To', type: 'date' as const, default: 'today' }] };
    const v = { today: TODAY, from: '2026-09-01', to: TODAY };
    expect(renderQuestion('Sales from {{from}} to {{to}}', v)).toBe('Sales from 2026-09-01 to 2026-09-24');
    expect(periodLabel(t, v)).toBe('1 Sep 2026 – 24 Sep 2026');
    expect(periodLabel(t, { ...v, from: TODAY })).toBe('24 Sep 2026');
    expect(periodLabel({ params: [] }, v)).toBe('');
  });

  it('picks the SQL for the engine; saved templates only run on the engine they were written for', () => {
    const t = { sql: 'T', sqlDuckdb: 'D' } as ReportTemplate;
    expect([sqlFor(t, 'tsql'), sqlFor(t, 'duckdb')]).toEqual(['T', 'D']);
    expect(sqlFor({ sql: 'T' } as ReportTemplate, 'duckdb')).toBe('T');
    expect(sqlFor({ sql: 'S', dialect: 'tsql' } as ReportTemplate, 'duckdb')).toBeUndefined();
  });
});

describe('MDS_EPD template library', () => {
  const file = templateFileSchema.parse(
    JSON.parse(readFileSync(join(import.meta.dirname, '../../../../infra/mssql/mds-epd.templates.json'), 'utf8')),
  );

  it('parses, has unique ids, and every query passes the read-only guard on both engines', () => {
    const ids = file.templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(15);
    for (const t of file.templates) {
      const v = resolveParams(t, {}, TODAY);
      for (const dialect of ['tsql', 'duckdb'] as const) {
        const sql = sqlFor(t, dialect);
        expect(sql, `${t.id} ${dialect}`).toBeTruthy();
        expect(() => assertReadOnlySql(renderSql(sql!, v, dialect), dialect), `${t.id} ${dialect}`).not.toThrow();
      }
      expect(t.titleUr, t.id).toBeTruthy();
    }
  });
});
