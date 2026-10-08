import { Module } from '@nestjs/common';
import { PipelinesController } from './pipelines.controller';

@Module({
  controllers: [PipelinesController],
})
export class OrganizationsModule {}
