import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from 'typeorm';

export enum member_role {
    ADMIN = 'admin',
    MANAGER = 'manager',
    DEV = 'dev',
    MEMBER = 'member',
}

@Entity('members')
export class MemberEntity {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column()
    user_id!: string;

    @Column()
    password!: string;

    @Column()
    name!: string;

    @Column()
    nickname!: string;

    @Column({
        type: 'enum',
        enum: member_role,
        enumName: 'member_role',
        default: member_role.MEMBER
    })
    role!: member_role;

    @Column({ default: false })
    approve!: boolean;

    @CreateDateColumn({ type: 'timestamp' })
    created_at!: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updated_at!: Date;

    @Column({ 
        type: 'timestamp', 
        nullable: true
    })
    last_login!: Date | null;
}