import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

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

  @Column()
  tag!: string;

  @Column({ default: '' })
  writer!: string;
}
