/**
 * Column type metadata (decoded from sysrscols.ti) and on-disk value decoding.
 * Values are returned in exact, engine-neutral forms: decimals as scaled
 * integers, datetimes as microseconds, so no precision is lost on the way to
 * the query engine.
 */
export const enum SqlType {
  Image = 34,
  Text = 35,
  UniqueIdentifier = 36,
  Date = 40,
  Time = 41,
  DateTime2 = 42,
  DateTimeOffset = 43,
  TinyInt = 48,
  SmallInt = 52,
  Int = 56,
  SmallDateTime = 58,
  Real = 59,
  Money = 60,
  DateTime = 61,
  Float = 62,
  SqlVariant = 98,
  NText = 99,
  Bit = 104,
  Decimal = 106,
  Numeric = 108,
  SmallMoney = 122,
  BigInt = 127,
  VarBinary = 165,
  VarChar = 167,
  Binary = 173,
  Char = 175,
  Timestamp = 189,
  NVarChar = 231,
  NChar = 239,
  Xml = 241,
}

export interface TypeInfo {
  xtype: number;
  /** Bytes on disk for fixed types; declared byte length for strings; -1 = MAX. */
  length: number;
  precision: number;
  scale: number;
}

export const TYPE_NAMES: Record<number, string> = {
  34: 'image', 35: 'text', 36: 'uniqueidentifier', 40: 'date', 41: 'time', 42: 'datetime2',
  43: 'datetimeoffset', 48: 'tinyint', 52: 'smallint', 56: 'int', 58: 'smalldatetime', 59: 'real',
  60: 'money', 61: 'datetime', 62: 'float', 98: 'sql_variant', 99: 'ntext', 104: 'bit', 106: 'decimal',
  108: 'numeric', 122: 'smallmoney', 127: 'bigint', 165: 'varbinary', 167: 'varchar', 173: 'binary',
  175: 'char', 189: 'timestamp', 231: 'nvarchar', 239: 'nchar', 241: 'xml',
};

const FIXED_LENGTH: Record<number, number> = {
  34: 16, 35: 16, 99: 16, 36: 16, 40: 3, 48: 1, 52: 2, 56: 4, 58: 4, 59: 4, 60: 8, 61: 8, 62: 8,
  104: 1, 122: 4, 127: 8, 189: 8,
};

function decimalBytes(precision: number): number {
  return precision <= 9 ? 5 : precision <= 19 ? 9 : precision <= 28 ? 13 : 17;
}

function timeBytes(scale: number): number {
  return scale <= 2 ? 3 : scale <= 4 ? 4 : 5;
}

/** sysrscols.ti: low byte = type; the rest is length, or precision/scale. */
export function decodeTypeInfo(ti: number): TypeInfo {
  const xtype = ti & 0xff;
  const hi = ti >>> 8;
  switch (xtype) {
    case SqlType.Decimal:
    case SqlType.Numeric: {
      const precision = hi & 0xff;
      return { xtype, precision, scale: (hi >>> 8) & 0xff, length: decimalBytes(precision) };
    }
    case SqlType.Time:
    case SqlType.DateTime2:
    case SqlType.DateTimeOffset: {
      const scale = hi & 0xff;
      const extra = xtype === SqlType.Time ? 0 : xtype === SqlType.DateTime2 ? 3 : 5;
      return { xtype, precision: 0, scale, length: timeBytes(scale) + extra };
    }
    case SqlType.VarChar:
    case SqlType.Char:
    case SqlType.NVarChar:
    case SqlType.NChar:
    case SqlType.VarBinary:
    case SqlType.Binary: {
      const length = hi & 0xffff;
      return { xtype, precision: 0, scale: 0, length: length === 0 ? -1 : length };
    }
    case SqlType.Xml:
    case SqlType.SqlVariant:
      return { xtype, precision: 0, scale: 0, length: -1 };
    default:
      if (!(xtype in FIXED_LENGTH)) throw new Error(`Unsupported column type ${xtype} (ti=${ti})`);
      return { xtype, precision: 0, scale: 0, length: FIXED_LENGTH[xtype] };
  }
}

export class DecimalValue {
  constructor(
    readonly unscaled: bigint,
    readonly precision: number,
    readonly scale: number,
  ) {}
  toString(): string {
    const neg = this.unscaled < 0n;
    const digits = (neg ? -this.unscaled : this.unscaled).toString().padStart(this.scale + 1, '0');
    const int = digits.slice(0, digits.length - this.scale);
    const frac = this.scale ? `.${digits.slice(digits.length - this.scale)}` : '';
    return `${neg ? '-' : ''}${int}${frac}`;
  }
}

/** Microseconds since 1970-01-01 00:00:00 UTC (no time zone). */
export class TimestampValue {
  constructor(readonly micros: bigint) {}
  toDate(): Date {
    return new Date(Number(this.micros / 1000n));
  }
}

/** Days since 1970-01-01. */
export class DateValue {
  constructor(readonly days: number) {}
}

/** Microseconds since midnight. */
export class TimeValue {
  constructor(readonly micros: bigint) {}
}

export type SqlValue =
  | null
  | number
  | bigint
  | boolean
  | string
  | Uint8Array
  | DecimalValue
  | TimestampValue
  | DateValue
  | TimeValue;

const DAYS_1900_TO_1970 = 25_567;
const DAYS_0001_TO_1970 = 719_162;
const MICROS_PER_DAY = 86_400_000_000n;

const cp1252 = new TextDecoder('windows-1252');
const utf16 = new TextDecoder('utf-16le');

function uintLE(buf: Buffer, offset: number, length: number): bigint {
  let v = 0n;
  for (let i = length - 1; i >= 0; i--) v = (v << 8n) | BigInt(buf[offset + i]);
  return v;
}

function uuid(buf: Buffer, o: number): string {
  const h = (a: number, b: number, rev: boolean) => {
    const bytes = [...buf.subarray(o + a, o + b)];
    return (rev ? bytes.reverse() : bytes).map((x) => x.toString(16).padStart(2, '0')).join('');
  };
  return `${h(0, 4, true)}-${h(4, 6, true)}-${h(6, 8, true)}-${h(8, 10, false)}-${h(10, 16, false)}`;
}

/**
 * Time of day in microseconds. Scale-7 values (100 ns) are rounded half up,
 * as SQL Server does when casting to datetime2(6)/time(6).
 */
function timeMicros(buf: Buffer, o: number, scale: number): bigint {
  const ticks = uintLE(buf, o, timeBytes(scale));
  if (scale <= 6) return ticks * 10n ** BigInt(6 - scale);
  const div = 10n ** BigInt(scale - 6);
  return (ticks + div / 2n) / div;
}

const MAX_DATE_DAYS = 3_652_058 - DAYS_0001_TO_1970; // 9999-12-31, as days since 1970

export interface DecodeOptions {
  /** CHAR(n) is space-padded on disk; SQL Server comparisons ignore the padding. */
  trimChar?: boolean;
}

/**
 * Decodes a non-NULL, fully materialized value (in-row bytes or reassembled LOB).
 * Bit columns are handled by the caller (they share bytes).
 */
export function decodeValue(buf: Buffer, o: number, len: number, t: TypeInfo, opts: DecodeOptions = {}): SqlValue {
  switch (t.xtype) {
    case SqlType.TinyInt:
      return buf.readUInt8(o);
    case SqlType.SmallInt:
      return buf.readInt16LE(o);
    case SqlType.Int:
      return buf.readInt32LE(o);
    case SqlType.BigInt:
      return buf.readBigInt64LE(o);
    case SqlType.Real:
      return buf.readFloatLE(o);
    case SqlType.Float:
      return buf.readDoubleLE(o);
    case SqlType.Decimal:
    case SqlType.Numeric: {
      const magnitude = uintLE(buf, o + 1, len - 1);
      return new DecimalValue(buf[o] === 1 ? magnitude : -magnitude, t.precision, t.scale);
    }
    case SqlType.Money:
      // A little-endian 64-bit integer of 1/10000 units (verified against SQL Server).
      return new DecimalValue(buf.readBigInt64LE(o), 19, 4);
    case SqlType.SmallMoney:
      return new DecimalValue(BigInt(buf.readInt32LE(o)), 10, 4);
    case SqlType.DateTime: {
      // 1/300-second ticks since midnight, then days since 1900-01-01.
      const ticks = BigInt(buf.readUInt32LE(o));
      const days = BigInt(buf.readInt32LE(o + 4) - DAYS_1900_TO_1970);
      return new TimestampValue(days * MICROS_PER_DAY + (ticks * 10_000n + 1n) / 3n);
    }
    case SqlType.SmallDateTime: {
      const minutes = BigInt(buf.readUInt16LE(o));
      const days = BigInt(buf.readUInt16LE(o + 2) - DAYS_1900_TO_1970);
      return new TimestampValue(days * MICROS_PER_DAY + minutes * 60_000_000n);
    }
    case SqlType.Date:
      return new DateValue(buf.readUIntLE(o, 3) - DAYS_0001_TO_1970);
    case SqlType.Time: {
      // Rounding never wraps past midnight (SQL Server clamps to 23:59:59.999999).
      const micros = timeMicros(buf, o, t.scale);
      return new TimeValue(micros < MICROS_PER_DAY ? micros : MICROS_PER_DAY - 1n);
    }
    case SqlType.DateTime2:
    case SqlType.DateTimeOffset: {
      // datetimeoffset is stored as UTC plus the original offset; keep the UTC instant.
      // Rounding carries into the next day, except past 9999-12-31 (clamped).
      const tb = timeBytes(t.scale);
      const dayNo = buf.readUIntLE(o + tb, 3) - DAYS_0001_TO_1970;
      let micros = timeMicros(buf, o, t.scale);
      if (dayNo === MAX_DATE_DAYS && micros >= MICROS_PER_DAY) micros = MICROS_PER_DAY - 1n;
      return new TimestampValue(BigInt(dayNo) * MICROS_PER_DAY + micros);
    }
    case SqlType.UniqueIdentifier:
      return uuid(buf, o);
    case SqlType.Char: {
      const s = cp1252.decode(buf.subarray(o, o + len));
      return opts.trimChar ? s.replace(/ +$/, '') : s;
    }
    case SqlType.VarChar:
    case SqlType.Text:
      return cp1252.decode(buf.subarray(o, o + len));
    case SqlType.NChar: {
      const s = utf16.decode(buf.subarray(o, o + len));
      return opts.trimChar ? s.replace(/ +$/, '') : s;
    }
    case SqlType.NVarChar:
    case SqlType.NText:
    case SqlType.Xml:
      // XML is stored in a binary format; surfacing it raw would be misleading.
      if (t.xtype === SqlType.Xml) throw new Error('xml columns are not supported');
      return utf16.decode(buf.subarray(o, o + len));
    case SqlType.Binary:
    case SqlType.VarBinary:
    case SqlType.Image:
    case SqlType.Timestamp:
    case SqlType.SqlVariant:
      return new Uint8Array(buf.subarray(o, o + len));
    default:
      throw new Error(`Unsupported column type ${t.xtype}`);
  }
}

/**
 * sql_variant as stored on disk: [baseType][version][properties][value].
 * Properties: max length (2) + collation (4) for strings, max length for
 * binaries, precision + scale for decimals, scale for time types.
 */
export function decodeSqlVariant(buf: Buffer, o: number, len: number): SqlValue {
  const xtype = buf[o];
  let p = o + 2;
  let t: TypeInfo;
  switch (xtype) {
    case SqlType.Char:
    case SqlType.VarChar:
    case SqlType.NChar:
    case SqlType.NVarChar:
      t = { xtype, length: buf.readUInt16LE(p), precision: 0, scale: 0 };
      p += 6;
      break;
    case SqlType.Binary:
    case SqlType.VarBinary:
      t = { xtype, length: buf.readUInt16LE(p), precision: 0, scale: 0 };
      p += 2;
      break;
    case SqlType.Decimal:
    case SqlType.Numeric:
      t = { xtype, precision: buf[p], scale: buf[p + 1], length: decimalBytes(buf[p]) };
      p += 2;
      break;
    case SqlType.Time:
    case SqlType.DateTime2:
    case SqlType.DateTimeOffset:
      t = decodeTypeInfo(xtype | (buf[p] << 8));
      p += 1;
      break;
    default:
      t = decodeTypeInfo(xtype);
  }
  const valueLength = o + len - p;
  if (t.xtype === SqlType.Bit) return buf[p] !== 0;
  return decodeValue(buf, p, valueLength, t, { trimChar: true });
}
