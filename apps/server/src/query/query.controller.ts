import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { AgentService } from './agent.service.js';
import { AskService } from './ask.service.js';
import { ExamplesService } from './examples.service.js';
import { QueryCacheService } from './query-cache.service.js';
import {
  type AnalyzeInput,
  analyzeSchema,
  type AskInput,
  askSchema,
  type ExampleInput,
  exampleSchema,
  type SqlInput,
  sqlSchema,
} from './query.dto.js';

@Controller('query')
export class QueryController {
  constructor(
    private readonly askService: AskService,
    private readonly agent: AgentService,
    private readonly db: DatabaseService,
    private readonly cache: QueryCacheService,
    private readonly examples: ExamplesService,
  ) {}

  /** Natural language -> SQL -> data (+ answer). The default, cheapest LLM path. */
  @Post('ask')
  @HttpCode(200)
  ask(@Body(new ZodValidationPipe(askSchema)) body: AskInput) {
    return this.askService.ask(body);
  }

  /** Multi-step agentic analysis. More capable, more tokens: use when /ask is not enough. */
  @Post('analyze')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  analyze(@Body(new ZodValidationPipe(analyzeSchema)) body: AnalyzeInput) {
    return this.agent.analyze(body);
  }

  /** Run read-only SQL directly. Zero LLM cost: use for dashboards and saved queries. */
  @Post('sql')
  @HttpCode(200)
  sql(@Body(new ZodValidationPipe(sqlSchema)) body: SqlInput) {
    return this.db.readOnlyQuery(body.sql, body.maxRows);
  }

  @Get('cache')
  cacheStats() {
    return this.cache.stats();
  }

  @Delete('cache')
  clearCache() {
    this.cache.clear();
    return this.cache.stats();
  }

  /** Verified question -> SQL pairs used as few-shot examples. */
  @Get('examples')
  listExamples() {
    return this.examples.list();
  }

  /** Save a verified pair (e.g. from a thumbs-up in the UI). The SQL must run. */
  @Post('examples')
  async addExample(@Body(new ZodValidationPipe(exampleSchema)) body: ExampleInput) {
    await this.db.readOnlyQuery(body.sql, 1);
    return this.examples.add(body.question, body.sql);
  }

  @Delete('examples/:id')
  async removeExample(@Param('id') id: string) {
    await this.examples.remove(id);
    return { deleted: id };
  }
}
