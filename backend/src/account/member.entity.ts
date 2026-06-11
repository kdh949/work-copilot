// src/account/member.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

export enum MemberRole {
  MEMBER = 'member',
  ADMIN = 'admin',
}

@Entity('members')
export class Members {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  user_id: string;

  @Column({ type: 'varchar', length: 255 })
  password: string;

  @Column({ type: 'varchar', length: 50 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  nickname: string;

  @Column({
    type: 'enum',
    enum: MemberRole,
    enumName: 'member_role',
    default: MemberRole.MEMBER,
  })
  role: MemberRole;

  @Column({ type: 'boolean', default: false })
  approve: boolean;

  @Column({ type: 'timestamp', nullable: true })
  last_login: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}