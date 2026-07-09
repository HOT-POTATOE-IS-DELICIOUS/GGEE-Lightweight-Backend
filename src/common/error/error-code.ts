import { HttpStatus } from '@nestjs/common';

/**
 * Port of `team.hotpotato.common.exception.ErrorCode` + `ErrorCodeHttpStatusMapper`.
 * Each code carries the exact Korean message (plain-text response body) and its HTTP status.
 */
export interface ErrorCodeDef {
  readonly message: string;
  readonly status: HttpStatus;
}

export const ErrorCode = {
  // 401
  EXPIRED_TOKEN: { message: '만료된 JWT 토큰입니다.', status: HttpStatus.UNAUTHORIZED },
  INVALID_TOKEN: { message: '올바르지 않은 JWT 토큰입니다.', status: HttpStatus.UNAUTHORIZED },
  INVALID_TOKEN_TYPE: {
    message: '올바르지 않은 JWT 토큰 타입입니다.',
    status: HttpStatus.UNAUTHORIZED,
  },
  EXPIRED_REFRESH_TOKEN: {
    message: '만료된 리프레시 토큰입니다.',
    status: HttpStatus.UNAUTHORIZED,
  },
  INVALID_EMAIL_OR_PASSWORD: {
    message: '이메일 또는 비밀번호가 올바르지 않습니다.',
    status: HttpStatus.UNAUTHORIZED,
  },
  SESSION_EXPIRED: {
    message: '다른 기기에서 로그인되어 세션이 만료되었습니다.',
    status: HttpStatus.UNAUTHORIZED,
  },
  INVALID_SESSION: { message: '유효하지 않은 세션입니다.', status: HttpStatus.UNAUTHORIZED },
  // 400
  INVALID_EMAIL_FORMAT: {
    message: '올바르지 않은 이메일 형식입니다.',
    status: HttpStatus.BAD_REQUEST,
  },
  // 409
  EMAIL_ALREADY_EXISTS: { message: '이미 존재하는 이메일입니다.', status: HttpStatus.CONFLICT },
  // 404
  USER_NOT_FOUND: { message: '사용자를 찾을 수 없습니다.', status: HttpStatus.NOT_FOUND },
  PROTECT_NOT_FOUND: { message: '보호 대상을 찾을 수 없습니다.', status: HttpStatus.NOT_FOUND },
  STRATEGY_ROOM_NOT_FOUND: {
    message: '전략 채팅방을 찾을 수 없습니다.',
    status: HttpStatus.NOT_FOUND,
  },
  // 503
  ISSUE_GRAPH_SERVICE_UNAVAILABLE: {
    message: '이슈 계통도 조회 서버와 통신할 수 없습니다.',
    status: HttpStatus.SERVICE_UNAVAILABLE,
  },
  AUDIT_SERVICE_UNAVAILABLE: {
    message: '입장문 검수 서버와 통신할 수 없습니다.',
    status: HttpStatus.SERVICE_UNAVAILABLE,
  },
  STRATEGY_AI_SERVICE_UNAVAILABLE: {
    message: '전략 AI 서버와 통신할 수 없습니다.',
    status: HttpStatus.SERVICE_UNAVAILABLE,
  },
  NEWS_SERVICE_UNAVAILABLE: {
    message: '뉴스 조회 서버와 통신할 수 없습니다.',
    status: HttpStatus.SERVICE_UNAVAILABLE,
  },
  // 405 / 500
  METHOD_NOT_ALLOWED: {
    message: '잘못된 HTTP 메서드를 호출했습니다.',
    status: HttpStatus.METHOD_NOT_ALLOWED,
  },
  INTERNAL_SERVER_ERROR: {
    message: '서버 에러가 발생했습니다.',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  },
  CLOCK_MOVED_BACKWARDS: {
    message: '시스템 시간에 에러가 발생하여 원래 시간보다 늦어졌습니다.',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  },
  INVALID_WORKER_ID: {
    message: 'snowflake.worker-id는 0~31 범위여야 합니다.',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  },
} as const satisfies Record<string, ErrorCodeDef>;

export type ErrorCodeName = keyof typeof ErrorCode;
