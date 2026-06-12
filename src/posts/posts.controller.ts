import {Controller, Body, Delete, Get, Param, Patch, Post, Query, ParseIntPipe} from '@nestjs/common';
import {PostsService} from "./posts.service";
import type {PostItem} from './posts.service';
import {CreatePostDto} from "./dto/create-post.dto";
import {UpdatePostDto} from "./dto/update-post.dto";

@Controller('posts') // 이 Controller 안의 API들은 기본적으로 /posts로 시작한다는 의미
export class PostsController {
    constructor(private readonly postsService: PostsService) {
    }

    @Get()
    findAll(@Query('keyword') keyword?: string): PostItem[] {
        return this.postsService.findAll(keyword);
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number): PostItem {
        return this.postsService.findOne(id);
    }

    @Post()
    create(@Body() createPostDto: CreatePostDto): PostItem {
        return this.postsService.create(createPostDto);
    }

    @Patch(':id')
    update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updatePostDto: UpdatePostDto,
    ): PostItem | undefined {
        return this.postsService.update(id, updatePostDto);
    }

    @Delete(':id')
    remove(@Param('id', ParseIntPipe) id: number): { deleted: boolean } {
        return this.postsService.remove(id);
    }
}
