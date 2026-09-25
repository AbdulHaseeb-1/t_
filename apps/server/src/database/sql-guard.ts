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

export type SqlDialect = 'tsql' | 'duckdb';

/**
 * DuckDB statements and table functions that reach outside the database file:
 * files, URLs, other databases, extensions, environment, dynamic SQL. The
 * engine is also opened read-only with external access disabled, so these
 * are a second line of defence.
 */
const DUCKDB_FORBIDDEN_RE = new RegExp(
  `\\b(${['ATTACH', 'DETACH', 'COPY', 'EXPORT', 'IMPORT', 'INSTALL', 'LOAD', 'PRAGMA', 'RESET', 'CALL', 'VACUUM', 'SUMMARIZE', 'DESCRIBE', 'SHOW', 'PIVOT_WIDER'].join('|')})\\b`,
  'i',
);
const DUCKDB_FUNCTION_RE =
  /\b(read_\w+|\w+_scan|glob|getenv|query|query_table|sniff_csv|parquet_\w+|duckdb_\w+|pragma_\w+|current_setting|which_secret|load_\w+|write_\w+)\s*\(/i;
/** DuckDB treats a string in FROM/JOIN as a file to scan: FROM 'data.csv'. */
// A string literal used as a table ('data.csv'): after FROM/JOIN, or as a comma-joined
// item of the FROM list. Literals in expressions (IN lists, COALESCE(x, 'n/a')) are fine.
const DUCKDB_FILE_SCAN_RE =
  /\b(?:FROM|JOIN)\s*'s'|\bFROM\s+(?:(?!\b(?:WHERE|GROUP|ORDER|HAVING|QUALIFY|WINDOW|LIMIT|SELECT|ON|USING)\b)[^();])*?,\s*'s'/i;

/** Replaces literals/identifiers with placeholders and drops comments. */
export function stripTsql(sql: string, dialect: SqlDialect = 'tsql'): string {
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
    } else if (c === "'" || (c === '[' && dialect === 'tsql') || c === '"') {
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
export function assertReadOnlySql(sql: string, dialect: SqlDialect = 'tsql'): string {
  const trimmed = sql
    .trim()
    .replace(/;+\s*$/, '')
    .trim();
  if (!trimmed) throw new UnsafeSqlError('empty statement');
  if (trimmed.length > 20_000) throw new UnsafeSqlError('statement too long');
  if (dialect === 'duckdb') {
    // Literal forms the stripper does not model could hide text from the checks below.
    if (/\$[A-Za-z_]*\$/.test(trimmed)) throw new UnsafeSqlError('dollar-quoted strings are not allowed');
    if (/(^|[^A-Za-z0-9_])[eE]'/.test(trimmed)) throw new UnsafeSqlError('escape-string literals are not allowed');
  }

  const bare = stripTsql(trimmed, dialect);
  if (bare.includes(';')) throw new UnsafeSqlError('multiple statements are not allowed');
  if (!/^\s*(SELECT|WITH)\b/i.test(bare)) throw new UnsafeSqlError('only SELECT / WITH queries are allowed');

  const hit = FORBIDDEN_RE.exec(bare) ?? SEQUENCE_RE.exec(bare) ?? (dialect === 'duckdb' ? DUCKDB_FORBIDDEN_RE.exec(bare) : null);
  if (hit) throw new UnsafeSqlError(`forbidden keyword "${hit[0].toUpperCase()}"`);
  if (dialect === 'duckdb') {
    const fn = DUCKDB_FUNCTION_RE.exec(bare);
    if (fn) throw new UnsafeSqlError(`function "${fn[1]}" is not allowed`);
    if (DUCKDB_FILE_SCAN_RE.test(bare)) throw new UnsafeSqlError('reading files is not allowed');
  }
  return trimmed;
}

/** Every identifier the statement references: bare words plus the contents of [..] and ".." quotes. */
export function referencedIdentifiers(sql: string): Set<string> {
  const ids = new Set<string>();
  for (const m of sql.matchAll(/\[((?:[^\]]|\]\])+)\]|"((?:[^"]|"")+)"/g)) ids.add((m[1] ?? m[2]).replace(/\]\]|""/g, (q) => q[0]).toLowerCase());
  for (const w of stripTsql(sql).match(/[A-Za-z_][A-Za-z0-9_$#@]*/g) ?? []) ids.add(w.toLowerCase());
  return ids;
}

export function globToRegExp(glob: string): RegExp {
  const src = glob
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${src}$`);
}

/** Rejects statements that name a denied column (e.g. passwords), quoted or not. */
export function assertNoDeniedColumns(sql: string, denied: RegExp[]): void {
  if (!denied.length) return;
  for (const id of referencedIdentifiers(sql)) {
    if (denied.some((r) => r.test(id))) throw new UnsafeSqlError(`column "${id}" is not available`);
  }
}

/**
 * `SELECT *` / `alias.*` would return columns the guard cannot see by name
 * (e.g. an identity-number column). COUNT(*) and multiplication stay allowed.
 */
export function assertNoStarProjection(sql: string): void {
  const bare = stripTsql(sql);
  if (/(?:\bSELECT|\bDISTINCT|\bTIES|\)|,)\s*(?:[A-Za-z_][\w$#@]*\s*\.\s*|\bq\s*\.\s*)?\*\s*(?:,|\bFROM\b|$)/i.test(bare)) {
    throw new UnsafeSqlError('list the needed columns instead of *');
  }
}
