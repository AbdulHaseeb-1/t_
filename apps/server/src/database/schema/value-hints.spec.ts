import { hintCandidates, toHint } from './value-hints.js';
import type { TableInfo } from './schema.types.js';

const EXCLUDE =
  'name|mail|email|phone|ph|cell|mobile|tel|fax|address|addr|street|zip|postal|ssn|cnic|nic|passport|password|pwd|token|secret|iban|card|account|acc|birth|dob|salary|note|notes|comment|remarks|description|desc|url|ip|loc|location|gps|lat|lng|lon|cheque|chq|insr|updt|by|user|contact';

const col = (name: string, type = 'varchar(20)') => ({ name, type, nullable: true, pk: false, identity: false });

describe('value hints privacy', () => {
  const table: TableInfo = {
    id: 'dbo.Customer',
    schema: 'dbo',
    name: 'Customer',
    kind: 'table',
    rowCount: 100,
    columns: ['catagory', 'cust_cell', 'comp_ph', 'Loc', 'Cheque_No', 'insr_by', 'updt_by', 'closing_month', 'prod_group', 'cust_name'].map((n) => col(n)),
  };

  it('never samples columns whose names mark personal data', () => {
    const picked = hintCandidates([table], { maxDistinct: 25, maxTableRows: 1e6, maxColumns: 100, exclude: EXCLUDE }).map((c) => c.column.name);
    expect(picked).toEqual(['catagory', 'closing_month', 'prod_group']);
  });

  it('drops columns whose values look personal even when the name looks harmless', () => {
    expect(toHint([{ v: '03458660111' }, { v: '03117264828' }, { v: '0' }], 25)).toBeUndefined();
    expect(toHint([{ v: '32.0929283,72.7044201' }, { v: '0.0,0.0' }], 25)).toBeUndefined();
    expect(toHint([{ v: 'a@b.pk' }, { v: 'c@d.pk' }], 25)).toBeUndefined();
    expect(toHint([{ v: 'RV2600021' }, { v: '202058005520366' }, { v: '15897918452003' }], 25)).toBeUndefined();
  });

  it('keeps categorical values', () => {
    expect(toHint([{ v: 'R' }, { v: 'O' }, { v: 'I' }, { v: 'D' }], 25)).toEqual(['R', 'O', 'I', 'D']);
    expect(toHint([{ v: '08/2026' }, { v: '07/2026' }], 25)).toEqual(['08/2026', '07/2026']);
    expect(toHint([{ v: 'TMC PHARMA' }, { v: 'NON GROUPED' }], 25)).toEqual(['TMC PHARMA', 'NON GROUPED']);
  });
});
