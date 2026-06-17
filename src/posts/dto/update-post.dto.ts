import { IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class UpdatePostDto {
    @IsString()
    @IsNotEmpty()
    @IsOptional()
    title?: string;

    @IsString()
    @IsNotEmpty()
    @IsOptional()
    content?: string;

    @IsString()
    @IsNotEmpty()
    @IsOptional()
    department?: string;

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    tags?: string[];
}
