import type { ColumnDef, TableDef } from './catalog.js';
import { LobReader } from './lob.js';
import type { MdfFile } from './mdf-file.js';
import type { RecordView } from './record.js';
import { decodeValue, type DecodeOptions, SqlType, type SqlValue } from './types.js';

const TEXT_POINTER_TYPES = new Set<number>([SqlType.Text, SqlType.NText, SqlType.Image]);

/**
 * Streams a table's rows as arrays aligned with `columns` (stored columns only;
 * non-persisted computed columns are returned as null and filled in later).
 */
export class TableReader {
  private readonly lob: LobReader;

  constructor(
    private readonly file: MdfFile,
    readonly table: TableDef,
    readonly columns: ColumnDef[] = table.columns,
    private readonly opts: DecodeOptions = { trimChar: true },
  ) {
    this.lob = new LobReader(file);
  }

  *rows(): Generator<SqlValue[]> {
    const inRow = this.table.allocUnits.find((a) => a.type === 1);
    if (!inRow) return;
    for (const rec of this.file.records(inRow.id, inRow.firstIam)) {
      yield this.columns.map((c) => (c.computed ? null : this.value(rec, c)));
    }
  }

  private value(rec: RecordView, c: ColumnDef): SqlValue {
    const p = c.physical!;
    // Records written before the column was added don't carry it: the value
    // is the column's metadata default, or NULL.
    if (p.nullBit > rec.columnCount) return p.defaultValue ?? null;
    if (rec.isNull(p.nullBit)) return null;
    const t = p.type;
    if (t.xtype === SqlType.Bit) return ((rec.buf[rec.start + p.leafOffset] >> p.bitPos) & 1) === 1;
    if (p.leafOffset > 0) return decodeValue(rec.buf, rec.start + p.leafOffset, t.length, t, this.opts);

    const v = rec.varColumn(-p.leafOffset);
    // Trailing empty variable columns may be omitted from the record.
    if (!v) return decodeValue(Buffer.alloc(0), 0, 0, t, this.opts);
    if (!v.complex) return decodeValue(rec.buf, v.offset, v.length, t, this.opts);
    const data = TEXT_POINTER_TYPES.has(t.xtype)
      ? this.lob.readTextPointer(rec.buf, v.offset)
      : this.lob.readComplex(rec.buf, v.offset, v.length);
    return decodeValue(data, 0, data.length, t, this.opts);
  }
}
