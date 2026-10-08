import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ConversionService } from './conversion.service';

@Module({
  controllers: [ContactsController],
  providers: [ConversionService],
})
export class ContactsModule {}
