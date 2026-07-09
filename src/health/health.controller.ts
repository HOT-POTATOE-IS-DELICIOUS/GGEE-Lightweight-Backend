import { Controller, Get } from '@nestjs/common';
import { Public } from '../security/public.decorator';

/** Minimal actuator-style probes (public), mirroring the original exposed health/info. */
@Controller('actuator')
export class HealthController {
  @Public()
  @Get('health')
  health(): { status: string } {
    return { status: 'UP' };
  }

  @Public()
  @Get('info')
  info(): Record<string, never> {
    return {};
  }
}
