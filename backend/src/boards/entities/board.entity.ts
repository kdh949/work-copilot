import {
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tag } from './tag.entity';
import { User } from '../../users/entities/user.entity';

@Entity()
export class Board {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  //  @Column()       → 일반 문자열 컬럼
  //  @Column('text') → 긴 글 저장용 text 컬럼
  @Column('text')
  content!: string;

  // 게시글 하나는 여러 태그를 가질 수 있습니다.
  // 예: 글 하나에 "알고리즘", "정글", "후기" 태그를 모두 붙일 수 있습니다.
  @ManyToMany(() => Tag, (tag) => tag.boards, { cascade: ['insert'] })
  @JoinTable({
    // board_tags는 게시글과 태그를 연결해주는 중간 표입니다.
    // board_id는 게시글 번호, tag_id는 태그 번호를 저장합니다.
    name: 'board_tags',
    joinColumn: { name: 'board_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags!: Tag[];

  @Column({ nullable: true })
  userId!: number | null;

  // 게시글 작성자는 userId로 User 테이블을 참조합니다.
  // 기존 writer 문자열은 예전 데이터와 화면 표시 호환을 위해 남겨둡니다.
  @ManyToOne(() => User, (user) => user.boards, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user!: User | null;

  @Column({ default: '' })
  writer!: string;

  @Column({ default: 0 })
  viewCount!: number;
}
