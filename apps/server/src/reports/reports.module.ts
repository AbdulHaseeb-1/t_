import { Module } from '@nestjs/common';
import { QueryModule } from '../query/query.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { InboxService } from './inbox.service.js';
import { PushService } from './push.service.js';
import { DevicesController, InboxController, SchedulesController } from './reports.controller.js';
import { SchedulerService } from './scheduler.service.js';

@Module({
  imports: [QueryModule, WhatsAppModule],
  controllers: [SchedulesController, InboxController, DevicesController],
  providers: [SchedulerService, InboxService, PushService],
})
export class ReportsModule {}
