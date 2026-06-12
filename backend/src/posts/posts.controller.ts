// Get, Post, Patch, Delete는 HTTP 기본 프로토콜 메서드
// Param : URL에서 id 받을 때 필요
// Body : Post에서 작성 / 수정 시 데이터 불러올 때 필요
import { Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe } from '@nestjs/common';
import { PostService } from './posts.service';
import { CreatePostDto } from './posts.dto';

@Controller('posts')
export class PostsController {
    constructor(private postService: PostService) {}

    @Get()
    viewAllPosts() {
        return this.postService.viewAllPosts();
    }

    @Get(':id')
    viewDetail(@Param('id', ParseIntPipe) id: number) {
        return this.postService.viewDetail(id)
    }

    @Post()
    createPost(@Body() dto: CreatePostDto) {
        return this.postService.createPost(dto)
    }
    @Patch(':id') 
    modifyPost(@Param('id') id: string, @Body() modifyPostDto) {
        
    }
    @Delete(':id')
    deletePost(@Param('id') id: string) {

    }
}