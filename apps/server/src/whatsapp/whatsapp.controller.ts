import { Controller, ForbiddenException, Get, Header, HttpCode, NotFoundException, Post, Query, type RawBodyRequest, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { Public } from '../common/public.decorator.js';
import { WhatsAppService } from './whatsapp.service.js';

/**
 * Meta's webhook. Public (Meta cannot send our API key) but authenticated
 * another way: the GET handshake needs WHATSAPP_VERIFY_TOKEN, and every POST
 * must carry a valid X-Hub-Signature-256 made with WHATSAPP_APP_SECRET.
 */
@Public()
@SkipThrottle()
@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get('webhook')
  @Header('content-type', 'text/plain')
  verify(@Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string) {
    if (!this.whatsapp.webhookReady) throw new NotFoundException('WhatsApp is not configured');
    if (!this.whatsapp.verifyChallenge(mode, token)) throw new ForbiddenException('Verify token mismatch');
    return challenge ?? '';
  }

  @Post('webhook')
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest<FastifyRequest>) {
    if (!this.whatsapp.webhookReady) throw new NotFoundException('WhatsApp is not configured');
    const signature = req.headers['x-hub-signature-256'];
    if (!this.whatsapp.validSignature(req.rawBody, typeof signature === 'string' ? signature : undefined)) {
      throw new ForbiddenException('Invalid signature');
    }
    return { received: this.whatsapp.accept(req.body as Parameters<WhatsAppService['accept']>[0]) };
  }
}
