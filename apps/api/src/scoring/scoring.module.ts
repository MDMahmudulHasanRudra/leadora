import { Module } from '@nestjs/common';
import { ScoringController } from './scoring.controller';

@Module({ controllers: [ScoringController] })
export class ScoringModule {}