import { Body, Injectable } from '@nestjs/common';
import { Repository } from 'typeorm'
import { Post } from './posts.entity'
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class PostService {

    constructor(
        @InjectRepository(Post)
        private postsRepository: Repository<Post>
    ) {}

    viewAllPosts() {
        return this.postsRepository.find({ relations: { author: true} })
    }

    viewDetail(id: number) {
        return this.postsRepository.findOne({ where: { id }});
    }

    createPost() {
        return this.postsRepository;
    }

    modifyPost() {
        return this.postsRepository;   
    }

    deletePost() {
        return this.postsRepository;
    }
}