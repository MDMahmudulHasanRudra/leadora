import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @HttpCode(200)
  overall() {
    return { status: 'ok', service: 'api' };
  }

  @Get('live')
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const report = await this.health.readiness();
    res.status(report.status === 'ok' ? 200 : 503);
    return report;
  }
}
