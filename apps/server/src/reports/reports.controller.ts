import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { WhatsAppService } from '../whatsapp/whatsapp.service.js';
import { InboxService } from './inbox.service.js';
import { PushService } from './push.service.js';
import { type ScheduleInput, scheduleInputSchema } from './schedule.js';
import { SchedulerService } from './scheduler.service.js';

@Controller('schedules')
export class SchedulesController {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  @Get()
  async list() {
    return { whatsapp: this.whatsapp.configured, schedules: await this.scheduler.list() };
  }

  @Post()
  create(@Body(new ZodValidationPipe(scheduleInputSchema)) body: ScheduleInput) {
    return this.scheduler.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body(new ZodValidationPipe(scheduleInputSchema)) body: ScheduleInput) {
    return this.scheduler.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.scheduler.remove(id);
  }

  /** Runs now and delivers like a scheduled run (does not move the next run). */
  @Post(':id/run')
  @HttpCode(200)
  run(@Param('id') id: string) {
    return this.scheduler.execute(id);
  }
}

// The app polls the inbox for new reports: exempt from the per-minute request limit.
@SkipThrottle()
@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  list(@Query('since') since?: string, @Query('limit') limit?: string) {
    return this.inbox.list(since, Math.min(200, Math.max(1, Number(limit) || 50)));
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.inbox.get(id);
  }

  @Post('read')
  @HttpCode(204)
  async readAll() {
    await this.inbox.markRead();
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@Param('id') id: string) {
    await this.inbox.markRead(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.inbox.remove(id);
  }
}

const deviceSchema = z.object({
  token: z.string().regex(/^ExponentPushToken\[[\w-]+\]$|^ExpoPushToken\[[\w-]+\]$/, 'Expo push token'),
  platform: z.enum(['android', 'ios', 'web']),
  name: z.string().max(80).optional(),
});

@Controller('devices')
export class DevicesController {
  constructor(private readonly push: PushService) {}

  @Post()
  @HttpCode(204)
  async register(@Body(new ZodValidationPipe(deviceSchema)) body: z.infer<typeof deviceSchema>) {
    await this.push.register(body.token, body.platform, body.name);
  }

  @Delete(':token')
  @HttpCode(204)
  async unregister(@Param('token') token: string) {
    await this.push.unregister(token);
  }
}
