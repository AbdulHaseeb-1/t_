import { Module } from '@nestjs/common';
import { BenchController, BenchEnabledGuard } from './bench.controller.js';
import { BenchService } from './bench.service.js';
import { ModelsService } from './models.service.js';

@Module({
  controllers: [BenchController],
  providers: [BenchService, ModelsService, BenchEnabledGuard],
})
export class BenchModule {}
