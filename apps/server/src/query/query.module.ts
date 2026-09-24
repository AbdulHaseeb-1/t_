import { Module } from '@nestjs/common';
import { AgentService } from './agent.service.js';
import { AskService } from './ask.service.js';
import { ExamplesService } from './examples.service.js';
import { QueryCacheService } from './query-cache.service.js';
import { MediaService } from './media.service.js';
import { QueryController } from './query.controller.js';
import { TranslatorService } from './translator.service.js';

@Module({
  controllers: [QueryController],
  providers: [AskService, AgentService, QueryCacheService, ExamplesService, TranslatorService, MediaService],
})
export class QueryModule {}
