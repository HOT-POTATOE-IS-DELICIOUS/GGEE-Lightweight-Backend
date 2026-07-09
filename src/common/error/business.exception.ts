import { ErrorCode, ErrorCodeName } from './error-code';

/**
 * Port of `BusinessBaseException`. Carries an ErrorCode name; the global filter
 * renders it as a plain-text body (the Korean message) with the mapped HTTP status.
 */
export class BusinessException extends Error {
  readonly code: ErrorCodeName;

  constructor(code: ErrorCodeName) {
    super(ErrorCode[code].message);
    this.code = code;
    this.name = 'BusinessException';
  }

  get status(): number {
    return ErrorCode[this.code].status;
  }

  get bodyMessage(): string {
    return ErrorCode[this.code].message;
  }
}
