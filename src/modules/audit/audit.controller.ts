import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../../security/current-user.decorator';
import { AuthUser } from '../../security/auth-user';
import { AuditService } from './audit.service';
import { AuditRequestDto, AuditResponse } from './dto/audit.dto';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Post()
  @HttpCode(HttpStatus.OK) // 200 (Nest defaults POST to 201; the original returns 200)
  audit(@CurrentUser() user: AuthUser, @Body() dto: AuditRequestDto): Promise<AuditResponse> {
    return this.auditService.audit(user.userId, dto.text);
  }
}
