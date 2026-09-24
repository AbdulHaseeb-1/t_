import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/public.decorator.js';
import { DatabaseService } from '../database/database.service.js';
import { LlmService } from '../llm/llm.service.js';

@Controller('health')
@Public()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly llm: LlmService,
  ) {}

  @Get()
  async check() {
    const db = await this.db.ping();
    return {
      status: db.ok ? 'ok' : 'degraded',
      db,
      llm: { configured: this.llm.configured, mode: this.llm.getState().mode },
      uptimeS: Math.round(process.uptime()),
    };
  }
}
