import { Injectable } from '@nestjs/common';
import { AuthSession } from './entities/auth-session.entity';
import { KeycloakOidcService } from './oidc/keycloak-oidc.service';
import { SessionCredentials, SessionService } from './session/session.service';
import { UsersService } from '../users/users.service';

export type MeResponse = {
  id: number;
  email: string;
  nickname: string;
  department: string | null;
  employeeNumber: string | null;
  role: 'admin' | 'employee';
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly keycloakOidcService: KeycloakOidcService,
    private readonly sessionService: SessionService,
  ) {}

  async createAuthorizationUrl(): Promise<string> {
    return this.keycloakOidcService.createAuthorizationUrl();
  }

  async completeAuthorization(
    code: string,
    state: string,
  ): Promise<SessionCredentials> {
    const identity = await this.keycloakOidcService.completeAuthorization(
      code,
      state,
    );
    const user = await this.usersService.mapVerifiedKeycloakIdentity(identity);

    return this.sessionService.create(user, identity.isWorkCopilotAdmin);
  }

  async rotateSession(session: AuthSession): Promise<SessionCredentials> {
    return this.sessionService.rotate(session);
  }

  async logout(session: AuthSession): Promise<void> {
    await this.sessionService.revoke(session);
  }

  me(session: AuthSession): MeResponse {
    return {
      id: session.user.id,
      email: session.user.email,
      nickname: session.user.nickname,
      department: session.user.department,
      employeeNumber: session.user.employeeNumber,
      role: session.isWorkCopilotAdmin ? 'admin' : 'employee',
    };
  }
}
