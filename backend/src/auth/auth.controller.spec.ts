import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { SessionService } from './session/session.service';
import { AuthSession } from './entities/auth-session.entity';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: {},
        },
        {
          provide: SessionAuthGuard,
          useValue: {},
        },
        {
          provide: SessionService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('keeps the opaque session in a secure HttpOnly cookie after the OIDC callback', async () => {
    const credentials = {
      sessionToken: 'opaque-session-token',
      csrfToken: 'csrf-token-that-must-not-be-in-the-cookie',
      expiresAt: new Date('2026-08-02T01:00:00.000Z'),
    };
    const completeAuthorization = jest.fn().mockResolvedValue(credentials);
    const authService = {
      completeAuthorization,
    } as unknown as AuthService;
    const configService = {
      get: jest.fn().mockReturnValue('https://app.example.test'),
    } as unknown as ConfigService;
    const cookie = jest.fn();
    const redirect = jest.fn();
    const response = {
      cookie,
      redirect,
    } as unknown as Response;
    const subject = new AuthController(authService, configService);

    await subject.callback(
      { code: 'authorization-code', state: 'state' },
      response,
    );

    expect(cookie).toHaveBeenCalledWith(
      'work_copilot_session',
      credentials.sessionToken,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        expires: credentials.expiresAt,
      }),
    );
    expect(redirect).toHaveBeenCalledWith('https://app.example.test');
  });

  it('keeps the production session cookie first-party on the unified domain', async () => {
    const credentials = {
      sessionToken: 'opaque-session-token',
      csrfToken: 'csrf-token-that-must-not-be-in-the-cookie',
      expiresAt: new Date('2026-08-02T01:00:00.000Z'),
    };
    const authService = {
      completeAuthorization: jest.fn().mockResolvedValue(credentials),
    } as unknown as AuthService;
    const configService = {
      get: jest.fn((key: string) =>
        key === 'NODE_ENV' ? 'production' : 'https://app.example.test',
      ),
    } as unknown as ConfigService;
    const cookie = jest.fn();
    const response = {
      cookie,
      redirect: jest.fn(),
    } as unknown as Response;
    const subject = new AuthController(authService, configService);

    await subject.callback(
      { code: 'authorization-code', state: 'state' },
      response,
    );

    expect(cookie).toHaveBeenCalledWith(
      'work_copilot_session',
      credentials.sessionToken,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      }),
    );
  });

  it('returns only a rotated CSRF token to the browser', async () => {
    const credentials = {
      sessionToken: 'new-opaque-session-token',
      csrfToken: 'rotated-csrf-token',
      expiresAt: new Date('2026-08-02T01:00:00.000Z'),
    };
    const rotateSession = jest.fn().mockResolvedValue(credentials);
    const authService = {
      rotateSession,
    } as unknown as AuthService;
    const cookie = jest.fn();
    const json = jest.fn<void, [unknown]>();
    const response = {
      cookie,
      json,
    } as unknown as Response;
    const subject = new AuthController(
      authService,
      { get: jest.fn() } as unknown as ConfigService,
    );

    await subject.csrf(
      { authSession: { id: 'session-id' } as AuthSession },
      response,
    );

    expect(json).toHaveBeenCalledWith({
      csrfToken: credentials.csrfToken,
    });
    expect(cookie).toHaveBeenCalledWith(
      'work_copilot_session',
      credentials.sessionToken,
      expect.any(Object),
    );
    const responseBody = json.mock.calls[0]?.[0];
    expect(responseBody).not.toHaveProperty('sessionToken');
  });
});
