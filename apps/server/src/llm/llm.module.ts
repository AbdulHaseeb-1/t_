import { Global, Module } from '@nestjs/common';
import { LlmController } from './llm.controller.js';
import { LlmService } from './llm.service.js';
import { ModelPricingService } from './model-pricing.service.js';

@Global()
@Module({
  controllers: [LlmController],
  providers: [LlmService, ModelPricingService],
  exports: [LlmService],
})
export class LlmModule {}
