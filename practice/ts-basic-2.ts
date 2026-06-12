type PostStatus = 'DRAFT' | 'PUBLISHED';

interface User {
    id: number;
    email: string;
    nickname?: string;
}

type Post = {
    id: number;
    title: string;
    content: string;
    status: PostStatus;
    author: User;
}

function printAuthor(user: User): string {
    if(user.nickname) {
        return `${user.nickname} <${user.email}>`;
    }

    return user.email;
}

function printPost(post: Post): string {
    return `[${post.status}] ${post.title} by ${printAuthor(post.author)}`
}

const post:Post = {
    id: 1,
    title: 'TypeScript 2강',
    content: 'interface, optional, union을 배웁니다.',
    status: 'PUBLISHED',
    author: {
        id: 1,
        email: 'jungle@example.com',
        nickname: '정글러',
    },
};

console.log(printPost(post));