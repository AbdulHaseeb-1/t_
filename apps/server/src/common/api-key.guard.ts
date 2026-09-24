import { timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfig } from '../config/app-config.js';
import { IS_PUBLIC } from './public.decorator.js';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expected?: Buffer;

  constructor(
    config: AppConfig,
    private readonly reflector: Reflector,
  ) {
    const key = config.get('API_KEY');
    this.expected = key ? Buffer.from(key) : undefined;
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.expected) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const header = ctx.switchToHttp().getRequest<{ headers: Record<string, unknown> }>().headers['x-api-key'];
    const given = Buffer.from(typeof header === 'string' ? header : '');
    if (given.length !== this.expected.length || !timingSafeEqual(given, this.expected)) {
      throw new UnauthorizedException('Missing or invalid x-api-key');
    }
    return true;
  }
}
