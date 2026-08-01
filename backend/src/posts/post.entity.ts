import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn, ManyToOne, OneToMany } from "typeorm";
import { User } from "../users/user.entity";
import { Comment } from "./comment.entity";

@Index('IDX_post_source_id_unique', ['sourceId'], { unique: true, where: '"sourceId" IS NOT NULL' })
@Entity()
export class Post {
    @PrimaryGeneratedColumn() // id는 기본키이고 자동 증가한다.
    id: number;

    @Column({ type: 'varchar', nullable: true })
    sourceId: string | null;

    @Column({ type: 'jsonb', nullable: true })
    wikiPath: string[] | null;

    @Column({ type: 'varchar', nullable: true })
    parentSourceId: string | null;

    @Column({ type: 'int', default: 0 })
    depth: number;

    @Column({ type: 'varchar', nullable: true })
    docType: string | null;

    @Column('text', { nullable: true })
    summary: string | null;

    @Column() // title 컬럼을 만든다.
    title: string;

    @Column('text') // content는 긴 문자열을 저장할 수 있는 text 컬럼이다.
    content: string;

    @Column({ default: 'wiki' })
    boardType: string;

    @Column({ default: '공통' })
    department: string;

    @Column('simple-array', { nullable: true })
    tags: string[];

    @ManyToOne(() => User, (user) => user.posts, {
        nullable: false, // 비어있을 수 없음 (작성자 정보 없이 게시글이 존재해서는 안되니까)
    })
    author: User;

    @OneToMany(() => Comment, (comment) => comment.post)
    comments: Comment[];

    @CreateDateColumn() // 생성 시간이 자동으로 저장된다.
    createdAt: Date;

    @UpdateDateColumn() // 수정 시간이 자동으로 갱신된다.
    updatedAt: Date;
}
