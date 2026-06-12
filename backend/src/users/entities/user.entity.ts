import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  // id! TypeScript야, 이 값은 나중에 TypeORM이 넣어줄 거야.
  id!: number;

  @Column({ unique: true })
  loginId!: string;

  @Column()
  password!: string;
}
