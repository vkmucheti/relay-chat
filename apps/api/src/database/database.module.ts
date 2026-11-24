import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ENV, type Env } from '../config/environment.js';
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        uri: env.MONGO_URL,
        serverSelectionTimeoutMS: 5000,
        autoIndex: true,
        sanitizeFilter: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
