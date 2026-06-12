import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class Post {
    @PrimaryGeneratedColumn() // id는 기본키이고 자동 증가한다.
    id: number;

    @Column() // title 컬럼을 만든다.
    title: string;

    @Column('text') // content는 긴 문자열을 저장할 수 있는 text 컬럼이다.
    content: string;

    @CreateDateColumn() // 생성 시간이 자동으로 저장된다.
    createdAt: Date;

    @UpdateDateColumn() // 수정 시간이 자동으로 갱신된다.
    updatedAt: Date;
}