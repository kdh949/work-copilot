import { PostCategory } from "./posts.entity";

export class CreatePostDto {
    category!: PostCategory;
    title!: string;
    location!: string;
}