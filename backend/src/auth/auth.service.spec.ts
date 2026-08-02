import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { KeycloakOidcService } from './oidc/keycloak-oidc.service';
import { SessionService } from './session/session.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {},
        },
        {
          provide: KeycloakOidcService,
          useValue: {},
        },
        {
          provide: SessionService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('maps the verified Keycloak identity before creating an opaque session', async () => {
    const identity = {
      subject: 'keycloak-subject',
      email: 'pilot@example.test',
      isWorkCopilotAdmin: true,
    };
    const user = {
      id: 4,
      email: identity.email,
    };
    const credentials = {
      sessionToken: 'opaque-session-token',
      csrfToken: 'csrf-token',
      expiresAt: new Date('2026-08-02T01:00:00.000Z'),
    };
    const completeAuthorization = jest.fn().mockResolvedValue(identity);
    const keycloakOidcService = {
      completeAuthorization,
    } as unknown as KeycloakOidcService;
    const mapVerifiedKeycloakIdentity = jest.fn().mockResolvedValue(user);
    const usersService = {
      mapVerifiedKeycloakIdentity,
    } as unknown as UsersService;
    const createSession = jest.fn().mockResolvedValue(credentials);
    const sessionService = {
      create: createSession,
    } as unknown as SessionService;
    const subject = new AuthService(
      usersService,
      keycloakOidcService,
      sessionService,
    );

    await expect(
      subject.completeAuthorization('authorization-code', 'state'),
    ).resolves.toEqual(credentials);
    expect(mapVerifiedKeycloakIdentity).toHaveBeenCalledWith(identity);
    expect(createSession).toHaveBeenCalledWith(user, true);
  });
});
