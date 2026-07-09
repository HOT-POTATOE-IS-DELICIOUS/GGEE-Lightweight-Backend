import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as public (no authentication required).
 * Equivalent to the original `SecurityPaths.PUBLIC_PATHS` allow-list:
 * /auth/register, /auth/login, /auth/refresh, /actuator/health, /actuator/info.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
