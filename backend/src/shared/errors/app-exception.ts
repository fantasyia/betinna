import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

export interface AppExceptionDetails {
  field?: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface AppExceptionPayload {
  code: ErrorCode;
  message: string;
  details?: AppExceptionDetails[];
}

/**
 * Exceção base do domínio.
 * Garante que toda exceção da aplicação seja consistente em formato.
 */
export class AppException extends HttpException {
  public readonly code: ErrorCode;
  public readonly details?: AppExceptionDetails[];

  constructor(
    code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: AppExceptionDetails[],
  ) {
    super({ code, message, details }, status);
    this.code = code;
    this.details = details;
  }
}

// ─── Helpers semânticos ────────────────────────────────────────────────

export class UnauthorizedException extends AppException {
  constructor(message = 'Autenticação necessária', code = ErrorCode.AUTH_REQUIRED) {
    super(code, message, HttpStatus.UNAUTHORIZED);
  }
}

export class ForbiddenException extends AppException {
  constructor(message = 'Acesso negado', code = ErrorCode.FORBIDDEN) {
    super(code, message, HttpStatus.FORBIDDEN);
  }
}

export class NotFoundException extends AppException {
  constructor(resource: string, id?: string) {
    super(
      ErrorCode.NOT_FOUND,
      id ? `${resource} ${id} não encontrado` : `${resource} não encontrado`,
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ConflictException extends AppException {
  constructor(message: string, code = ErrorCode.CONFLICT) {
    super(code, message, HttpStatus.CONFLICT);
  }
}

export class ValidationException extends AppException {
  constructor(details: AppExceptionDetails[], message = 'Dados inválidos') {
    super(ErrorCode.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST, details);
  }
}

export class BusinessRuleException extends AppException {
  constructor(message: string, code = ErrorCode.BUSINESS_RULE_VIOLATION) {
    super(code, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class IntegrationException extends AppException {
  /** Status HTTP do provedor upstream (quando a falha veio de uma chamada externa). */
  public readonly upstreamStatus?: number;

  constructor(message: string, code = ErrorCode.INTEGRATION_ERROR, upstreamStatus?: number) {
    super(code, message, HttpStatus.BAD_GATEWAY);
    this.upstreamStatus = upstreamStatus;
  }
}
