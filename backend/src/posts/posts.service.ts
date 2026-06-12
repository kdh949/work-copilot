import { Body, Injectable } from '@nestjs/common';
import { Repository } from 'typeorm'
import { PostEntity } from './posts.entity'
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class PostService {

    constructor(
        @InjectRepository(PostEntity)
        private postsRepository: Repository<PostEntity>
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