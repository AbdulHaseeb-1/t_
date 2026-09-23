import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { AgentService } from './agent.service.js';
import { AskService } from './ask.service.js';
import { QueryCacheService } from './query-cache.service.js';
import {
  type AnalyzeInput,
  analyzeSchema,
  type AskInput,
  askSchema,
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
}
