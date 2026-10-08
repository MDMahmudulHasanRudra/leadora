import { Module } from '@nestjs/common';
import { OpenAiProvider } from '@leadora/ai';
import { DomainError } from '@leadora/domain';
import { AI_PROVIDER_FACTORY } from '../infra/tokens';
import { LeadsModule } from '../leads/leads.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [LeadsModule],
  controllers: [AiController],
  providers: [
    AiService,
    {
      provide: AI_PROVIDER_FACTORY,
      useValue: (provider: string, apiKey: string) => {
        if (provider === 'openai') return new OpenAiProvider({ apiKey });
        throw new DomainError('conflict', 'AI_NOT_CONFIGURED', `Unsupported AI provider "${provider}"`);
      },
    },
  ],
  exports: [AiService],
})
export class AiModule {}
