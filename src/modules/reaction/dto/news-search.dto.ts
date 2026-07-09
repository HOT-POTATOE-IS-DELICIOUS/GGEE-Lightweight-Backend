import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

/** Request/response DTOs for `GET /news` (keyword search, proxied to the news-crawler `/search`). */

export class NewsSearchQueryDto {
  @IsNotEmpty({ message: '검색 키워드를 입력해주세요.' })
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from?: number;

  @IsOptional()
  @IsIn(['score', 'date'])
  sort?: 'score' | 'date';

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  from_date?: string;

  @IsOptional()
  @IsString()
  to_date?: string;
}

export interface NewsSearchHitResponse {
  id: string;
  title: string;
  description: string;
  link: string;
  published_at: string;
}

export interface NewsSearchResponse {
  total: number;
  hits: NewsSearchHitResponse[];
}
