import { Controller, Get } from '@nestjs/common';
import { PostService } from './posts.service';

@Controller('posts')
export class PostsController {
    constructor(private postService: PostService) {}

    @Get()
    getAllPosts() {
        return this.postService.getAllPosts();
    }
}