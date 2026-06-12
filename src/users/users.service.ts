import { ConflictException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "./user.entity";

type CreateUserInput = {
    email: string;
    password: string;
    nickname: string;
};

@Injectable()
export class UsersService {
    constructor(@InjectRepository(User) private readonly userRepository: Repository<User>) {}

    async findByEmail(email: string): Promise<User | null> {
        return this.userRepository.findOne({
            where: { email },
        });
    }

    async findById(id: number): Promise<User | null> {
        return this.userRepository.findOne({
            where: { id },
        });
    }

    async create(input: CreateUserInput): Promise<User> {
        const existingUser = await this.findByEmail((input.email));

        if (existingUser) {
            throw new ConflictException('이미 사용 중인 이메일입니다.');
        }

        const user = this.userRepository.create({
            email: input.email,
            password: input.password,
            nickname: input.nickname,
        });

        return this.userRepository.save(user);
    }
}