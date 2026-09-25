import { Module } from '@nestjs/common';
import { AgentService } from './agent.service.js';
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
  providers: [AskService, AgentService, QueryCacheService, ExamplesService, TranslatorService, MediaService, TemplatesService],
  exports: [AskService, MediaService, TemplatesService],
})
export class QueryModule {}
