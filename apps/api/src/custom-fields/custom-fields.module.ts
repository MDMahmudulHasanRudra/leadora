import { Module } from '@nestjs/common';
import { CustomFieldsController } from './custom-fields.controller';

@Module({ controllers: [CustomFieldsController] })
export class CustomFieldsModule {}
