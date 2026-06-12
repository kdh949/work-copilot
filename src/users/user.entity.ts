import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity('users') // 엔티티 명칭을 클래스명이 아닌 users로 사용 (테이블명이 users로 생성됨)
export class User {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true }) // 중복으로 있을 수 없음을 표시
    email: string;

    @Column()
    password: string;

    @Column()
    nickname: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}