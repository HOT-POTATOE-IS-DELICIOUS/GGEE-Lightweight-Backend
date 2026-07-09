import { Global, Module } from '@nestjs/common';
import { SnowflakeService } from './snowflake/snowflake.service';
import { AiHttpClient } from './http/ai-http.client';

/**
 * Shared, app-wide providers: snowflake id generation and the AI HTTP client helper.
 * Global so every feature module can inject them without re-importing.
 */
@Global()
@Module({
  providers: [SnowflakeService, AiHttpClient],
  exports: [SnowflakeService, AiHttpClient],
})
export class CommonModule {}
