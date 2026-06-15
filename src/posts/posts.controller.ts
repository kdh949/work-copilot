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
import { PostsService } from "./posts.service";
import { Post } from './post.entity';
import { CreatePostDto } from "./dto/create-post.dto";
import { UpdatePostDto } from "./dto/update-post.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { AuthenticatedRequest } from "../auth/guards/jwt-auth.guard"

@Controller('posts') // 이 Controller 안의 API들은 기본적으로 /posts로 시작한다는 의미
export class PostsController {
    constructor(private readonly postsService: PostsService) {
    }

    @Get()
    findAll(@Query('keyword') keyword?: string): Promise<Post[]> {
        return this.postsService.findAll(keyword);
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number): Promise<Post> {
        return this.postsService.findOne(id);
    }

    @UseGuards(JwtAuthGuard)
    @HttpPost()
    create(@Body() createPostDto: CreatePostDto,
           @Req() request: AuthenticatedRequest,
    ): Promise<Post> {
        return this.postsService.create(createPostDto, request.user.sub);
    }

    @Patch(':id')
    update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updatePostDto: UpdatePostDto,
    ): Promise<Post> {
        return this.postsService.update(id, updatePostDto);
    }

    @Delete(':id')
    remove(@Param('id', ParseIntPipe) id: number): Promise<{ deleted: boolean }> {
        return this.postsService.remove(id);
    }
}
