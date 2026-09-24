import { type PageId, PageType, readPageId } from './page.js';
import type { MdfFile } from './mdf-file.js';
import type { RecordView } from './record.js';
import { decodeSqlVariant, decodeTypeInfo, decodeValue, SqlType, type SqlValue, type TypeInfo } from './types.js';

/** Physical column of a rowset (sysrscols). */
export interface PhysicalColumn {
  rscolid: number;
  hbcolid: number;
  /** Value for rows written before the column was added (metadata-only ADD ... DEFAULT). */
  defaultValue?: SqlValue;
  type: TypeInfo;
  /** > 0: byte offset in the fixed area; < 0: -(1-based variable column index). */
  leafOffset: number;
  nullBit: number;
  bitPos: number;
  dropped: boolean;
  nullable: boolean;
  uniqueifier: boolean;
  sparse: boolean;
}

export interface AllocUnit {
  id: bigint;
  /** 1 = IN_ROW_DATA, 2 = LOB_DATA, 3 = ROW_OVERFLOW_DATA */
  type: number;
  rowsetId: bigint;
  firstIam: PageId;
  first: PageId;
}

export interface ColumnDef {
  colid: number;
  name: string;
  type: TypeInfo;
  nullable: boolean;
  /** T-SQL expression of a non-persisted computed column (not stored in the file). */
  computed?: string;
  collation?: number;
  physical?: PhysicalColumn;
}

export interface ForeignKey {
  name: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
}

export interface TableDef {
  objectId: number;
  schema: string;
  name: string;
  columns: ColumnDef[];
  heap: boolean;
  rowsetId: bigint;
  allocUnits: AllocUnit[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
}

type Row = Map<number, SqlValue>;

/** Fixed system object ids (stable since SQL Server 2005). */
const SYS = {
  sysseobjvalues: 9,
  sysrscols: 3n << 16n,
  sysrowsets: 5n << 16n,
  sysallocunits: 7n << 16n,
  sysschobjs: 34,
  syscolpars: 41,
  sysidxstats: 54,
  sysiscols: 55,
  sysobjvalues: 60,
  sysclsobjs: 64,
  syssingleobjrefs: 74,
};

const BOOT_PAGE = 9;
/** dbi_firstSysIndexes: first page of sysallocunits, in the boot page. */
const BOOT_FIRST_SYSINDEXES = 612;
/** Oldest on-disk format this reader was validated against (SQL Server 2016 = 852). */
const MIN_VERSION = 852;

// Bootstrap layouts: these two tables describe everything else, so their own
// layout has to be known up front (verified against SQL Server 2016 and 2022).
const sysallocunitsLayout = {
  auid: 4, type: 12, ownerid: 13, pgfirst: 27, pgroot: 33, pgfirstiam: 39,
};
const sysrscolsLayout = {
  rsid: 4, rscolid: 12, hbcolid: 16, ti: 28, status: 40, offset: 44, nullbit: 48, bitpos: 52,
};

const asNumber = (v: SqlValue) => (typeof v === 'bigint' ? Number(v) : (v as number));
const asBig = (v: SqlValue) => (typeof v === 'bigint' ? v : BigInt(v as number));
const asText = (v: SqlValue) => (v == null ? '' : typeof v === 'string' ? v : Buffer.from(v as Uint8Array).toString('latin1'));

export class Catalog {
  readonly version: number;
  readonly databaseName: string;
  private readonly allocUnits: AllocUnit[] = [];
  private readonly layouts = new Map<bigint, PhysicalColumn[]>();

  constructor(private readonly file: MdfFile) {
    const boot = file.page(BOOT_PAGE);
    if (boot.header.type !== PageType.Boot) throw new Error('Page 9 is not the boot page; not a SQL Server primary data file');
    const bootRec = boot.buf.readUInt16LE(8190);
    this.version = boot.buf.readUInt16LE(bootRec + 4);
    if (this.version < MIN_VERSION) {
      throw new Error(`Database format ${this.version} is older than SQL Server 2016 (${MIN_VERSION}); attach it to SQL Server once to upgrade it`);
    }
    // dbi_dbname: nchar(128) right after the fixed boot fields
    this.databaseName = Buffer.from(boot.buf.subarray(bootRec + 52, bootRec + 52 + 256)).toString('utf16le').replace(/\0.*$/s, '').trim();
    this.loadAllocUnits(readPageId(boot.buf, BOOT_FIRST_SYSINDEXES));
    this.loadRscols();
    this.loadDefaults();
  }

  /** sysseobjvalues class 1: out-of-row defaults, keyed by rowset and hbcolid. */
  private loadDefaults(): void {
    // valclass(1) id(2) subid(3) valnum(4) value(5)
    for (const r of this.rows(SYS.sysseobjvalues)) {
      if (asNumber(r.get(1)!) !== 1 || asNumber(r.get(4)!) !== 0) continue;
      const col = this.layouts.get(asBig(r.get(2)!))?.find((c) => c.hbcolid === asNumber(r.get(3)!));
      const raw = r.get(5);
      if (!col || !(raw instanceof Uint8Array)) continue;
      const buf = Buffer.from(raw);
      col.defaultValue = decodeSqlVariant(buf, 0, buf.length);
    }
  }

  private loadAllocUnits(first: PageId): void {
    const L = sysallocunitsLayout;
    for (const r of this.file.chainRecords(first)) {
      const b = r.buf;
      const s = r.start;
      this.allocUnits.push({
        id: b.readBigUInt64LE(s + L.auid),
        type: b[s + L.type],
        rowsetId: b.readBigUInt64LE(s + L.ownerid),
        first: readPageId(b, s + L.pgfirst),
        firstIam: readPageId(b, s + L.pgfirstiam),
      });
    }
    if (!this.allocUnits.some((a) => a.id === SYS.sysallocunits)) throw new Error('sysallocunits could not be read from the boot page pointer');
  }

  private inRowUnit(rowsetId: bigint): AllocUnit {
    const au = this.allocUnits.find((a) => a.rowsetId === rowsetId && a.type === 1);
    if (!au) throw new Error(`No in-row allocation unit for rowset ${rowsetId}`);
    return au;
  }

  unitsOf(rowsetId: bigint): AllocUnit[] {
    return this.allocUnits.filter((a) => a.rowsetId === rowsetId);
  }

  private loadRscols(): void {
    const L = sysrscolsLayout;
    const au = this.inRowUnit(SYS.sysrscols);
    for (const r of this.file.records(au.id, au.firstIam)) {
      const b = r.buf;
      const s = r.start;
      const status = b.readUInt32LE(s + L.status);
      const col: PhysicalColumn = {
        rscolid: b.readUInt32LE(s + L.rscolid),
        hbcolid: b.readUInt32LE(s + L.hbcolid),
        type: decodeTypeInfo(b.readUInt32LE(s + L.ti)),
        leafOffset: b.readInt16LE(s + L.offset),
        nullBit: b.readInt16LE(s + L.nullbit),
        bitPos: b[s + L.bitpos],
        dropped: (status & 2) !== 0,
        nullable: (status & 128) === 0,
        uniqueifier: (status & 16) !== 0,
        sparse: (status & 0x100) !== 0,
      };
      const rsid = b.readBigUInt64LE(s + L.rsid);
      const list = this.layouts.get(rsid) ?? [];
      list.push(col);
      this.layouts.set(rsid, list);
    }
  }

  layout(rowsetId: bigint): PhysicalColumn[] {
    const l = this.layouts.get(rowsetId);
    if (!l) throw new Error(`No column layout for rowset ${rowsetId}`);
    return l;
  }

  /** All rows of a system rowset, keyed by rscolid (in-row values only). */
  private *systemRows(rowsetId: bigint): Generator<Row> {
    const au = this.inRowUnit(rowsetId);
    const cols = this.layout(rowsetId).filter((c) => !c.dropped);
    for (const rec of this.file.records(au.id, au.firstIam)) {
      const row: Row = new Map();
      for (const c of cols) row.set(c.rscolid, readInRow(rec, c));
      yield row;
    }
  }

  private rowsetOf(objectId: number, indexId = 1): bigint {
    const hit = this.rowsets().find((r) => r.idmajor === objectId && r.idminor === indexId);
    if (!hit) throw new Error(`No rowset for object ${objectId} index ${indexId}`);
    return hit.rowsetId;
  }

  private rowsetCache?: { rowsetId: bigint; idmajor: number; idminor: number; compression: number }[];
  private rowsets() {
    // sysrowsets: rowsetid(1) ownertype(2) idmajor(3) idminor(4) numpart(5) status(6) fgidfs(7) rcrows(8) cmprlevel(9)
    this.rowsetCache ??= [...this.systemRows(SYS.sysrowsets)].map((r) => ({
      rowsetId: asBig(r.get(1)!),
      idmajor: asNumber(r.get(3)!),
      idminor: asNumber(r.get(4)!),
      compression: asNumber(r.get(9) ?? 0),
    }));
    return this.rowsetCache;
  }

  private rows(objectId: number): Row[] {
    return [...this.systemRows(this.rowsetOf(objectId))];
  }

  /** User tables with columns, physical layouts, keys and computed-column formulas. */
  tables(): TableDef[] {
    // sysclsobjs: class(1) id(2) name(3) -- class 50 = schema
    const schemas = new Map<number, string>();
    for (const r of this.rows(SYS.sysclsobjs)) if (asNumber(r.get(1)!) === 50) schemas.set(asNumber(r.get(2)!), asText(r.get(3)!));

    // sysschobjs: id(1) name(2) nsid(3) nsclass(4) status(5) type(6) pid(7)
    const objects = this.rows(SYS.sysschobjs).map((r) => ({
      id: asNumber(r.get(1)!),
      name: asText(r.get(2)!),
      schemaId: asNumber(r.get(3)!),
      type: asText(r.get(6)!).trim(),
      parent: asNumber(r.get(7)!),
      msShipped: (asNumber(r.get(5)!) & 1) !== 0,
    }));
    const byId = new Map(objects.map((o) => [o.id, o]));

    // syscolpars: id(1) number(2) colid(3) name(4) xtype(5) utype(6) length(7) prec(8) scale(9) collationid(10) status(11)
    const colpars = this.rows(SYS.syscolpars).filter((r) => asNumber(r.get(2)!) === 0);
    // sysobjvalues: valclass(1) objid(2) subobjid(3) valnum(4) value(5) imageval(6); class 2 = computed text
    const computedText = new Map<string, string>();
    for (const r of this.rows(SYS.sysobjvalues)) {
      if (asNumber(r.get(1)!) === 2 && asNumber(r.get(4)!) === 0 && r.get(6) != null) {
        computedText.set(`${asNumber(r.get(2)!)}:${asNumber(r.get(3)!)}`, asText(r.get(6)!));
      }
    }
    // sysidxstats: id(1) indid(2) name(3) status(4); sysiscols: idmajor(1) idminor(2) subid(3) status(4) intprop(5) tinyprop1(6)
    const pkIndex = new Map<number, number>();
    for (const r of this.rows(SYS.sysidxstats)) if (asNumber(r.get(4)!) & 0x20) pkIndex.set(asNumber(r.get(1)!), asNumber(r.get(2)!));
    const indexCols = this.rows(SYS.sysiscols);
    // syssingleobjrefs: class(1) depid(2) depsubid(3) indepid(4) indepsubid(5); 28 = FK parent col, 29 = FK referenced col
    const refs = this.rows(SYS.syssingleobjrefs);

    const tables: TableDef[] = [];
    // Microsoft-shipped tables (e.g. trace_xe_*) have no storage in the file.
    for (const o of objects.filter((x) => x.type === 'U' && x.id > 0 && !x.msShipped)) {
      const indexId = this.rowsets().some((r) => r.idmajor === o.id && r.idminor === 1) ? 1 : 0;
      const rowsetId = this.rowsetOf(o.id, indexId);
      // Formats this reader does not decode: refuse rather than return wrong data.
      const compression = this.rowsets().find((r) => r.rowsetId === rowsetId)!.compression;
      if (compression !== 0) {
        throw new Error(`Table ${o.name} uses ${compression === 1 ? 'ROW' : compression === 2 ? 'PAGE' : 'columnstore'} compression, which this reader does not support; rebuild it with DATA_COMPRESSION = NONE`);
      }
      const layout = this.layout(rowsetId);
      if (layout.some((c) => c.sparse)) throw new Error(`Table ${o.name} has sparse columns, which this reader does not support`);
      const physical = new Map(layout.filter((c) => !c.dropped && !c.uniqueifier).map((c) => [c.rscolid, c]));
      const colName = new Map<number, string>();
      const columns: ColumnDef[] = colpars
        .filter((r) => asNumber(r.get(1)!) === o.id)
        .sort((a, b) => asNumber(a.get(3)!) - asNumber(b.get(3)!))
        .map((r) => {
          const colid = asNumber(r.get(3)!);
          const status = asNumber(r.get(11)!);
          const name = asText(r.get(4)!);
          colName.set(colid, name);
          const phys = physical.get(colid);
          const isComputed = (status & 16) !== 0 && !phys;
          const xtype = asNumber(r.get(5)!);
          const length = asNumber(r.get(7)!);
          const type: TypeInfo = phys?.type ?? {
            xtype,
            length,
            precision: asNumber(r.get(8)!),
            scale: asNumber(r.get(9)!),
          };
          const col: ColumnDef = { colid, name, type, nullable: (status & 1) === 0, physical: phys, collation: asNumber(r.get(10)!) };
          if (isComputed) {
            const text = computedText.get(`${o.id}:${colid}`);
            if (!text) throw new Error(`Computed column ${o.name}.${name} has no stored definition`);
            col.computed = text;
          } else if (!phys) {
            throw new Error(`Column ${o.name}.${name} has no physical storage`);
          }
          return col;
        });

      const pkId = pkIndex.get(o.id);
      const primaryKey =
        pkId === undefined
          ? []
          : indexCols
              .filter((r) => asNumber(r.get(1)!) === o.id && asNumber(r.get(2)!) === pkId && asNumber(r.get(4)!) & 2 && !(asNumber(r.get(4)!) & 0x10))
              .sort((a, b) => asNumber(a.get(6)!) - asNumber(b.get(6)!))
              .map((r) => colName.get(asNumber(r.get(5)!))!);

      tables.push({
        objectId: o.id,
        schema: schemas.get(o.schemaId) ?? 'dbo',
        name: o.name,
        columns,
        heap: indexId === 0,
        rowsetId,
        allocUnits: this.unitsOf(rowsetId),
        primaryKey,
        foreignKeys: [],
      });
    }

    // Foreign keys, resolved to names once all tables are known.
    const tableById = new Map(tables.map((t) => [t.objectId, t]));
    for (const fk of objects.filter((x) => x.type === 'F')) {
      const parent = tableById.get(fk.parent);
      const mine = (cls: number) =>
        refs.filter((r) => asNumber(r.get(1)!) === cls && asNumber(r.get(2)!) === fk.id).sort((a, b) => asNumber(a.get(3)!) - asNumber(b.get(3)!));
      const from = mine(28);
      const to = mine(29);
      if (!parent || !from.length || from.length !== to.length) continue;
      const ref = tableById.get(asNumber(to[0].get(4)!));
      if (!ref) continue;
      const nameOf = (t: TableDef, colid: number) => t.columns.find((c) => c.colid === colid)?.name ?? `col${colid}`;
      parent.foreignKeys.push({
        name: fk.name,
        columns: from.map((r) => nameOf(parent, asNumber(r.get(5)!))),
        refTable: `${ref.schema}.${ref.name}`,
        refColumns: to.map((r) => nameOf(ref, asNumber(r.get(5)!))),
      });
    }
    void byId;
    return tables.sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`));
  }
}

/** In-row value of a column (system tables have no off-row data). */
export function readInRow(rec: RecordView, c: PhysicalColumn): SqlValue {
  if (c.nullBit > rec.columnCount) return null;
  if (rec.isNull(c.nullBit)) return null;
  if (c.type.xtype === SqlType.Bit) return ((rec.buf[rec.start + c.leafOffset] >> c.bitPos) & 1) === 1;
  if (c.leafOffset > 0) return decodeValue(rec.buf, rec.start + c.leafOffset, c.type.length, c.type);
  const v = rec.varColumn(-c.leafOffset);
  if (!v) return c.type.xtype === SqlType.VarBinary ? new Uint8Array() : '';
  // Off-row values (e.g. statistics blobs) are never needed from system tables;
  // callers that do need a value fail explicitly when it is missing.
  if (v.complex) return null;
  return decodeValue(rec.buf, v.offset, v.length, c.type);
}
