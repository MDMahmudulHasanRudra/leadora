import { type PipeTransform, UnprocessableEntityException } from '@nestjs/common';
import type { z } from 'zod';

export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new UnprocessableEntityException({
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
}
