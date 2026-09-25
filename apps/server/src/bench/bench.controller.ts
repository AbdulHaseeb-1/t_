import {
  Body,
  type CanActivate,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AppConfig } from '../config/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import { type CompareInput, compareSchema, EFFORTS, type StartRunInput, startRunSchema } from './bench.dto.js';
import { BenchService } from './bench.service.js';
import { ModelsService } from './models.service.js';

/** The bench spends API credits: it exists only when BENCH_ENABLED=true. */
@Injectable()
export class BenchEnabledGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.get('BENCH_ENABLED')) throw new NotFoundException('Benchmark is disabled (set BENCH_ENABLED=true)');
    return true;
  }
}

// Live progress is polled about once a second: exempt from the per-minute request limit.
@SkipThrottle()
@UseGuards(BenchEnabledGuard)
@Controller('bench/api')
export class BenchController {
  constructor(
    private readonly bench: BenchService,
    private readonly models: ModelsService,
    private readonly config: AppConfig,
    private readonly db: DatabaseService,
  ) {}

  @Get('config')
  settings() {
    const c = this.config;
    return {
      engine: c.get('DB_ENGINE') === 'duckdb' ? 'duckdb' : 'mssql',
      database: this.db.databaseName,
      providers: { openai: !!c.get('OPENAI_API_KEY'), openrouter: !!c.get('OPENROUTER_API_KEY') },
      current: {
        provider: c.get('LLM_PROVIDER'),
        openai: { fast: c.get('OPENAI_MODEL_FAST'), smart: c.get('OPENAI_MODEL_SMART') },
        openrouter: { fast: c.get('OPENROUTER_MODEL_FAST'), smart: c.get('OPENROUTER_MODEL_SMART') },
        reasoningEffort: c.get('LLM_REASONING_EFFORT_FAST') ?? null,
      },
      features: {
        valueHints: c.get('SCHEMA_VALUE_HINTS'),
        emptyRecheck: c.get('ASK_EMPTY_RESULT_RECHECK'),
        candidates: c.get('ASK_SQL_CANDIDATES'),
      },
      efforts: EFFORTS,
      maxCaseRuns: c.get('BENCH_MAX_CASE_RUNS'),
    };
  }

  @Get('models')
  @Header('Cache-Control', 'no-store')
  listModels() {
    return this.models.list();
  }

  @Get('datasets')
  datasets() {
    return this.bench.datasets();
  }

  @Get('datasets/:file')
  async dataset(@Param('file') file: string) {
    const d = await this.bench.dataset(file);
    return {
      ...d,
      // Gold SQL is ground truth for grading; the UI shows it on the case drill-down.
      cases: d.cases.map(({ id, question, tags, difficulty, language, expect, note }) => ({ id, question, tags, difficulty, language, expect, note })),
    };
  }

  @Get('runs')
  runs() {
    return this.bench.runs();
  }

  @Post('runs')
  @HttpCode(202)
  start(@Body(new ZodValidationPipe(startRunSchema)) body: StartRunInput) {
    return this.bench.start(body);
  }

  @Get('runs/:id')
  run(@Param('id') id: string, @Query('since') since?: string) {
    return this.bench.run(id, Math.max(0, Number(since) || 0));
  }

  @Post('runs/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.bench.cancel(id);
  }

  @Delete('runs/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.bench.remove(id);
  }

  @Post('compare')
  @HttpCode(200)
  compare(@Body(new ZodValidationPipe(compareSchema)) body: CompareInput) {
    return this.bench.compare(body);
  }
}
