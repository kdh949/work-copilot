import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class AiChatDto {
    @IsString()
    @IsNotEmpty()
    question: string;

    @IsString()
    @IsOptional()
    department?: string;
}
