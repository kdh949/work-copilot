import { Column, Entity, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Board } from './board.entity';

@Entity('tags')
export class Tag {
  @PrimaryGeneratedColumn()
  id!: number;

  // 태그 이름입니다.
  // unique라서 같은 이름의 태그가 여러 번 생기지 않습니다.
  @Column({ unique: true })
  name!: string;

  // 태그 하나는 여러 게시글에 붙을 수 있습니다.
  // 예: "알고리즘" 태그를 여러 글이 함께 사용할 수 있습니다.
  @ManyToMany(() => Board, (board) => board.tags)
  boards!: Board[];
}
