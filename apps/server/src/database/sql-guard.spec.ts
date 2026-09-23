import { assertReadOnlySql, stripTsql } from './sql-guard.js';

describe('assertReadOnlySql', () => {
  it.each([
    'SELECT 1',
    'select top (10) * from [dbo].[Orders] order by [OrderDate] desc;',
    'WITH t AS (SELECT a FROM x) SELECT * FROM t',
    "SELECT [Delete], [Update] FROM dbo.Flags WHERE note = 'drop table x; exec y'",
    'SELECT * FROM dbo.T ORDER BY Id OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY',
    'SELECT o.[Open], o.[Close] FROM dbo.Prices o -- update later\n',
    'SELECT IIF(a > 1, 1, 0) AS flag FROM dbo.T /* outer /* nested */ still comment */',
    'SELECT DeletedAt, UpdatedBy, CreatedOn, Settings FROM dbo.Audit',
  ])('allows %s', (sql) => {
    expect(() => assertReadOnlySql(sql)).not.toThrow();
  });

  it.each([
    ['', 'empty'],
    ['DELETE FROM dbo.T', 'only SELECT'],
    ['SELECT 1; DROP TABLE dbo.T', 'multiple statements'],
    ['SELECT 1 DROP TABLE dbo.T', 'DROP'],
    ['SELECT * INTO dbo.Copy FROM dbo.T', 'INTO'],
    ["SELECT * FROM OPENROWSET('SQLNCLI', 'x', 'y')", 'OPENROWSET'],
    ['WITH t AS (SELECT 1 a) UPDATE t SET a = 2', 'UPDATE'],
    ["SELECT 1 EXEC('drop table x')", 'EXEC'],
    ["SELECT 1 WAITFOR DELAY '00:01'", 'WAITFOR'],
    ['SELECT NEXT VALUE FOR dbo.Seq', 'NEXT'],
    ["SELECT 'unterminated", 'unterminated'],
    ['SELECT 1 /* never closed', 'unterminated'],
    ['EXEC sp_who', 'only SELECT'],
    ['SELECT 1 SET ROWCOUNT 0', 'SET'],
  ])('rejects %s', (sql, reason) => {
    expect(() => assertReadOnlySql(sql)).toThrow(new RegExp(reason, 'i'));
  });

  it('strips trailing semicolons', () => {
    expect(assertReadOnlySql('SELECT 1 ;; ')).toBe('SELECT 1');
  });

  it('does not treat escaped quotes as terminators', () => {
    expect(stripTsql("SELECT 'it''s; drop' AS x")).not.toContain('drop');
    expect(() => assertReadOnlySql('SELECT [a]]; drop] FROM t')).not.toThrow();
  });
});
