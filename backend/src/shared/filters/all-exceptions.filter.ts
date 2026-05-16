import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';
import { captureException as sentryCapture } from '@shared/observability/sentry';

interface ErrorResponseBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: {
    path: string;
    method: string;
    timestamp: string;
    requestId?: string;
  };
}

/**
 * Filtro global que transforma TODA exceção em resposta padronizada.
 * Cuida de:
 * - AppException (do domínio)
 * - HttpException (NestJS built-in)
 * - Erros do Prisma (PostgreSQL constraints, etc.)
 * - Qualquer Error não tratado (vira 500)
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    const { status, body } = this.mapException(exception, request);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status} ${body.error.code}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      // Sprint 3 FIX 5: captura no Sentry só para 5xx (4xx = client error, não nosso bug)
      sentryCapture(exception, {
        path: request.url,
        method: request.method,
        requestId: request.id,
      });
    } else {
      this.logger.warn(`${request.method} ${request.url} → ${status} ${body.error.code}`);
    }

    response.status(status).json(body);
  }

  private mapException(
    exception: unknown,
    request: Request & { id?: string },
  ): { status: number; body: ErrorResponseBody } {
    const meta = {
      path: request.url,
      method: request.method,
      timestamp: new Date().toISOString(),
      requestId: request.id,
    };

    // 1) AppException — já vem padronizada
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        body: {
          success: false,
          error: {
            code: exception.code,
            message: exception.message,
            details: exception.details,
          },
          meta,
        },
      };
    }

    // 2) Erros do Prisma — mapeia constraints para códigos amigáveis
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrismaError(exception, meta);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          success: false,
          error: {
            code: ErrorCode.VALIDATION_ERROR,
            message: 'Erro de validação do banco de dados',
          },
          meta,
        },
      };
    }

    // 3) HttpException padrão do NestJS
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string | string[] }).message ?? exception.message);
      return {
        status,
        body: {
          success: false,
          error: {
            code: this.statusToCode(status),
            message: Array.isArray(message) ? message.join('; ') : message,
            details: typeof res === 'object' ? (res as Record<string, unknown>) : undefined,
          },
          meta,
        },
      };
    }

    // 4) Erro desconhecido
    const message = exception instanceof Error ? exception.message : 'Erro interno do servidor';
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        success: false,
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message: process.env.NODE_ENV === 'production' ? 'Erro interno do servidor' : message,
        },
        meta,
      },
    };
  }

  private mapPrismaError(
    error: Prisma.PrismaClientKnownRequestError,
    meta: ErrorResponseBody['meta'],
  ): { status: number; body: ErrorResponseBody } {
    switch (error.code) {
      case 'P2002': {
        // Unique constraint violation
        const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'campo';
        return {
          status: HttpStatus.CONFLICT,
          body: {
            success: false,
            error: {
              code: ErrorCode.ALREADY_EXISTS,
              message: `Já existe um registro com este valor em: ${target}`,
            },
            meta,
          },
        };
      }
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          body: {
            success: false,
            error: { code: ErrorCode.NOT_FOUND, message: 'Registro não encontrado' },
            meta,
          },
        };
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          body: {
            success: false,
            error: {
              code: ErrorCode.CONFLICT,
              message: 'Violação de chave estrangeira',
            },
            meta,
          },
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: {
            success: false,
            error: {
              code: ErrorCode.DATABASE_ERROR,
              message: `Erro de banco (${error.code})`,
            },
            meta,
          },
        };
    }
  }

  private statusToCode(status: number): string {
    if (status === 401) return ErrorCode.AUTH_REQUIRED;
    if (status === 403) return ErrorCode.FORBIDDEN;
    if (status === 404) return ErrorCode.NOT_FOUND;
    if (status === 409) return ErrorCode.CONFLICT;
    if (status === 422) return ErrorCode.BUSINESS_RULE_VIOLATION;
    if (status === 429) return ErrorCode.RATE_LIMIT_EXCEEDED;
    if (status >= 500) return ErrorCode.INTERNAL_ERROR;
    return ErrorCode.VALIDATION_ERROR;
  }
}
