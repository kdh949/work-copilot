// src/account/join/join.controller.ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { JoinService } from './join.service';
import { JoinDto } from './join.dto';

@Controller('account/join')
export class JoinController {
  constructor(private readonly joinService: JoinService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async join(@Body() dto: JoinDto) {
    return this.joinService.join(dto);
  }
}