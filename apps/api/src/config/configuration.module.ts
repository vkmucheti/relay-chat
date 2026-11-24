import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ENV, type Env } from './environment.js';
@Global()
@Module({})
export class ConfigurationModule {
  static register(env: Env): DynamicModule {
    return {
      module: ConfigurationModule,
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true })],
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
