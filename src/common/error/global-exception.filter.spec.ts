import { ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { BusinessException } from './business.exception';
import { ErrorCode } from './error-code';
import { GlobalExceptionFilter } from './global-exception.filter';

function makeResponse(headersSent = false) {
  const res: any = { headersSent };
  res.status = jest.fn(() => res);
  res.type = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res as Response & {
    status: jest.Mock;
    type: jest.Mock;
    send: jest.Mock;
  };
}

function makeHost(res: Response): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('renders a BusinessException as text/plain with the mapped status and Korean message', () => {
    const res = makeResponse();
    filter.catch(new BusinessException('INVALID_TOKEN'), makeHost(res));

    expect(res.status).toHaveBeenCalledWith(ErrorCode.INVALID_TOKEN.status);
    expect(res.type).toHaveBeenCalledWith('text/plain; charset=utf-8');
    expect(res.send).toHaveBeenCalledWith(ErrorCode.INVALID_TOKEN.message);
  });

  it('renders only the first violation for a 400 class-validator payload', () => {
    const res = makeResponse();
    const exception = new HttpException(
      { message: ['첫 메시지', '둘째'] },
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(exception, makeHost(res));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('첫 메시지');
  });

  it('renders the METHOD_NOT_ALLOWED message for a 405', () => {
    const res = makeResponse();
    filter.catch(new HttpException('nope', HttpStatus.METHOD_NOT_ALLOWED), makeHost(res));

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.send).toHaveBeenCalledWith(ErrorCode.METHOD_NOT_ALLOWED.message);
  });

  it('renders INTERNAL_SERVER_ERROR for an unknown error', () => {
    const res = makeResponse();
    filter.catch(new Error('boom'), makeHost(res));

    expect(res.status).toHaveBeenCalledWith(ErrorCode.INTERNAL_SERVER_ERROR.status);
    expect(res.send).toHaveBeenCalledWith(ErrorCode.INTERNAL_SERVER_ERROR.message);
  });

  it('sends nothing when the headers were already sent (mid-stream)', () => {
    const res = makeResponse(true);
    filter.catch(new BusinessException('INVALID_TOKEN'), makeHost(res));

    expect(res.send).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
