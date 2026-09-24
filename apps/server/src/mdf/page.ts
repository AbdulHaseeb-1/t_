/**
 * SQL Server data-file pages: 8 KB, a 96-byte header, records, and a slot
 * array growing backwards from the end of the page.
 */
export const PAGE_SIZE = 8192;
export const HEADER_SIZE = 96;

export const enum PageType {
  Data = 1,
  Index = 2,
  TextMix = 3,
  TextTree = 4,
  Gam = 8,
  Sgam = 9,
  Iam = 10,
  Pfs = 11,
  Boot = 13,
  FileHeader = 15,
}

export interface PageId {
  file: number;
  page: number;
}

/** 6-byte page pointer: 4-byte page number, 2-byte file id (little-endian). */
export function readPageId(buf: Buffer, offset: number): PageId {
  return { page: buf.readUInt32LE(offset), file: buf.readUInt16LE(offset + 4) };
}

export const isNullPage = (p: PageId) => p.page === 0 && p.file === 0;

export interface PageHeader {
  type: number;
  level: number;
  indexId: number;
  objId: number;
  slotCount: number;
  prev: PageId;
  next: PageId;
  self: PageId;
  /** Allocation unit id the page belongs to: (m_indexId << 48) | (m_objId << 16). */
  allocUnitId: bigint;
}

export function readHeader(buf: Buffer): PageHeader {
  const indexId = buf.readUInt16LE(6);
  const objId = buf.readUInt32LE(24);
  return {
    type: buf[1],
    level: buf[3],
    indexId,
    objId,
    prev: readPageId(buf, 8),
    next: readPageId(buf, 16),
    slotCount: buf.readUInt16LE(22),
    self: readPageId(buf, 32),
    allocUnitId: (BigInt(indexId) << 48n) | (BigInt(objId) << 16n),
  };
}

/** Byte offset of record `slot` within the page (0 = empty/deleted slot). */
export function slotOffset(buf: Buffer, slot: number): number {
  return buf.readUInt16LE(PAGE_SIZE - 2 * (slot + 1));
}
