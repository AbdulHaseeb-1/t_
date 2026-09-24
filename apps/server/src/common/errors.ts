import { HttpException, HttpStatus } from '@nestjs/common';

/** Generated or submitted SQL failed the read-only policy. */
export class UnsafeSqlError extends HttpException {
  constructor(reason: string) {
    super({ message: `Rejected SQL: ${reason}`, code: 'UNSAFE_SQL' }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** The database rejected or failed a query. */
export class SqlExecutionError extends HttpException {
  constructor(
    message: string,
    readonly sql: string,
  ) {
    super({ message, code: 'SQL_ERROR', sql }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** No LLM provider could serve the request. */
export class LlmUnavailableError extends HttpException {
  constructor(message: string) {
    super({ message, code: 'LLM_UNAVAILABLE' }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

/** The provider rejected our request (e.g. invalid model name). */
export class LlmRequestError extends HttpException {
  constructor(provider: string, message: string) {
    super({ message: `${provider}: ${message}`, code: 'LLM_REQUEST_FAILED' }, HttpStatus.BAD_GATEWAY);
  }
}
