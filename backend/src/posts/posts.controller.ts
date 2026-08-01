import {
  Controller,
  Body,
  Delete,
  Get,
  Param,
  Patch,
  Post as HttpPost,
  Query,
  ParseIntPipe,
  Req,
  UseGuards,
} from '@nestjs/common'; // 이름이 게시글의 post와 겹치므로 Post as HttpPost 를 이용해서 HttpPost로 변경
import { PostsService, type PostAccessContext } from './posts.service';
import { Post } from './post.entity';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import {
  SessionAuthGuard,
  type AuthenticatedRequest,
} from '../auth/guards/session-auth.guard';
import { CreateCommentDto } from './dto/create-comment.dto';
import { Comment } from './comment.entity';
import { UpdateCommentDto } from './dto/update-comment.dto';

@Controller('posts') // 이 Controller 안의 API들은 기본적으로 /posts로 시작한다는 의미
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @UseGuards(SessionAuthGuard)
  @Get()
  findAll(
    @Req() request: AuthenticatedRequest,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('tag') tag?: string,
    @Query('department') department?: string,
    @Query('boardType') boardType?: string,
  ) {
    return this.postsService.findAll(
      { keyword, page, limit, tag, department, boardType },
      this.getActor(request),
    );
  }

  @UseGuards(SessionAuthGuard)
  @Get('wiki/tree')
  findWikiTree(@Req() request: AuthenticatedRequest) {
    return this.postsService.findWikiTree(this.getActor(request));
  }

  @UseGuards(SessionAuthGuard)
  @Get('wiki')
  findWikiPosts(
    @Req() request: AuthenticatedRequest,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('tag') tag?: string,
    @Query('path') path?: string | string[],
  ) {
    return this.postsService.findWikiPosts(
      { keyword, page, limit, tag, path },
      this.getActor(request),
    );
  }

  @UseGuards(SessionAuthGuard)
  @Get('questions/my')
  findMyQuestions(
    @Query('keyword') keyword: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('tag') tag: string | undefined,
    @Query('department') department: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.postsService.findAll({
      keyword,
      page,
      limit,
      tag,
      department,
      boardType: 'question',
      mine: true,
      userId: request.user.sub,
      includeQuestions: true,
    });
  }

  @UseGuards(SessionAuthGuard)
  @Get('notes/my')
  findMyNotes(
    @Query('keyword') keyword: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('tag') tag: string | undefined,
    @Query('department') department: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.postsService.findAll({
      keyword,
      page,
      limit,
      tag,
      department,
      boardType: 'note',
      mine: true,
      userId: request.user.sub,
      includeQuestions: true,
    });
  }

  @UseGuards(SessionAuthGuard)
  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ): Promise<Post> {
    return this.postsService.findOne(id, this.getActor(request));
  }

  @UseGuards(SessionAuthGuard)
  @HttpPost()
  create(
    @Body() createPostDto: CreatePostDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<Post> {
    return this.postsService.create(
      createPostDto,
      request.user.sub,
      request.user.role,
    );
  }

  @UseGuards(SessionAuthGuard)
  @HttpPost('questions')
  createQuestion(
    @Body() createPostDto: CreatePostDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<Post> {
    return this.postsService.createQuestion(createPostDto, request.user.sub);
  }

  @UseGuards(SessionAuthGuard)
  @HttpPost('notes')
  createNote(
    @Body() createPostDto: CreatePostDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<Post> {
    return this.postsService.createNote(createPostDto, request.user.sub);
  }

  @UseGuards(SessionAuthGuard)
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updatePostDto: UpdatePostDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<Post> {
    return this.postsService.update(
      id,
      updatePostDto,
      request.user.sub,
      request.user.role,
    );
  }

  @UseGuards(SessionAuthGuard)
  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ deleted: boolean }> {
    return this.postsService.remove(id, request.user.sub, request.user.role);
  }

  @UseGuards(SessionAuthGuard)
  @HttpPost(':id/comments')
  createComment(
    @Param('id', ParseIntPipe) id: number,
    @Body() createCommentDto: CreateCommentDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<Comment> {
    return this.postsService.createComment(
      id,
      createCommentDto,
      request.user.sub,
    );
  }

  @UseGuards(SessionAuthGuard)
  @Patch(':postId/comments/:commentId')
  updateComment(
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() updateCommentDto: UpdateCommentDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<Comment> {
    return this.postsService.updateComment(
      commentId,
      updateCommentDto,
      request.user.sub,
    );
  }

  @UseGuards(SessionAuthGuard)
  @Delete(':postId/comments/:commentId')
  removeComment(
    @Param('commentId', ParseIntPipe) commentId: number,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ deleted: boolean }> {
    return this.postsService.removeComment(
      commentId,
      request.user.sub,
      request.user.role,
    );
  }

  private getActor(request: AuthenticatedRequest): PostAccessContext {
    return {
      userId: request.user.sub,
      role: request.user.role,
      department: request.user.department,
    };
  }
}
