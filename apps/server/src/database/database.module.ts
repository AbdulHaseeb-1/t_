import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { SchemaCatalogService } from './schema/schema-catalog.service.js';
import { SchemaController } from './schema/schema.controller.js';

@Global()
@Module({
  controllers: [SchemaController],
  providers: [DatabaseService, SchemaCatalogService],
  exports: [DatabaseService, SchemaCatalogService],
})
export class DatabaseModule {}
