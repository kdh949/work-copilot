import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
} from 'typeorm';
import { Board } from '../../boards/entities/board.entity';

@Entity()
export class Comment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  boardId!: number;

  @Column('text')
  content!: string;

  @Column()
  writer!: string;

  // 댓글 N <-> 게시글 1
  @ManyToOne(() => Board, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'boardId' })
  board!: Board;
}
