import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../../security/current-user.decorator';
import { AuthUser } from '../../security/auth-user';
import { Public } from '../../security/public.decorator';
import { AuthService } from './auth.service';
import {
  LoginRequestDto,
  RefreshRequestDto,
  RegisterRequestDto,
  RegisterResponse,
  TokenPairResponse,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED) // 201
  register(@Body() dto: RegisterRequestDto): Promise<RegisterResponse> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.CREATED) // 201 (matches original)
  login(@Body() dto: LoginRequestDto): Promise<TokenPairResponse> {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK) // 200
  refresh(@Body() dto: RefreshRequestDto): Promise<TokenPairResponse> {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT) // 204
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.authService.logout(user.userId);
  }
}
