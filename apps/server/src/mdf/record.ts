/**
 * FixedVar record format (SQL Server 2005+):
 *
 *   [statusA][statusB][fixedEnd:2][fixed-length data ...]
 *   [columnCount:2][null bitmap: ceil(columnCount / 8)]
 *   [varCount:2][varEnd:2 x varCount][variable-length data ...]
 *
 * Variable column end offsets are relative to the record start; the high bit
 * marks a "complex" column (an off-row LOB or row-overflow pointer).
 */
export const enum RecordType {
  Primary = 0,
  Forwarded = 1,
  ForwardingStub = 2,
  Index = 3,
  BlobFragment = 4,
  GhostIndex = 5,
  GhostData = 6,
  GhostVersion = 7,
}

export interface VarColumn {
  offset: number;
  length: number;
  complex: boolean;
}

export class RecordView {
  readonly type: RecordType;
  readonly fixedEnd: number;
  readonly columnCount: number;
  private readonly nullBitmap: number;
  private readonly varEnds: number[] = [];
  private readonly varDataStart: number;

  constructor(
    readonly buf: Buffer,
    readonly start: number,
  ) {
    const statusA = buf[start];
    this.type = (statusA >> 1) & 7;
    const hasNullBitmap = (statusA & 0x10) !== 0;
    const hasVar = (statusA & 0x20) !== 0;
    this.fixedEnd = buf.readUInt16LE(start + 2);
    let p = start + this.fixedEnd;
    this.columnCount = buf.readUInt16LE(p);
    p += 2;
    this.nullBitmap = hasNullBitmap ? p : -1;
    if (hasNullBitmap) p += Math.ceil(this.columnCount / 8);
    if (hasVar) {
      const count = buf.readUInt16LE(p);
      p += 2;
      for (let i = 0; i < count; i++) this.varEnds.push(buf.readUInt16LE(p + 2 * i));
      p += 2 * count;
    }
    this.varDataStart = p;
  }

  /** `bit` is the 1-based leaf null bit from the column metadata. */
  isNull(bit: number): boolean {
    if (this.nullBitmap < 0) return false;
    const i = bit - 1;
    return (this.buf[this.nullBitmap + (i >> 3)] & (1 << (i & 7))) !== 0;
  }

  get varCount(): number {
    return this.varEnds.length;
  }

  /** 1-based variable column; undefined when the record predates the column or it was trimmed. */
  varColumn(index: number): VarColumn | undefined {
    if (index > this.varEnds.length) return undefined;
    const raw = this.varEnds[index - 1];
    const end = this.start + (raw & 0x7fff);
    const begin = index === 1 ? this.varDataStart : this.start + (this.varEnds[index - 2] & 0x7fff);
    return { offset: begin, length: end - begin, complex: (raw & 0x8000) !== 0 };
  }
}
