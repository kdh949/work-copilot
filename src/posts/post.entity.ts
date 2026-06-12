import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn, ManyToOne } from "typeorm";
import { User } from "../users/user.entity";

@Entity()
export class Post {
    @PrimaryGeneratedColumn() // id는 기본키이고 자동 증가한다.
    id: number;

    @Column() // title 컬럼을 만든다.
    title: string;

    @Column('text') // content는 긴 문자열을 저장할 수 있는 text 컬럼이다.
    content: string;

    @ManyToOne(() => User, (user) => user.posts, {
        nullable: false, // 비어있을 수 없음 (작성자 정보 없이 게시글이 존재해서는 안되니까)
    })
    author: User;

    @CreateDateColumn() // 생성 시간이 자동으로 저장된다.
    createdAt: Date;

    @UpdateDateColumn() // 수정 시간이 자동으로 갱신된다.
    updatedAt: Date;
}