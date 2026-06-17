import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';

function getTokenFromHeader(authorization?: string) {
  if (!authorization) {
    throw new UnauthorizedException('토큰이 없습니다.');
  }

  const [type, token] = authorization.split(' ');

  if (type !== 'Bearer' || !token) {
    throw new UnauthorizedException('토큰 형식이 올바르지 않습니다.');
  }

  return token;
}

@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get('recent')
  findRecent() {
    return this.commentsService.findRecent();
  }

  @Get()
  findByBoardId(@Query('boardId', ParseIntPipe) boardId: number) {
    return this.commentsService.findByBoardId(boardId);
  }

  @Post()
  create(
    @Body() createCommentDto: CreateCommentDto,
    @Headers('authorization') authorization: string,
  ) {
    const token = getTokenFromHeader(authorization);
    return this.commentsService.create(createCommentDto, token);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Headers('authorization') authorization: string,
  ) {
    const token = getTokenFromHeader(authorization);
    return this.commentsService.remove(id, token);
  }
}
