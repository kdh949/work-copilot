import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./user.entity";

@Module({
    imports: [TypeOrmModule.forFeature([User])], // UsersModule에서 Repository<User>를 사용할 수 있게 함
    providers: [UsersService], // providers에 등록해야만 NestJS의 IoC 컨테이너가 UsersService라는 클래스를 인지하고, 객체(인스턴스)를 생성하여 관리하기 시작
    exports: [UsersService], // 공유하고 싶은 서비스를 외부로 노출하는(공개용 API로 만드는) 선언
})
export class UsersModule {}
