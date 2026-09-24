import { testConfig } from '../testing/fake-openai.js';
import { ExamplesService } from './examples.service.js';

describe('ExamplesService.retrieve', () => {
  const svc = new ExamplesService(testConfig({ ASK_FEWSHOT_K: '2' }));
  svc.replaceAll([
    { question: 'Total revenue by product category in 2024', sql: 'SELECT 1' },
    { question: 'Number of cancelled orders per month', sql: 'SELECT 2' },
    { question: 'Revenue per sales representative', sql: 'SELECT 3' },
    { question: 'List all employees hired before 2020', sql: 'SELECT 4' },
  ]);

  it('returns the most similar examples first', () => {
    expect(svc.retrieve('What was revenue by category in 2025?').map((e) => e.sql)).toEqual([
      'SELECT 1',
      'SELECT 3',
    ]);
  });

  it('never returns the question itself (no leakage)', () => {
    expect(svc.retrieve('total revenue by product category in 2024').map((e) => e.sql)).not.toContain(
      'SELECT 1',
    );
  });

  it('returns nothing below the similarity floor', () => {
    expect(svc.retrieve('weather tomorrow')).toEqual([]);
  });
});
