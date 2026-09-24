import { Body, Controller, Get, Put } from '@nestjs/common';
import { z } from 'zod';
import { PROVIDERS } from '../config/env.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LlmService } from './llm.service.js';

const setModeSchema = z.object({
  mode: z.enum(['auto', ...PROVIDERS]),
  fallbackOrder: z.array(z.enum(PROVIDERS)).min(1).optional(),
});

@Controller('llm')
export class LlmController {
  constructor(private readonly llm: LlmService) {}

  /** Current mode, models, breaker state and cumulative token/cost stats. */
  @Get()
  state() {
    return this.llm.getState();
  }

  /** Switch provider at runtime without a restart. */
  @Put('mode')
  setMode(@Body(new ZodValidationPipe(setModeSchema)) body: z.infer<typeof setModeSchema>) {
    this.llm.setMode(body.mode, body.fallbackOrder);
    return this.llm.getState();
  }
}
