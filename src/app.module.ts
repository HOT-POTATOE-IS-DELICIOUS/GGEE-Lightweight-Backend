import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ValidationPipe } from '@nestjs/common';
import configuration from './config/configuration';
import { CommonModule } from './common/common.module';
import { GlobalExceptionFilter } from './common/error/global-exception.filter';
import { HealthController } from './health/health.controller';
import { RedisModule } from './redis/redis.module';
import { MemberModule } from './modules/member/member.module';
import { ProtectModule } from './modules/protect/protect.module';
import { AuditModule } from './modules/audit/audit.module';
import { IssueModule } from './modules/issue/issue.module';
import { ReactionModule } from './modules/reaction/reaction.module';
import { StrategyModule } from './modules/strategy/strategy.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('database.host'),
        port: config.getOrThrow<number>('database.port'),
        username: config.getOrThrow<string>('database.username'),
        password: config.getOrThrow<string>('database.password'),
        database: config.getOrThrow<string>('database.database'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    ScheduleModule.forRoot(),
    CommonModule,
    RedisModule,
    ProtectModule,
    MemberModule,
    AuditModule,
    IssueModule,
    ReactionModule,
    StrategyModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class AppModule {}
