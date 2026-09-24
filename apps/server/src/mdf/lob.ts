import { type PageId, readPageId, slotOffset } from './page.js';
import type { MdfFile } from './mdf-file.js';

/**
 * Off-row values: MAX types (varchar/nvarchar/varbinary(max)) and legacy
 * text/ntext/image. All are trees of LOB fragments on text pages:
 *
 *   fragment = [statusA][statusB][length:2][blobId:8][type:2] + body
 *     type 0 SMALL_ROOT        [dataLength:2][unused:4][data]
 *     type 2 INTERNAL          [maxLinks:2][curLinks:2][level:2], links of [cumulativeSize:8][rowId:8]
 *     type 3 DATA              [data]
 *     type 5 LARGE_ROOT_YUKON  [maxLinks:2][curLinks:2][level:2][unused:4], links of [cumulativeSize:4][rowId:8]
 *
 * In-row pointers:
 *   MAX types, "inline root" (first byte 4): [4][?][level][?][updateSeq:4][blobId:4], links of [cumulativeSize:4][rowId:8]
 *   row-overflow (first byte 2): [2][level][?][?][updateSeq:4][blobId:4][length:4][rowId:8]
 *   text/ntext/image: 16-byte text pointer [timestamp:8][rowId:8] to a root fragment
 */
const enum Fragment {
  SmallRoot = 0,
  Internal = 2,
  Data = 3,
  LargeRootYukon = 5,
}

interface RowId {
  page: PageId;
  slot: number;
}

const readRowId = (buf: Buffer, o: number): RowId => ({ page: readPageId(buf, o), slot: buf.readUInt16LE(o + 6) });

export class LobReader {
  constructor(private readonly file: MdfFile) {}

  /** In-row "complex" column bytes -> the full value. */
  readComplex(buf: Buffer, offset: number, length: number): Buffer {
    const kind = buf[offset];
    if (kind === 4) {
      // BLOB inline root: 12-byte header, then 12-byte links.
      const parts: Buffer[] = [];
      let expected = 0;
      for (let o = offset + 12; o + 12 <= offset + length; o += 12) {
        expected = buf.readUInt32LE(o);
        parts.push(this.readNode(readRowId(buf, o + 4)));
      }
      return this.checked(Buffer.concat(parts), expected);
    }
    if (kind === 2 && length >= 24) {
      // Row-overflow pointer: one DATA fragment.
      const expected = buf.readUInt32LE(offset + 12);
      return this.checked(this.readNode(readRowId(buf, offset + 16)), expected);
    }
    throw new Error(`Unknown off-row pointer type ${kind} (${length} bytes)`);
  }

  /** 16-byte text pointer (text, ntext, image) -> the full value. */
  readTextPointer(buf: Buffer, offset: number): Buffer {
    return this.readNode(readRowId(buf, offset + 8));
  }

  private checked(data: Buffer, expected: number): Buffer {
    if (data.length !== expected) throw new Error(`LOB length mismatch: read ${data.length} bytes, pointer says ${expected}`);
    return data;
  }

  private readNode(id: RowId, depth = 0): Buffer {
    if (depth > 16) throw new Error('LOB tree deeper than 16 levels');
    const page = this.file.page(id.page);
    if (id.slot >= page.header.slotCount) throw new Error(`LOB slot ${id.slot} missing on page ${page.id}`);
    const o = slotOffset(page.buf, id.slot);
    const buf = page.buf;
    const recLength = buf.readUInt16LE(o + 2);
    const type = buf.readUInt16LE(o + 12);
    switch (type) {
      case Fragment.Data:
        return Buffer.from(buf.subarray(o + 14, o + recLength));
      case Fragment.SmallRoot: {
        const len = buf.readUInt16LE(o + 14);
        return Buffer.from(buf.subarray(o + 20, o + 20 + len));
      }
      case Fragment.Internal: {
        const count = buf.readUInt16LE(o + 16);
        const parts: Buffer[] = [];
        let expected = 0;
        for (let i = 0; i < count; i++) {
          const l = o + 20 + i * 16;
          expected = Number(buf.readBigUInt64LE(l));
          parts.push(this.readNode(readRowId(buf, l + 8), depth + 1));
        }
        return this.checked(Buffer.concat(parts), expected);
      }
      case Fragment.LargeRootYukon: {
        const count = buf.readUInt16LE(o + 16);
        const parts: Buffer[] = [];
        let expected = 0;
        for (let i = 0; i < count; i++) {
          const l = o + 24 + i * 12;
          expected = buf.readUInt32LE(l);
          parts.push(this.readNode(readRowId(buf, l + 4), depth + 1));
        }
        return this.checked(Buffer.concat(parts), expected);
      }
      default:
        throw new Error(`Unknown LOB fragment type ${type} on page ${page.id}`);
    }
  }
}
