import { IsNotEmpty } from 'class-validator';

/** Request/response DTOs for /audit. All wire fields are snake_case. */

export class AuditRequestDto {
  @IsNotEmpty({ message: '검수할 입장문을 입력해주세요.' })
  text!: string;
}

export interface AuditSentenceResponse {
  sentence_text: string;
  start_offset: number;
  end_offset: number;
}

export interface AuditSuggestionResponse {
  start_index: number;
  end_index: number;
  before: string;
  after: string;
  reason: string;
}

export interface AuditReviewResponse {
  sentence: AuditSentenceResponse;
  perspective_ids: string[];
  perspective_labels: string[];
  suggestions: AuditSuggestionResponse[];
}

export interface AuditResponse {
  audit_id: string;
  reviews: AuditReviewResponse[];
}
