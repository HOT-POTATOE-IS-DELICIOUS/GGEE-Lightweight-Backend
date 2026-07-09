import { Role } from './role.enum';

/**
 * The authenticated principal attached to the request by JwtAuthGuard.
 * Port of `CustomAuthPrincipal(userId, role, sessionId)` — userId/sessionId are
 * snowflake decimal strings.
 */
export interface AuthUser {
  userId: string;
  role: Role;
  sessionId: string;
}
