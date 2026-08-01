import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class AiOnboardingDto {
    @IsString()
    @IsNotEmpty()
    department: string;

    @IsString()
    @IsOptional()
    employeeName?: string;
}
