import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { Post } from "./post.entity";
import { User } from "../users/user.entity";

@Entity()
export class Comment {
    @PrimaryGeneratedColumn()
    id: number;

    @Column('text')
    content: string;

    @Column({ default: false })
    isAi: boolean;

    @ManyToOne(() => Post, (post) => post.comments, {
        nullable: false,
        onDelete: 'CASCADE',
    })
    post: Post;

    @ManyToOne(() => User, {
        nullable: true,
    })
    author: User | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
