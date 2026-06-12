import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'NestJS 게시판 API 시작!';
  }

  getHealth(): string {
    return 'OK';
  }
}
