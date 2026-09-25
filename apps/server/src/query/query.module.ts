import { Module } from '@nestjs/common';
import { AnalystService } from './analyst/analyst.service.js';
import { AskService } from './ask.service.js';
import { ExamplesService } from './examples.service.js';
import { QueryCacheService } from './query-cache.service.js';
import { MediaService } from './media.service.js';
import { QueryController } from './query.controller.js';
import { TranslatorService } from './translator.service.js';
import { TemplatesController } from '../reports/templates.controller.js';
import { TemplatesService } from '../reports/templates.service.js';

@Module({
  controllers: [QueryController, TemplatesController],
  providers: [AskService, AnalystService, QueryCacheService, ExamplesService, TranslatorService, MediaService, TemplatesService],
  exports: [AskService, AnalystService, MediaService, TemplatesService],
})
export class QueryModule {}
