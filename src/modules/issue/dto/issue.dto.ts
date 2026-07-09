/** Response DTOs for /issues. All wire fields are snake_case. */

export interface IssueNodeResponse {
  id: string;
  title: string;
  summary: string;
  date: string | null;
  criticism: number;
  support: number;
  interest: number;
}

export interface IssueConnectionResponse {
  source_id: string;
  target_id: string;
  similarity: number;
}

export interface IssueGraphResponse {
  protect_target: string;
  issues: IssueNodeResponse[];
  connections: IssueConnectionResponse[];
}
