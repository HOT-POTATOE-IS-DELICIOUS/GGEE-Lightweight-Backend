/** Response DTOs for /news. All wire fields are snake_case. */

export interface NewsItemResponse {
  title: string;
  summary: string;
  link: string;
}

export interface NewsResponse {
  node_id: string;
  count: number;
  news: NewsItemResponse[];
}
