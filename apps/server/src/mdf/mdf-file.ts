import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { HEADER_SIZE, isNullPage, PAGE_SIZE, type PageHeader, type PageId, PageType, readHeader, readPageId, slotOffset } from './page.js';
import { RecordView } from './record.js';

const CACHE_PAGES = 4096; // 32 MB

export interface Page {
  id: number;
  buf: Buffer;
  header: PageHeader;
}

/**
 * Read-only access to a primary data file (.mdf). The file is opened with
 * O_RDONLY and nothing is ever written to it.
 */
export class MdfFile {
  private readonly fd: number;
  readonly pageCount: number;
  private readonly cache = new Map<number, Page>();

  constructor(readonly path: string) {
    this.fd = openSync(path, 'r');
    const size = fstatSync(this.fd).size;
    if (size % PAGE_SIZE !== 0) throw new Error(`${path}: size ${size} is not a multiple of 8 KB; not a data file`);
    this.pageCount = size / PAGE_SIZE;
    const header = this.page(0).header;
    if (header.type !== PageType.FileHeader) throw new Error(`${path}: page 0 is not a file header page`);
  }

  close(): void {
    closeSync(this.fd);
  }

  page(id: number | PageId): Page {
    const pid = typeof id === 'number' ? id : this.local(id);
    const hit = this.cache.get(pid);
    if (hit) {
      // refresh LRU position
      this.cache.delete(pid);
      this.cache.set(pid, hit);
      return hit;
    }
    if (pid < 0 || pid >= this.pageCount) throw new Error(`Page ${pid} is outside the file (${this.pageCount} pages)`);
    const buf = Buffer.allocUnsafe(PAGE_SIZE);
    const read = readSync(this.fd, buf, 0, PAGE_SIZE, pid * PAGE_SIZE);
    if (read !== PAGE_SIZE) throw new Error(`Short read at page ${pid}`);
    const page = { id: pid, buf, header: readHeader(buf) };
    this.cache.set(pid, page);
    if (this.cache.size > CACHE_PAGES) this.cache.delete(this.cache.keys().next().value!);
    return page;
  }

  /** Only single-file databases are supported (all pages in file 1). */
  private local(id: PageId): number {
    if (id.file !== 1) throw new Error(`Page (${id.file}:${id.page}) lives in secondary file ${id.file}; only the primary .mdf is available`);
    return id.page;
  }

  /**
   * Every page allocated to an allocation unit, from its IAM chain: the eight
   * single-page (mixed extent) slots plus every uniform extent set in the
   * bitmap of each 4 GB interval.
   */
  allocatedPages(firstIam: PageId): number[] {
    const pages = new Set<number>();
    let iamId = firstIam;
    const seen = new Set<number>();
    while (!isNullPage(iamId)) {
      const iam = this.page(iamId);
      if (iam.header.type !== PageType.Iam) throw new Error(`Page ${iam.id} is not an IAM page (type ${iam.header.type})`);
      if (seen.has(iam.id)) throw new Error(`IAM chain loops at page ${iam.id}`);
      seen.add(iam.id);
      // Slot 0: 4-byte record header, then the IAM header; start page of the
      // 4 GB interval at +40, eight single-page slots from +46.
      const hdr = slotOffset(iam.buf, 0);
      const startPage = readPageId(iam.buf, hdr + 40).page;
      for (let i = 0; i < 8; i++) {
        const single = readPageId(iam.buf, hdr + 46 + i * 6);
        if (!isNullPage(single)) pages.add(this.local(single));
      }
      const bitmap = slotOffset(iam.buf, 1) + 4;
      const bitmapEnd = PAGE_SIZE - 2 * iam.header.slotCount;
      for (let byte = bitmap; byte < bitmapEnd; byte++) {
        const bits = iam.buf[byte];
        if (!bits) continue;
        for (let b = 0; b < 8; b++) {
          if (!(bits & (1 << b))) continue;
          const extent = (byte - bitmap) * 8 + b;
          const first = startPage + extent * 8;
          for (let p = 0; p < 8; p++) if (first + p < this.pageCount) pages.add(first + p);
        }
      }
      iamId = iam.header.next;
    }
    return [...pages].sort((a, b) => a - b);
  }

  /**
   * Live data records of an allocation unit: primary and forwarded rows.
   * Forwarding stubs are skipped (their target is read where it lives) and
   * ghost (deleted) rows are ignored.
   */
  *records(allocUnitId: bigint, firstIam: PageId): Generator<RecordView> {
    for (const id of this.allocatedPages(firstIam)) {
      const page = this.page(id);
      // Extents can hold pages of other units (mixed extents) or index pages.
      if (page.header.type !== PageType.Data || page.header.allocUnitId !== allocUnitId) continue;
      yield* this.pageRecords(page);
    }
  }

  *pageRecords(page: Page): Generator<RecordView> {
    for (let slot = 0; slot < page.header.slotCount; slot++) {
      const off = slotOffset(page.buf, slot);
      if (off < HEADER_SIZE) continue; // deleted slot
      const rec = new RecordView(page.buf, off);
      if (rec.type === 0 || rec.type === 1) yield rec;
    }
  }

  /** Records along a leaf-level page chain (used only to bootstrap sysallocunits). */
  *chainRecords(first: PageId): Generator<RecordView> {
    let id = first;
    const seen = new Set<number>();
    while (!isNullPage(id)) {
      const page = this.page(id);
      if (seen.has(page.id)) throw new Error(`Page chain loops at ${page.id}`);
      seen.add(page.id);
      yield* this.pageRecords(page);
      id = page.header.next;
    }
  }
}
