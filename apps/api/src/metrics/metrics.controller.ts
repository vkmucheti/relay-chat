import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { MetricsService } from './metrics.service.js';

@Controller()
@Public()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}
  @Get('metrics') async get(@Res() res: Response) {
    res.type(this.metrics.registry.contentType).send(await this.metrics.registry.metrics());
  }
}
