import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';
import { ValidationException } from '../errors/app-exception';

/**
 * Pipe genérico que valida o body/query/params usando um schema Zod.
 *
 * @example
 *   @Post()
 *   create(@Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto) {}
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, metadata: ArgumentMetadata): T {
    // Quando aplicado no método inteiro (@UsePipes), o pipe recebe TODOS os
    // parâmetros — inclusive os decorados com @CurrentUser (type 'custom').
    // Validar o usuário contra um schema de body o corromperia (apagaria
    // empresaIdAtiva/role e quebraria o multi-tenant). Só validamos dados de
    // entrada de fato (body/query/param).
    if (metadata.type === 'custom') {
      return value as T;
    }
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationException(
          error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        );
      }
      throw error;
    }
  }
}
