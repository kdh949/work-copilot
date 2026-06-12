type Post = {
    id: number;
    title: string;
    content: string;
};

type ApiResponse<T> = {
    data: T;
    message: string;
};

function wrapResponse<T>(data: T): ApiResponse<T> {
    return {
        data,
        message: 'success',
    };
}

async function fetchPost(): Promise<Post> {
    return {
        id: 1,
        title: 'TypeScript 3강',
        content: 'generic과 async를 배웁니다.'
    };
}

async function main() {
    const post = await fetchPost();

    const response = wrapResponse<Post>(post);

    console.log(response.message);
    console.log(response.data.title);
}

main();