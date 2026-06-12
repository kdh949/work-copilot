import { 
    Injectable, 
    CanActivate, 
    ExecutionContext,
    UnauthorizedException
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private jwtService: JwtService) {}

    // true -> 요청 통과, false -> 요청 차단
    // CanActivate 함수 실행 시 요청 수락할지, 거부할지 판단
    canActivate(context: ExecutionContext): boolean {

        // switchToHttp() = HTTP 프로토콜 사용
        // ExecutionContext 선언 시 리퀘스트 데이터 래퍼해서 가져옴
        // 그 값 보관
        const request = context.switchToHttp().getRequest();
        // request의 header에서 Authorization 값 가져옴.
        // 헤더 안에 Bearer라는 키와 같이 담긴 값이 있는데, 그 값을 split하고
        // 0과 1을 봤을 때, 1번 인덱스에 있는 값이 키 값이 나옴.
        const token = request.headers.authorization?.split(' ')[1];

        // 위 작업 했는데 안되면 에러 반환
        if (!token) throw new UnauthorizedException();

        try {
            const payload = this.jwtService.verify(token);
            request.user = payload;
            return true;
        } catch {
            throw new UnauthorizedException();
        }
    }
}