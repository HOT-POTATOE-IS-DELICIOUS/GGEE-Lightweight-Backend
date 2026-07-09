import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../security/current-user.decorator';
import { AuthUser } from '../../security/auth-user';
import { IssueService } from './issue.service';
import { IssueGraphResponse } from './dto/issue.dto';

@Controller('issues')
export class IssueController {
  constructor(private readonly issueService: IssueService) {}

  @Get()
  getIssues(@CurrentUser() user: AuthUser): Promise<IssueGraphResponse> {
    return this.issueService.getIssues(user.userId);
  }
}
