import { IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreatePostDto {
    @IsString()
    @IsNotEmpty()
    title: string;

    @IsString()
    @IsNotEmpty()
    content: string;

    @IsString()
    @IsOptional()
    department?: string;

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    tags?: string[];
}
