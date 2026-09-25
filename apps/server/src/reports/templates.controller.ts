import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CATEGORIES } from './template.js';
import { TemplatesService } from './templates.service.js';

const runSchema = z.object({
  params: z.record(z.string(), z.union([z.string().max(40), z.number()])).default({}),
  language: z.enum(['en', 'ur', 'ur-Latn']).default('en'),
  /** false = numbers only, no model call. */
  answer: z.boolean().default(true),
});

const createSchema = z.object({
  title: z.string().trim().min(2).max(80),
  titleUr: z.string().trim().max(80).optional(),
  description: z.string().trim().max(300).optional(),
  prompt: z.string().trim().max(1200).optional(),
  category: z.enum(CATEGORIES).optional(),
  question: z.string().trim().min(3).max(2000),
  sql: z.string().min(1).max(20_000).optional(),
});

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  /** Report gallery: metadata and parameters (SQL omitted; GET /templates/:id has it). */
  @Get()
  async list() {
    const list = await this.templates.list();
    return {
      timezone: this.templates.timezone,
      today: this.templates.today(),
      templates: list.map(({ sql, sqlDuckdb, ...t }) => ({ ...t, hasSql: !!(sql || sqlDuckdb) })),
    };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.templates.get(id);
  }

  @Post()
  create(@Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.templates.create(body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.templates.remove(id);
  }

  @Post(':id/run')
  @HttpCode(200)
  run(@Param('id') id: string, @Body(new ZodValidationPipe(runSchema)) body: z.infer<typeof runSchema>) {
    return this.templates.run(id, body);
  }
}
