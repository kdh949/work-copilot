import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthSession } from '../entities/auth-session.entity';
import {
  SESSION_COOKIE_NAME,
  SessionService,
} from '../session/session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type SessionPrincipal = {
  sub: number;
  email: string;
  role: 'admin' | 'employee';
  department: string | null;
  isWorkCopilotAdmin: boolean;
};

export type AuthenticatedRequest = Request & {
  user: SessionPrincipal;
  authSession: AuthSession;
};

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessionService: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionToken = readCookie(
      request.header('cookie'),
      SESSION_COOKIE_NAME,
    );

    if (!sessionToken) {
      throw new UnauthorizedException();
    }

    const session = await this.sessionService.findActive(sessionToken);

    if (
      !SAFE_METHODS.has(request.method) &&
      !this.sessionService.hasValidCsrfToken(
        session,
        request.header('x-csrf-token'),
      )
    ) {
      throw new ForbiddenException('CSRF token is invalid.');
    }

    request.authSession = session;
    request.user = {
      sub: session.user.id,
      email: session.user.email,
      role: session.isWorkCopilotAdmin ? 'admin' : 'employee',
      department: session.user.department,
      isWorkCopilotAdmin: session.isWorkCopilotAdmin,
    };

    return true;
  }
}

export const readCookie = (
  header: string | undefined,
  name: string,
): string | undefined => {
  if (!header) {
    return undefined;
  }

  for (const value of header.split(';')) {
    const [key, ...rest] = value.trim().split('=');

    if (key === name && rest.length > 0) {
      return decodeURIComponent(rest.join('='));
    }
  }

  return undefined;
};
