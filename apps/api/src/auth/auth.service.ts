import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
  type OnModuleInit,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { hash, verify, argon2id } from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import { Types, trusted, type Model } from 'mongoose';
import { rooms, type AuthSession } from '@relay/shared';
import { RealtimeBroadcastService } from '../realtime/broadcast.service.js';
import { z } from 'zod';
import { ENV, type Env } from '../config/environment.js';
import { type Actor } from '../common/http/actor.js';
import { duplicate } from '../database/mongo.js';
import { models } from '../database/model-names.js';
import { type SessionDoc } from './session.schema.js';
import { RedisService } from '../redis/redis.service.js';
import { UsersService } from '../users/users.service.js';
import { loginSchema, registerSchema } from './auth.dto.js';
const oid = z.string().regex(/^[0-9a-f]{24}$/);
const jwtActor = z.object({ sub: oid, sid: oid, exp: z.int() });
const accessSchema = jwtActor.extend({ kind: z.literal('access') });
const refreshSchema = jwtActor.extend({ kind: z.literal('refresh'), jti: z.uuid() });
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const hashOptions = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
    @InjectModel(models.session) private readonly sessions: Model<SessionDoc>,
    private readonly users: UsersService,
    private readonly redis: RedisService,
    private readonly broadcast: RealtimeBroadcastService,
  ) {}
  async onModuleInit() {
    this.dummyHash = await hash(randomUUID(), hashOptions);
  }

  async register(input: z.infer<typeof registerSchema>) {
    const { password, ...profile } = input;
    const passwordHash = await hash(password, hashOptions);
    try {
      return this.start(await this.users.create({ ...profile, passwordHash }));
    } catch (error) {
      if (duplicate(error)) throw new ConflictException('Username or email is already in use');
      throw error;
    }
  }
  async login(input: z.infer<typeof loginSchema>, ip: string) {
    const account = digest(input.login);
    const nonce = randomUUID();
    await Promise.all([
      this.redis.rate('login:' + account + ':' + ip, 8, 900000, nonce),
      this.redis.rate('login:account:' + account, 40, 900000, nonce),
    ]);
    const user = await this.users.credentials(input.login);
    const valid = await verify(user?.passwordHash ?? this.dummyHash, input.password);
    if (!user || !valid) throw new UnauthorizedException('Invalid username or password');
    return this.start(String(user._id));
  }
  private sign(userId: string, sid: string, refresh: boolean) {
    return this.jwt.signAsync(
      {
        sub: userId,
        sid,
        kind: refresh ? 'refresh' : 'access',
        ...(refresh ? { jti: randomUUID() } : {}),
      },
      {
        secret: refresh ? this.env.JWT_REFRESH_SECRET : this.env.JWT_ACCESS_SECRET,
        expiresIn: refresh ? this.env.REFRESH_TTL_SECONDS : this.env.ACCESS_TTL_SECONDS,
        issuer: 'relay',
        audience: refresh ? 'relay-refresh' : 'relay-api',
        algorithm: 'HS256',
      },
    );
  }
  private async verifyToken(token: string, refresh: boolean) {
    try {
      return await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        secret: refresh ? this.env.JWT_REFRESH_SECRET : this.env.JWT_ACCESS_SECRET,
        issuer: 'relay',
        audience: refresh ? 'relay-refresh' : 'relay-api',
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Session is invalid or expired');
    }
  }
  async authenticate(token: string): Promise<Actor> {
    const result = accessSchema.safeParse(await this.verifyToken(token, false));
    if (!result.success) throw new UnauthorizedException('Invalid access token');
    await this.assertActive(result.data);
    return result.data;
  }
  async assertActive(actor: Actor) {
    if (
      actor.exp <= Math.floor(Date.now() / 1000) ||
      (await this.redis.client.exists(`auth:revoked:${actor.sid}`)) ||
      !(await this.sessions.exists({
        _id: actor.sid,
        userId: actor.sub,
        revokedAt: trusted({ $exists: false }),
        expiresAt: trusted({ $gt: new Date() }),
      }))
    ) {
      throw new UnauthorizedException('Session is invalid or expired');
    }
  }
  private async start(userId: string) {
    const sid = new Types.ObjectId();
    const refreshToken = await this.sign(userId, String(sid), true);
    await this.sessions.create({
      _id: sid,
      userId,
      currentHash: digest(refreshToken),
      expiresAt: new Date(Date.now() + this.env.REFRESH_TTL_SECONDS * 1000),
    });
    return this.response(userId, String(sid), refreshToken);
  }
  private async response(
    userId: string,
    sid: string,
    refreshToken: string,
  ): Promise<{ session: AuthSession; refreshToken: string }> {
    const [accessToken, user] = await Promise.all([
      this.sign(userId, sid, false),
      this.users.me(userId),
    ]);
    return { session: { accessToken, user }, refreshToken };
  }
  async rotate(token: string) {
    const parsed = refreshSchema.safeParse(await this.verifyToken(token, true));
    if (!parsed.success) throw new UnauthorizedException('Invalid refresh token');
    const { sub, sid } = parsed.data;
    const refreshToken = await this.sign(sub, sid, true);
    const replacement = await this.sessions
      .findOneAndUpdate(
        {
          _id: sid,
          userId: sub,
          currentHash: digest(token),
          revokedAt: trusted({ $exists: false }),
          expiresAt: trusted({ $gt: new Date() }),
        },
        {
          $set: {
            currentHash: digest(refreshToken),
            expiresAt: new Date(Date.now() + this.env.REFRESH_TTL_SECONDS * 1000),
          },
        },
      )
      .lean();
    if (!replacement) {
      await this.revoke(sub, sid);
      throw new UnauthorizedException('Refresh token was already used or expired');
    }
    return this.response(sub, sid, refreshToken);
  }
  private async revoke(sub: string, sid: string) {
    await this.sessions.updateOne({ _id: sid, userId: sub }, { $set: { revokedAt: new Date() } });
    await this.redis.client.set(`auth:revoked:${sid}`, '1', 'EX', this.env.REFRESH_TTL_SECONDS);
    this.broadcast.emitter.in(rooms.session(sid)).disconnectSockets(true);
  }
  async logout(token: string | undefined) {
    if (!token) return;
    let raw: Record<string, unknown>;
    try {
      raw = await this.verifyToken(token, true);
    } catch {
      return;
    }
    const parsed = refreshSchema.safeParse(raw);
    if (parsed.success) await this.revoke(parsed.data.sub, parsed.data.sid);
  }
}
