type Post = {
    id: number;
    title: string;
    content: string;
    viewCount: number;
};

function printPost(post:Post): string {
    return `[${post.id}] ${post.title} - 조회수 ${post.viewCount}`;
}

const firstPost: Post = {
    id: 1,
    title: 'TypeScript 시작',
    content: '타입을 배워봅니다.',
    viewCount: 0,
};

const result = printPost(firstPost);

console.log(result);