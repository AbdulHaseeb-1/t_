import { UnsafeSqlError } from '../common/errors.js';

/**
 * Words that can only appear in T-SQL that writes, executes, changes session
 * state or stalls the server. Checked against SQL with strings, comments and
 * quoted identifiers removed, so `[Delete]` or `'drop'` never false-positive.
 * T-SQL allows statements without `;`, so a deny-list over the whole text is
 * required - checking the first keyword alone is not enough.
 */
const FORBIDDEN = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'TRUNCATE',
  'DROP',
  'ALTER',
  'CREATE',
  'EXEC',
  'EXECUTE',
  'GRANT',
  'REVOKE',
  'DENY',
  'BACKUP',
  'RESTORE',
  'DBCC',
  'SHUTDOWN',
  'KILL',
  'RECONFIGURE',
  'CHECKPOINT',
  'OPENROWSET',
  'OPENQUERY',
  'OPENDATASOURCE',
  'OPENXML',
  'BULK',
  'INTO',
  'WAITFOR',
  'USE',
  'DECLARE',
  'SET',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'TRAN',
  'TRANSACTION',
  'TRIGGER',
  'IF',
  'WHILE',
  'GOTO',
  'RETURN',
  'PRINT',
  'RAISERROR',
  'THROW',
];
const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN.join('|')})\\b`, 'i');
const SEQUENCE_RE = /\bNEXT\s+VALUE\s+FOR\b/i;

/** Replaces literals/identifiers with placeholders and drops comments. */
export function stripTsql(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      out += ' ';
    } else if (c === '/' && next === '*') {
      // T-SQL block comments nest.
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth > 0) throw new UnsafeSqlError('unterminated comment');
      out += ' ';
    } else if (c === "'" || c === '[' || c === '"') {
      const close = c === '[' ? ']' : c;
      i++;
      let closed = false;
      while (i < n) {
        if (sql[i] === close) {
          if (sql[i + 1] === close)
            i += 2; // escaped '' ]] ""
          else {
            i++;
            closed = true;
            break;
          }
        } else i++;
      }
      if (!closed) throw new UnsafeSqlError('unterminated literal or identifier');
      out += c === "'" ? " 's' " : ' q ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Accepts exactly one read-only SELECT (optionally with CTEs) and returns it
 * without trailing semicolons. Throws UnsafeSqlError otherwise.
 */
export function assertReadOnlySql(sql: string): string {
  const trimmed = sql
    .trim()
    .replace(/;+\s*$/, '')
    .trim();
  if (!trimmed) throw new UnsafeSqlError('empty statement');
  if (trimmed.length > 20_000) throw new UnsafeSqlError('statement too long');

  const bare = stripTsql(trimmed);
  if (bare.includes(';')) throw new UnsafeSqlError('multiple statements are not allowed');
  if (!/^\s*(SELECT|WITH)\b/i.test(bare)) throw new UnsafeSqlError('only SELECT / WITH queries are allowed');

  const hit = FORBIDDEN_RE.exec(bare) ?? SEQUENCE_RE.exec(bare);
  if (hit) throw new UnsafeSqlError(`forbidden keyword "${hit[0].toUpperCase()}"`);
  return trimmed;
}
