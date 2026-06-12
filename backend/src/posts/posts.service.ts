import { Body, Injectable } from '@nestjs/common';
import { Repository } from 'typeorm'
import { PostEntity } from './posts.entity'
import { InjectRepository } from '@nestjs/typeorm';
import { CreatePostDto } from './posts.dto';

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

    createPost(dto: CreatePostDto) {
        return this.postsRepository.save({
            ...dto,
        })
    }

    modifyPost(dto: CreatePostDto) {
        return this.postsRepository;   
    }

    deletePost(id: number) {
        return this.postsRepository.delete({id});
    }
}