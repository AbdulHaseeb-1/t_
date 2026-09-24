import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { AgentService } from './agent.service.js';
import { AskService } from './ask.service.js';
import { ExamplesService } from './examples.service.js';
import { AUDIO_TYPES, IMAGE_TYPES, MediaService, type UploadedMedia } from './media.service.js';
import { AppConfig } from '../config/app-config.js';
import { QueryCacheService } from './query-cache.service.js';
import {
  type AnalyzeInput,
  analyzeSchema,
  type AskInput,
  askSchema,
  type ExampleInput,
  exampleSchema,
  mediaFieldsSchema,
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
    private readonly media: MediaService,
    private readonly config: AppConfig,
  ) {}

  /** Natural language -> SQL -> data (+ answer). The default, cheapest LLM path. */
  @Post('ask')
  @HttpCode(200)
  ask(@Body(new ZodValidationPipe(askSchema)) body: AskInput) {
    return this.askService.ask(body);
  }

  /**
   * Voice and/or image questions (multipart/form-data): fields `question`,
   * `context` (JSON), `language`, `answer`; files `audio` and/or `image`.
   */
  @Post('ask/media')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async askMedia(@Req() req: FastifyRequest) {
    if (!req.isMultipart())
      throw new BadRequestException('Send multipart/form-data with an audio and/or image file.');
    const fields: Record<string, string> = {};
    const files: Partial<Record<'audio' | 'image', UploadedMedia>> = {};
    const limits = {
      audio: this.config.get('MEDIA_MAX_AUDIO_MB') * 1024 * 1024,
      image: this.config.get('MEDIA_MAX_IMAGE_MB') * 1024 * 1024,
    };

    for await (const part of req.parts()) {
      if (part.type === 'field') {
        fields[part.fieldname] = String(part.value);
        continue;
      }
      const kind = part.fieldname;
      if (kind !== 'audio' && kind !== 'image')
        throw new BadRequestException(`Unexpected file field "${kind}".`);
      const mime = part.mimetype.split(';')[0].toLowerCase();
      if (!(kind === 'audio' ? AUDIO_TYPES : IMAGE_TYPES).has(mime)) {
        throw new HttpException(
          `Unsupported ${kind} type "${part.mimetype}".`,
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        );
      }
      const buffer = await part.toBuffer();
      if (part.file.truncated || buffer.length > limits[kind]) {
        throw new HttpException(
          `The ${kind} is too large (max ${limits[kind] / 1024 / 1024} MB).`,
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
      files[kind] = { buffer, filename: part.filename || kind, mimetype: mime };
    }

    const input = new ZodValidationPipe(mediaFieldsSchema).transform(fields);
    if (!input.question && !files.audio && !files.image) {
      throw new BadRequestException('Send a question, a voice message or an image.');
    }
    return this.media.ask({ ...input, audio: files.audio, image: files.image });
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
