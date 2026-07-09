import { IsEmail, IsNotEmpty, Length } from 'class-validator';

/** Request/response DTOs for /auth. All wire fields are snake_case. */

export class RegisterRequestDto {
  @IsNotEmpty({ message: '이메일이 입력되지 않았습니다.' })
  @IsEmail({}, { message: '잘못된 이메일 형식입니다.' })
  email!: string;

  @IsNotEmpty({ message: '비밀번호가 입력되지 않았습니다.' })
  @Length(8, 20, { message: '비밀번호는 최소 8자 이상 20자 이하여야 합니다.' })
  password!: string;

  @IsNotEmpty({ message: '보호 대상을 입력해주세요.' })
  protect_target!: string;

  @IsNotEmpty({ message: '보호 대상 정보를 입력해주세요.' })
  protect_target_info!: string;
}

export class LoginRequestDto {
  @IsNotEmpty({ message: '이메일이 입력되지 않았습니다.' })
  @IsEmail({}, { message: '잘못된 이메일 형식입니다.' })
  email!: string;

  @IsNotEmpty({ message: '비밀번호가 입력되지 않았습니다.' })
  @Length(8, 20, { message: '비밀번호는 최소 8자 이상 20자 이하여야 합니다.' })
  password!: string;
}

export class RefreshRequestDto {
  @IsNotEmpty()
  refresh_token!: string;
}

export interface RegisterResponse {
  indexing_job_id: string;
  access_token: string;
  refresh_token: string;
}

export interface TokenPairResponse {
  access_token: string;
  refresh_token: string;
}
