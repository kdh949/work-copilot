import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { parseFrontendOrigins } from '../config/security.config';
import { AuthService } from './auth.service';
import { OidcCallbackDto } from './dto/oidc-callback.dto';
import {
  SessionAuthGuard,
  type AuthenticatedRequest,
} from './guards/session-auth.guard';
import {
  SESSION_COOKIE_NAME,
  SessionCredentials,
} from './session/session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Get('oidc/login')
  async login(@Res() response: Response): Promise<void> {
    response.redirect(await this.authService.createAuthorizationUrl());
  }

  @Get('oidc/callback')
  async callback(
    @Query() callback: OidcCallbackDto,
    @Res() response: Response,
  ): Promise<void> {
    const credentials = await this.authService.completeAuthorization(
      callback.code,
      callback.state,
    );
    this.setSessionCookie(response, credentials);
    response.redirect(
      parseFrontendOrigins(
        this.configService.get<string>('FRONTEND_ORIGINS'),
      )[0],
    );
  }

  @UseGuards(SessionAuthGuard)
  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return this.authService.me(request.authSession);
  }

  @UseGuards(SessionAuthGuard)
  @Get('csrf')
  async csrf(@Req() request: AuthenticatedRequest, @Res() response: Response) {
    const credentials = await this.authService.rotateSession(
      request.authSession,
    );
    this.setSessionCookie(response, credentials);
    return response.json({ csrfToken: credentials.csrfToken });
  }

  @UseGuards(SessionAuthGuard)
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    await this.authService.logout(request.authSession);
    response.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions());
    response.status(204).send();
  }

  private setSessionCookie(
    response: Response,
    credentials: SessionCredentials,
  ): void {
    response.cookie(SESSION_COOKIE_NAME, credentials.sessionToken, {
      ...this.cookieOptions(),
      expires: credentials.expiresAt,
    });
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: true,
      sameSite: 'lax' as const,
      path: '/',
    };
  }
}
