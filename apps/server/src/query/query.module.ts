import { Module } from '@nestjs/common';
import { AgentService } from './agent.service.js';
import { AskService } from './ask.service.js';
import { QueryCacheService } from './query-cache.service.js';
import { QueryController } from './query.controller.js';

@Module({
  controllers: [QueryController],
  providers: [AskService, AgentService, QueryCacheService],
})
export class QueryModule {}
