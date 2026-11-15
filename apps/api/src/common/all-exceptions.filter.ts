import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import { ZodError } from 'zod';
import { badRequest } from './errors';
import type { AppRequest, AppResponse } from './request';
import { sendError, toErrorResponse } from './respond';

export const zodDetails = (err: ZodError) =>
  err.issues.slice(0, 20).map((i) => ({ path: i.path.join('.') || '(body)', message: i.message }));

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<AppRequest>();
    const res = http.getResponse<AppResponse>();
    const err =
      exception instanceof ZodError
        ? badRequest('Validation failed', zodDetails(exception))
        : exception;
    const out = toErrorResponse(err, req.id);
    if (out.log) {
      this.logger.error(
        `[${req.id}] ${req.method} ${req.path} → 500`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    sendError(res, err, req.id);
  }
}
