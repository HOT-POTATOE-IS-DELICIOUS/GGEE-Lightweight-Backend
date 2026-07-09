import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiHttpClient, AiHttpError } from '../../common/http/ai-http.client';
import { BusinessException } from '../../common/error/business.exception';
import { ProtectService } from '../protect/protect.service';
import { IssueConnectionResponse, IssueGraphResponse, IssueNodeResponse } from './dto/issue.dto';

/** Raw (snake_case) shapes returned by the Issue AI service. */
interface IssueAiNode {
  id: string | null;
  title: string | null;
  summary: string | null;
  date: string | null;
  criticism: number | null;
  support: number | null;
  interest: number | null;
}

interface IssueAiConnection {
  source_id: string | null;
  target_id: string | null;
  similarity: number | null;
}

interface IssueAiResponse {
  entity_name: string | null;
  issues: IssueAiNode[] | null;
  connections: IssueAiConnection[] | null;
}

@Injectable()
export class IssueService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly protectService: ProtectService,
    private readonly http: AiHttpClient,
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>('ai.issue.baseUrl');
    this.timeoutMs = config.getOrThrow<number>('ai.issue.timeoutMs');
  }

  async getIssues(userId: string): Promise<IssueGraphResponse> {
    const protect = await this.protectService.getByUserId(userId);

    let url = `${this.baseUrl}/issues?entity_name=${encodeURIComponent(protect.target)}`;
    if (protect.info !== null && protect.info !== undefined && protect.info.trim() !== '') {
      url += `&entity_info=${encodeURIComponent(protect.info)}`;
    }

    let aiResponse: IssueAiResponse;
    try {
      aiResponse = await this.http.getJson<IssueAiResponse>(url, this.timeoutMs);
    } catch (err) {
      if (err instanceof AiHttpError) {
        throw new BusinessException('ISSUE_GRAPH_SERVICE_UNAVAILABLE');
      }
      throw err;
    }

    const protectTarget = aiResponse.entity_name ?? protect.target;
    const issues = this.normalizeIssues(aiResponse.issues ?? []);
    const connections = this.normalizeConnections(aiResponse.connections ?? [], issues);

    return { protect_target: protectTarget, issues, connections };
  }

  private normalizeIssues(rawIssues: IssueAiNode[]): IssueNodeResponse[] {
    const issues: IssueNodeResponse[] = rawIssues.map((node) => ({
      id: node.id ?? '',
      title: node.title ?? '',
      summary: node.summary ?? '',
      date: node.date ?? null,
      criticism: node.criticism ?? 0,
      support: node.support ?? 0,
      interest: node.interest ?? 0,
    }));

    // Sort by date ASC, nulls LAST, lexicographic string compare.
    issues.sort((a, b) => {
      if (a.date === null && b.date === null) return 0;
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });

    return issues;
  }

  private normalizeConnections(
    rawConnections: IssueAiConnection[],
    issues: IssueNodeResponse[],
  ): IssueConnectionResponse[] {
    const nodeById = new Map<string, IssueNodeResponse>();
    for (const issue of issues) {
      nodeById.set(issue.id, issue);
    }

    return rawConnections.map((connection) => {
      const sourceId = connection.source_id ?? '';
      const targetId = connection.target_id ?? '';
      const similarity = connection.similarity ?? 0;

      const source = nodeById.get(sourceId);
      const target = nodeById.get(targetId);

      // Edge always points newest -> oldest: swap when both endpoints exist,
      // both dates are non-null, and source is older than target (string compare).
      if (
        source !== undefined &&
        target !== undefined &&
        source.date !== null &&
        target.date !== null &&
        source.date < target.date
      ) {
        return { source_id: targetId, target_id: sourceId, similarity };
      }

      return { source_id: sourceId, target_id: targetId, similarity };
    });
  }
}
