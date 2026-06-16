import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { BoardsService } from './boards.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';

// 토큰 추출 helper
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

@Controller('boards')
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Post()
  create(@Body() createBoardDto: CreateBoardDto) {
    return this.boardsService.create(createBoardDto);
  }

  @Get()
  findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('keyword') keyword = '',
  ) {
    return this.boardsService.findAll(Number(page), Number(limit), keyword);
  }

  @Get('tags')
  findTags() {
    // 글쓰기 화면에서 보여줄 태그 선택지를 가져옵니다.
    return this.boardsService.findTags();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.boardsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateBoardDto: UpdateBoardDto,
    @Headers('authorization') authorization: string,
  ) {
    const token = getTokenFromHeader(authorization);
    return this.boardsService.update(id, updateBoardDto, token);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Headers('authorization') authorization: string,
  ) {
    const token = getTokenFromHeader(authorization);
    return this.boardsService.remove(id, token);
  }
}
