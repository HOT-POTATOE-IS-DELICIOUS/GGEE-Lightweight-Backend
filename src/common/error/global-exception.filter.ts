import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { BusinessException } from './business.exception';
import { ErrorCode } from './error-code';

/**
 * Port of `ApiControllerAdvice` + `ErrorCodeHttpStatusMapper`.
 *
 * Response conventions preserved from the original:
 *  - BusinessException            -> text/plain body = Korean ErrorCode message, mapped status
 *  - validation failure (400)     -> text/plain body = first violation message
 *  - MethodNotAllowed (405)       -> text/plain METHOD_NOT_ALLOWED message
 *  - anything else (500)          -> text/plain INTERNAL_SERVER_ERROR message
 *
 * The auth guard does NOT go through here; it writes an empty body directly (see JwtAuthGuard).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    // Headers already sent (e.g. mid-SSE-stream) — nothing we can render.
    if (res.headersSent) {
      this.logger.warn(`Exception after headers sent: ${String(exception)}`);
      return;
    }

    const { status, body } = this.resolve(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    } else {
      this.logger.warn(`[${status}] ${body}`);
    }
    res.status(status).type('text/plain; charset=utf-8').send(body);
  }

  private resolve(exception: unknown): { status: number; body: string } {
    if (exception instanceof BusinessException) {
      return { status: exception.status, body: exception.bodyMessage };
    }

    if (exception instanceof HttpException) {
      // getStatus() is typed `number`; every value Nest puts there is an HttpStatus member.
      const status: HttpStatus = exception.getStatus();
      if (status === HttpStatus.METHOD_NOT_ALLOWED) {
        return {
          status,
          body: ErrorCode.METHOD_NOT_ALLOWED.message,
        };
      }
      if (status === HttpStatus.BAD_REQUEST) {
        return { status, body: this.firstValidationMessage(exception) };
      }
      // Fall back to the exception's own message for other HttpExceptions.
      return { status, body: this.plainMessage(exception) };
    }

    return {
      status: ErrorCode.INTERNAL_SERVER_ERROR.status,
      body: ErrorCode.INTERNAL_SERVER_ERROR.message,
    };
  }

  /** Extract the first class-validator message from a Nest ValidationPipe error payload. */
  private firstValidationMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'object' && response !== null) {
      const message = (response as { message?: unknown }).message;
      if (Array.isArray(message) && message.length > 0) {
        return String(message[0]);
      }
      if (typeof message === 'string') {
        return message;
      }
    }
    return ErrorCode.INTERNAL_SERVER_ERROR.message;
  }

  private plainMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response !== null) {
      const message = (response as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message) && message.length > 0) return String(message[0]);
    }
    return exception.message;
  }
}
