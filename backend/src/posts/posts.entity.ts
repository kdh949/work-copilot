import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { MemberEntity } from '../account/member/member.entity';

export enum PostCategory {
    공지 = '공지',
    모임후기 = '모임후기',
    가입인사 = '가입인사',
    자유 = '자유',
    관심사 = '관심사',
    투표 = '투표',
}

@Entity('posts')
export class PostEntity {

    @PrimaryGeneratedColumn()
    id!: number;

    @ManyToOne(() => MemberEntity)
    @JoinColumn({ name: 'author' })
    author!: MemberEntity;

    @Column({
        type: 'enum',
        enum: PostCategory,
        enumName: 'post_category',
    })
    category!: PostCategory;

    @Column({ type: 'varchar', length: 100 })
    title!: string;

    @Column({ type: 'varchar', length: 100 })
    location!: string;

    @Column ({ type: 'int4'})
    likes!: number;

    @CreateDateColumn({ type: 'timestamp' })
    created_at!: Date;
}
