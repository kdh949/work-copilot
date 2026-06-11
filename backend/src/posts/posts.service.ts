import { Injectable } from '@nestjs/common';

@Injectable()
export class PostService {
    private posts = [];

    getAllPosts() {
        return this.posts;
    }
}
