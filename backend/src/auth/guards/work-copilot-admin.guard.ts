import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedRequest } from './session-auth.guard';

@Injectable()
export class WorkCopilotAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user?.isWorkCopilotAdmin) {
      throw new ForbiddenException(
        'Work Copilot administrator permission is required.',
      );
    }

    return true;
  }
}
