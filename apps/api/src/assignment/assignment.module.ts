import { Module } from '@nestjs/common';
import { AssignmentRulesController } from './assignment-rules.controller';

@Module({ controllers: [AssignmentRulesController] })
export class AssignmentModule {}
