import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
} from 'typeorm';
import { Board } from '../../boards/entities/board.entity';
import { User } from '../../users/entities/user.entity';

@Entity()
export class Comment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  boardId!: number;

  @Column('text')
  content!: string;

  @Column({ nullable: true })
  userId!: number | null;

  // 댓글 작성자도 userId로 User 테이블을 참조합니다.
  // writer 문자열은 기존 데이터와 응답 호환을 위해 보조로 유지합니다.
  @ManyToOne(() => User, (user) => user.comments, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user!: User | null;

  @Column()
  writer!: string;

  // 댓글 N <-> 게시글 1
  @ManyToOne(() => Board, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'boardId' })
  board!: Board;
}
