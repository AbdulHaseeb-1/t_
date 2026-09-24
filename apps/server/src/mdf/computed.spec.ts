import { exactDivision, translateComputed, UnsupportedExpression } from './computed.js';

describe('translateComputed', () => {
  it('translates the T-SQL SQL Server stores for computed columns', () => {
    expect(translateComputed('(CONVERT([decimal](15,2),[a]*isnull([b],(0))))')).toBe('(CAST([a]*coalesce([b],(0)) AS DECIMAL(15,2)))'.replace(/\[(\w)\]/g, '"$1"'));
    expect(translateComputed('(([net_amt]+[sBalance])-([received]+[writeOff]))')).toBe('(("net_amt"+"sBalance")-("received"+"writeOff"))');
  });

  it('keeps decimal arithmetic exact by turning division by a constant into multiplication', () => {
    expect(exactDivision('"p"/(100.0)')).toBe('"p"*(0.010)');
    expect(exactDivision('"p"/4')).toBe('"p"*0.25');
    expect(exactDivision('"p"/12.5')).toBe('"p"*0.080');
    // 1/3 does not terminate: left as is
    expect(exactDivision('"p"/(3)')).toBe('"p"/(3)');
  });

  it('refuses constructs it cannot translate faithfully', () => {
    expect(() => translateComputed("([a]+'x')")).toThrow(UnsupportedExpression);
    expect(() => translateComputed('(CONVERT([varchar](10),[d],(112)))')).toThrow(UnsupportedExpression);
    expect(() => translateComputed('(datepart(year,[d]))')).toThrow(UnsupportedExpression);
  });
});
