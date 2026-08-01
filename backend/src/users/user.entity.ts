import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Post } from '../posts/post.entity';
import { Comment } from '../posts/comment.entity';

@Entity('users') // 엔티티 명칭을 클래스명이 아닌 users로 사용 (테이블명이 users로 생성됨)
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true }) // 중복으로 있을 수 없음을 표시
  email: string;

  @Column({ type: 'varchar', select: false, nullable: true })
  password: string | null;

  @Column()
  nickname: string;

  @Column({ type: 'varchar', nullable: true })
  department: string | null;

  @Column({ type: 'varchar', unique: true, nullable: true })
  employeeNumber: string | null;

  @Column({ default: 'employee' })
  role: string;

  @Column({ type: 'varchar', unique: true, nullable: true })
  keycloakSubject: string | null;

  @Column({ type: 'varchar', nullable: true })
  identityProvider: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  legacyMigratedAt: Date | null;

  @OneToMany(() => Post, (post) => post.author)
  posts: Post[];

  @OneToMany(() => Comment, (comment) => comment.author)
  comments: Comment[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
