import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderTable } from './schema-renderer.js';
import { applySchemaNotes, loadSchemaNotes } from './schema-notes.js';
import type { TableInfo } from './schema.types.js';

const view: TableInfo = {
  id: 'dbo.uvSaleInvoice',
  schema: 'dbo',
  name: 'uvSaleInvoice',
  kind: 'view',
  columns: [
    { name: 'inv_no', type: 'int', nullable: false, pk: false, identity: false },
    { name: 'net_amt', type: 'decimal(15,2)', nullable: true, pk: false, identity: false, description: 'Net' },
  ],
};

function notesFile(content: unknown): string {
  const file = join(mkdtempSync(join(tmpdir(), 'notes-')), 'notes.json');
  writeFileSync(file, JSON.stringify(content));
  return file;
}

describe('schema notes', () => {
  it('annotates tables and columns case-insensitively, appending to database descriptions', () => {
    const notes = loadSchemaNotes(
      notesFile({
        $comment: 'ignored',
        'DBO.UVSALEINVOICE': 'One row per invoice line.',
        'dbo.uvSaleInvoice.NET_AMT': 'Invoice total repeated on every line; never SUM here.',
      }),
    );
    const [t] = applySchemaNotes([view], notes);
    expect(renderTable(t)).toBe(
      'dbo.uvSaleInvoice (view) -- One row per invoice line. | inv_no int, net_amt decimal(15,2) "Net Invoice total repeated on every line; never SUM here."',
    );
  });

  it('is a no-op without a file', () => {
    expect(applySchemaNotes([view], loadSchemaNotes(''))[0]).toBe(view);
  });

  it('fails fast on malformed JSON', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'notes-')), 'bad.json');
    writeFileSync(file, '{ nope');
    expect(() => loadSchemaNotes(file)).toThrow();
  });
});
