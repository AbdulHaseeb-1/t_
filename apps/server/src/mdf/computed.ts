/**
 * Translates the stored T-SQL text of a non-persisted computed column into a
 * DuckDB expression. Only the constructs SQL Server itself emits for simple
 * arithmetic are supported; anything else is rejected rather than guessed.
 *
 *   (CONVERT([decimal](15,2),([a]*isnull([b],(0)))))
 *     -> (CAST((("a"*coalesce("b",(0)))) AS DECIMAL(15,2)))
 */
const TYPE_MAP: Record<string, (args: string) => string> = {
  decimal: (a) => `DECIMAL${a}`,
  numeric: (a) => `DECIMAL${a}`,
  int: () => 'INTEGER',
  bigint: () => 'BIGINT',
  smallint: () => 'SMALLINT',
  tinyint: () => 'UTINYINT',
  float: () => 'DOUBLE',
  real: () => 'FLOAT',
  money: () => 'DECIMAL(19,4)',
  bit: () => 'BOOLEAN',
  varchar: () => 'VARCHAR',
  nvarchar: () => 'VARCHAR',
  char: () => 'VARCHAR',
  nchar: () => 'VARCHAR',
  date: () => 'DATE',
  datetime: () => 'TIMESTAMP',
  datetime2: () => 'TIMESTAMP',
};

export class UnsupportedExpression extends Error {}

export function translateComputed(tsql: string): string {
  let s = tsql.trim();
  if (/'|--|\/\*|\bselect\b|\bcase\b|\bdateadd\b|\bdatediff\b|\bgetdate\b/i.test(s)) {
    throw new UnsupportedExpression(`unsupported construct in: ${tsql}`);
  }
  // CONVERT([type](args), expr) -> CAST(expr AS type(args)); innermost first.
  for (let guard = 0; /convert\s*\(/i.test(s); guard++) {
    if (guard > 50) throw new UnsupportedExpression(`too many CONVERTs: ${tsql}`);
    const m = /convert\s*\(\s*\[?(\w+)\]?\s*(\(\s*\d+\s*(?:,\s*\d+\s*)?\))?\s*,/gi;
    let last: RegExpExecArray | null = null;
    for (let x = m.exec(s); x; x = m.exec(s)) last = x;
    if (!last) throw new UnsupportedExpression(`malformed CONVERT in: ${tsql}`);
    const type = TYPE_MAP[last[1].toLowerCase()];
    if (!type) throw new UnsupportedExpression(`CONVERT to ${last[1]} in: ${tsql}`);
    // find the matching close paren of this CONVERT(
    const open = s.indexOf('(', last.index);
    let depth = 0;
    let end = -1;
    for (let i = open; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')' && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new UnsupportedExpression(`unbalanced CONVERT in: ${tsql}`);
    const expr = s.slice(last.index + last[0].length, end);
    if (topLevelComma(expr)) throw new UnsupportedExpression(`CONVERT with a style argument in: ${tsql}`);
    s = `${s.slice(0, last.index)}CAST(${expr} AS ${type((last[2] ?? '').replace(/\s+/g, ''))})${s.slice(end + 1)}`;
  }
  s = s.replace(/\bisnull\s*\(/gi, 'coalesce(');
  s = exactDivision(s);
  s = s.replace(/\[([^\]]+)\]/g, (_, id: string) => `"${id.replace(/"/g, '""')}"`);
  if (/\b(?!CAST\b|AS\b|DECIMAL\b|INTEGER\b|BIGINT\b|SMALLINT\b|UTINYINT\b|DOUBLE\b|FLOAT\b|BOOLEAN\b|VARCHAR\b|DATE\b|TIMESTAMP\b|coalesce\b)[A-Za-z_]\w*\s*\(/.test(s)) {
    throw new UnsupportedExpression(`unsupported function in: ${tsql}`);
  }
  return s;
}

function topLevelComma(expr: string): boolean {
  let depth = 0;
  for (const ch of expr) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) return true;
  }
  return false;
}

/**
 * DuckDB evaluates DECIMAL / DECIMAL in DOUBLE, so an exact .xx5 can round the
 * wrong way (SQL Server keeps it exact). Division by a constant whose
 * reciprocal is a terminating decimal (100, 12.5, 0.25...) becomes an exact
 * multiplication: x / (100.0) -> x * (0.010).
 */
export function exactDivision(expr: string): string {
  return expr.replace(/\/\s*(\(?)\s*(\d+(?:\.\d+)?)\s*(\)?)/g, (whole, open: string, lit: string, close: string) => {
    if (Boolean(open) !== Boolean(close)) return whole;
    const recip = exactReciprocal(lit);
    return recip ? `*${open}${recip}${close}` : whole;
  });
}

function exactReciprocal(literal: string): string | undefined {
  const [int, frac = ''] = literal.split('.');
  let m = BigInt(int + frac);
  if (m === 0n) return undefined;
  const d = frac.length;
  let twos = 0;
  let fives = 0;
  while (m % 2n === 0n) {
    m /= 2n;
    twos++;
  }
  while (m % 5n === 0n) {
    m /= 5n;
    fives++;
  }
  if (m !== 1n) return undefined; // 1/3 etc. never terminates
  const k = Math.max(twos, fives);
  const scaled = 10n ** BigInt(d + k) / BigInt(int + frac); // exact
  const digits = scaled.toString().padStart(k + 1, '0');
  return k ? `${digits.slice(0, -k)}.${digits.slice(-k)}` : digits;
}
