import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "./user.entity";

type CreateUserInput = {
    email: string;
    password: string;
    nickname: string;
    department: string;
    employeeNumber: string;
    role?: string;
};

@Injectable()
export class UsersService {
    constructor(@InjectRepository(User) private readonly userRepository: Repository<User>) {}

    async findByEmail(email: string): Promise<User | null> {
        return this.userRepository.findOne({
            where: { email },
        });
    }

    async findByEmailWithPassword(email: string): Promise<User | null> {
        return this.userRepository
            .createQueryBuilder('user')
            .addSelect('user.password')
            .where('user.email = :email', { email })
            .getOne();
    }

    async findByEmployeeNumber(employeeNumber: string): Promise<User | null> {
        return this.userRepository.findOne({
            where: { employeeNumber },
        });
    }

    async findById(id: number): Promise<User | null> {
        return this.userRepository.findOne({
            where: { id },
        });
    }

    async findByIdOrFail(id: number): Promise<User> {
        const user = await this.findById(id);

        if (!user) {
            throw new NotFoundException('사용자를 찾을 수 없습니다.');
        }

        return user;
    }

    async create(input: CreateUserInput): Promise<User> {
        const existingUser = await this.findByEmail((input.email));

        if (existingUser) {
            throw new ConflictException('이미 사용 중인 이메일입니다.');
        }

        const existingEmployee = await this.findByEmployeeNumber(input.employeeNumber);

        if (existingEmployee) {
            throw new ConflictException('이미 사용 중인 사번입니다.');
        }

        const user = this.userRepository.create({
            email: input.email,
            password: input.password,
            nickname: input.nickname,
            department: input.department,
            employeeNumber: input.employeeNumber,
            role: input.role || 'employee',
        });

        return this.userRepository.save(user);
    }

    async count(): Promise<number> {
        return this.userRepository.count();
    }
}
