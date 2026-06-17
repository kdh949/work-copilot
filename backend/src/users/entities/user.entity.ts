import { Board } from '../../boards/entities/board.entity';
import { Comment } from '../../comments/entities/comment.entity';
import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  // id! TypeScript야, 이 값은 나중에 TypeORM이 넣어줄 거야.
  id!: number;

  @Column({ unique: true })
  loginId!: string;

  @Column()
  password!: string;

  @OneToMany(() => Board, (board) => board.user)
  boards!: Board[];

  @OneToMany(() => Comment, (comment) => comment.user)
  comments!: Comment[];
}
