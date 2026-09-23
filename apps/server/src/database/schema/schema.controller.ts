import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SchemaCatalogService } from './schema-catalog.service.js';

@Controller('schema')
export class SchemaController {
  constructor(private readonly catalog: SchemaCatalogService) {}

  /** Object list with row counts: the cheapest way for a UI to browse the database. */
  @Get()
  async list() {
    const s = await this.catalog.snapshot();
    return {
      database: s.database,
      generatedAt: s.generatedAt,
      count: s.tables.length,
      tables: s.tables.map((t) => ({
        id: t.id,
        kind: t.kind,
        rowCount: t.rowCount,
        columns: t.columns.length,
        description: t.description,
      })),
    };
  }

  @Get('tables/:id')
  table(@Param('id') id: string) {
    return this.catalog.table(id);
  }

  /** Exactly what the LLM would see for a question; use it to tune retrieval. */
  @Get('context')
  context(@Query('q') q = '') {
    return this.catalog.contextFor(q);
  }

  /** Re-read the catalog after DDL changes. */
  @Post('refresh')
  async refresh() {
    const s = await this.catalog.refresh();
    return { database: s.database, generatedAt: s.generatedAt, count: s.tables.length };
  }
}
