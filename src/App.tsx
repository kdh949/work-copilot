import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Header, type MenuName } from "./components/Header";

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type User = {
    id: number;
    email: string;
    nickname: string;
};

type Comment = {
    id: number;
    content: string;
    isAi: boolean;
    author: User | null;
    createdAt: string;
};

type BoardPost = {
    id: number;
    title: string;
    content: string;
    boardType: string;
    department: string;
    tags: string[];
    author: User;
    comments: Comment[];
    createdAt: string;
};

type PostListResponse = {
    items: BoardPost[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
};

function App() {
    const [menu, setMenu] = useState<MenuName>('posts');
    const [token, setToken] = useState(localStorage.getItem('accessToken') || '');
    const [user, setUser] = useState<User | null>(null);
    const [message, setMessage] = useState('');

    const [signupEmail, setSignupEmail] = useState('');
    const [signupPassword, setSignupPassword] = useState('');
    const [signupNickname, setSignupNickname] = useState('');

    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');

    const [posts, setPosts] = useState<BoardPost[]>([]);
    const [totalPages, setTotalPages] = useState(1);
    const [page, setPage] = useState(1);
    const [keyword, setKeyword] = useState('');
    const [departmentFilter, setDepartmentFilter] = useState('');
    const [tagFilter, setTagFilter] = useState('');

    const [editingPostId, setEditingPostId] = useState<number | null>(null);
    const [postTitle, setPostTitle] = useState('');
    const [postContent, setPostContent] = useState('');
    const [postDepartment, setPostDepartment] = useState('공통');
    const [postTags, setPostTags] = useState('');

    const [commentText, setCommentText] = useState<Record<number, string>>({});

    const [questionTitle, setQuestionTitle] = useState('');
    const [questionContent, setQuestionContent] = useState('');
    const [questionDepartment, setQuestionDepartment] = useState('인사');
    const [questionTags, setQuestionTags] = useState('');

    useEffect(() => {
        if (menu === 'posts' || menu === 'questions') {
            loadPosts();
        }
    }, [page, keyword, departmentFilter, tagFilter, menu, token]);

    useEffect(() => {
        if (token) {
            loadMe();
        }
    }, [token]);

    async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        const response = await fetch(`${API_BASE_URL}${path}`, {
            ...options,
            headers,
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const errorMessage = Array.isArray(data.message) ? data.message.join(', ') : data.message;
            throw new Error(errorMessage || '요청 처리에 실패했습니다.');
        }

        return data as T;
    }

    async function loadMe() {
        try {
            const me = await request<User>('/auth/me');
            setUser(me);
        } catch {
            handleLogout();
        }
    }

    async function loadPosts() {
        try {
            const params = new URLSearchParams();

            params.set('page', String(page));
            params.set('limit', '5');

            if (keyword) {
                params.set('keyword', keyword);
            }
            if (departmentFilter) {
                params.set('department', departmentFilter);
            }
            if (tagFilter) {
                params.set('tag', tagFilter);
            }

            const path = menu === 'questions'
                ? `/posts/questions/my?${params.toString()}`
                : `/posts?boardType=wiki&${params.toString()}`;

            if (menu === 'questions' && !token) {
                setPosts([]);
                setTotalPages(1);
                return;
            }

            const data = await request<PostListResponse>(path);

            setPosts(data.items);
            setTotalPages(data.totalPages || 1);
        } catch (error) {
            showError(error);
        }
    }

    async function handleSignupSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        try {
            await request('/auth/signup', {
                method: 'POST',
                body: JSON.stringify({
                    email: signupEmail,
                    password: signupPassword,
                    nickname: signupNickname,
                }),
            });

            setMessage('회원가입이 완료되었습니다. 로그인해주세요.');
            setMenu('login');
        } catch (error) {
            showError(error);
        }
    }

    async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        try {
            const data = await request<{ accessToken: string }>('/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                    email: loginEmail,
                    password: loginPassword,
                }),
            });

            localStorage.setItem('accessToken', data.accessToken);
            setToken(data.accessToken);
            setMessage('로그인되었습니다.');
            setMenu('posts');
        } catch (error) {
            showError(error);
        }
    }

    function handleLogout() {
        localStorage.removeItem('accessToken');
        setToken('');
        setUser(null);
        setMessage('로그아웃되었습니다.');
    }

    async function handlePostSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        const body = JSON.stringify({
            title: postTitle,
            content: postContent,
            department: postDepartment,
            tags: splitTags(postTags),
        });

        try {
            if (editingPostId) {
                await request(`/posts/${editingPostId}`, {
                    method: 'PATCH',
                    body,
                });
                setMessage('게시글이 수정되었습니다.');
            } else {
                await request('/posts', {
                    method: 'POST',
                    body,
                });
                setMessage('게시글이 작성되었습니다.');
            }

            resetPostForm();
            await loadPosts();
        } catch (error) {
            showError(error);
        }
    }

    async function handleQuestionSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        try {
            const body = JSON.stringify({
                title: questionTitle,
                content: questionContent,
                department: questionDepartment,
                tags: splitTags(questionTags),
            });

            if (editingPostId) {
                await request(`/posts/${editingPostId}`, {
                    method: 'PATCH',
                    body,
                });
                setMessage('질문 노트가 수정되었습니다.');
            } else {
                await request('/posts/questions', {
                    method: 'POST',
                    body,
                });
                setMessage('질문이 저장되고 AI 답변 댓글이 추가되었습니다.');
            }

            setEditingPostId(null);
            setQuestionTitle('');
            setQuestionContent('');
            setQuestionDepartment('인사');
            setQuestionTags('');
            await loadPosts();
        } catch (error) {
            showError(error);
        }
    }

    function handleQuestionEditClick(post: BoardPost) {
        setEditingPostId(post.id);
        setQuestionTitle(post.title);
        setQuestionContent(post.content);
        setQuestionDepartment(post.department);
        setQuestionTags((post.tags || []).join(', '));
    }

    function resetQuestionForm() {
        setEditingPostId(null);
        setQuestionTitle('');
        setQuestionContent('');
        setQuestionDepartment('인사');
        setQuestionTags('');
    }

    function handleEditClick(post: BoardPost) {
        setEditingPostId(post.id);
        setPostTitle(post.title);
        setPostContent(post.content);
        setPostDepartment(post.department);
        setPostTags((post.tags || []).join(', '));
    }

    async function handleDeleteClick(postId: number) {
        try {
            await request(`/posts/${postId}`, {
                method: 'DELETE',
            });

            setMessage('게시글이 삭제되었습니다.');
            await loadPosts();
        } catch (error) {
            showError(error);
        }
    }

    async function handleCommentSubmit(event: FormEvent<HTMLFormElement>, postId: number) {
        event.preventDefault();

        try {
            await request(`/posts/${postId}/comments`, {
                method: 'POST',
                body: JSON.stringify({
                    content: commentText[postId] || '',
                }),
            });

            setCommentText({
                ...commentText,
                [postId]: '',
            });
            await loadPosts();
        } catch (error) {
            showError(error);
        }
    }

    async function handleCommentDelete(postId: number, commentId: number) {
        try {
            await request(`/posts/${postId}/comments/${commentId}`, {
                method: 'DELETE',
            });

            await loadPosts();
        } catch (error) {
            showError(error);
        }
    }

    async function handleAppendAiAnswer(post: BoardPost, answer: string) {
        try {
            await request(`/posts/${post.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    content: `${post.content}\n\n[AI 정리]\n${answer}`,
                }),
            });

            setMessage('AI 답변을 본문 노트에 추가했습니다.');
            await loadPosts();
        } catch (error) {
            showError(error);
        }
    }

    function resetPostForm() {
        setEditingPostId(null);
        setPostTitle('');
        setPostContent('');
        setPostDepartment('공통');
        setPostTags('');
    }

    function splitTags(value: string): string[] {
        return value
            .split(',')
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
    }

    function showError(error: unknown) {
        if (error instanceof Error) {
            setMessage(error.message);
            return;
        }

        setMessage('오류가 발생했습니다.');
    }

    function handleKeywordChange(event: ChangeEvent<HTMLInputElement>) {
        setPage(1);
        setKeyword(event.target.value);
    }

    function handleDepartmentFilterChange(event: ChangeEvent<HTMLInputElement>) {
        setPage(1);
        setDepartmentFilter(event.target.value);
    }

    function handleTagFilterChange(event: ChangeEvent<HTMLInputElement>) {
        setPage(1);
        setTagFilter(event.target.value);
    }

    function canEdit(post: BoardPost) {
        return user && post.author && user.id === post.author.id;
    }

    function formatDate(value: string) {
        return new Date(value).toLocaleString();
    }

    return (
        <>
            <Header
                title="DH Company Wiki"
                menu={menu}
                user={user}
                onMenuClick={setMenu}
                onLogout={handleLogout}
            />

            <main>
                {message && <p className="message">{message}</p>}

                {menu === 'signup' && (
                    <section className="panel">
                        <h2>회원가입</h2>
                        <form onSubmit={handleSignupSubmit}>
                            <label htmlFor="signup-email">이메일</label>
                            <input id="signup-email" type="email" value={signupEmail} onChange={(event) => setSignupEmail(event.target.value)} />

                            <label htmlFor="signup-password">비밀번호</label>
                            <input id="signup-password" type="password" value={signupPassword} onChange={(event) => setSignupPassword(event.target.value)} />

                            <label htmlFor="signup-nickname">닉네임</label>
                            <input id="signup-nickname" type="text" value={signupNickname} onChange={(event) => setSignupNickname(event.target.value)} />

                            <button type="submit">가입하기</button>
                        </form>
                    </section>
                )}

                {menu === 'login' && (
                    <section className="panel">
                        <h2>로그인</h2>
                        <form onSubmit={handleLoginSubmit}>
                            <label htmlFor="login-email">이메일</label>
                            <input id="login-email" type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} />

                            <label htmlFor="login-password">비밀번호</label>
                            <input id="login-password" type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} />

                            <button type="submit">로그인</button>
                        </form>
                    </section>
                )}

                {menu === 'posts' && (
                    <section className="grid">
                        <section className="panel">
                            <h2>{editingPostId ? '게시글 수정' : '회사 위키 작성'}</h2>
                            {!user && <p>로그인하면 게시글과 댓글을 작성할 수 있습니다.</p>}

                            {user && (
                                <form onSubmit={handlePostSubmit}>
                                    <label htmlFor="post-title">제목</label>
                                    <input id="post-title" type="text" value={postTitle} onChange={(event) => setPostTitle(event.target.value)} />

                                    <label htmlFor="post-department">부서</label>
                                    <input id="post-department" type="text" value={postDepartment} onChange={(event) => setPostDepartment(event.target.value)} />

                                    <label htmlFor="post-tags">태그</label>
                                    <input id="post-tags" type="text" placeholder="급여, 온보딩, 개발" value={postTags} onChange={(event) => setPostTags(event.target.value)} />

                                    <label htmlFor="post-content">내용</label>
                                    <textarea id="post-content" value={postContent} onChange={(event) => setPostContent(event.target.value)} />

                                    <div className="button-row">
                                        <button type="submit">{editingPostId ? '수정하기' : '작성하기'}</button>
                                        {editingPostId && <button type="button" className="secondary" onClick={resetPostForm}>취소</button>}
                                    </div>
                                </form>
                            )}
                        </section>

                        <section className="panel">
                            <h2>게시글 검색</h2>
                            <div className="filters">
                                <input type="text" placeholder="제목/내용 검색" value={keyword} onChange={handleKeywordChange} />
                                <input type="text" placeholder="부서" value={departmentFilter} onChange={handleDepartmentFilterChange} />
                                <input type="text" placeholder="태그" value={tagFilter} onChange={handleTagFilterChange} />
                            </div>
                        </section>

                        <section className="post-list">
                            {posts.map((post) => (
                                <article className="post-card" key={post.id}>
                                    <div className="post-head">
                                        <div>
                                            <h3>{post.title}</h3>
                                            <p>{post.department} · {post.author?.nickname} · {formatDate(post.createdAt)}</p>
                                        </div>

                                        {canEdit(post) && (
                                            <div className="button-row">
                                                <button type="button" className="secondary" onClick={() => handleEditClick(post)}>수정</button>
                                                <button type="button" className="danger" onClick={() => handleDeleteClick(post.id)}>삭제</button>
                                            </div>
                                        )}
                                    </div>

                                    <p className="post-content">{post.content}</p>

                                    <div className="tags">
                                        {(post.tags || []).map((tag) => (
                                            <span key={tag}>{tag}</span>
                                        ))}
                                    </div>

                                    <div className="comments">
                                        <h4>댓글</h4>
                                        {(post.comments || []).map((comment) => (
                                            <div className="comment" key={comment.id}>
                                                <p>{comment.content}</p>
                                                <small>{comment.isAi ? 'AI 답변' : comment.author?.nickname} · {formatDate(comment.createdAt)}</small>
                                                {user?.id === comment.author?.id && (
                                                    <button type="button" className="text-button" onClick={() => handleCommentDelete(post.id, comment.id)}>
                                                        삭제
                                                    </button>
                                                )}
                                            </div>
                                        ))}

                                        {user && (
                                            <form className="comment-form" onSubmit={(event) => handleCommentSubmit(event, post.id)}>
                                                <input
                                                    type="text"
                                                    placeholder="댓글 입력"
                                                    value={commentText[post.id] || ''}
                                                    onChange={(event) => setCommentText({ ...commentText, [post.id]: event.target.value })}
                                                />
                                                <button type="submit">등록</button>
                                            </form>
                                        )}
                                    </div>
                                </article>
                            ))}

                            <div className="pagination">
                                <button type="button" className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button>
                                <span>{page} / {totalPages}</span>
                                <button type="button" className="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>다음</button>
                            </div>
                        </section>
                    </section>
                )}

                {menu === 'questions' && (
                    <section className="grid">
                        <section className="panel">
                            <h2>{editingPostId ? '내 질문 노트 수정' : '내 질문 노트 작성'}</h2>
                            {!user && <p>로그인하면 질문을 저장하고 AI 답변을 받을 수 있습니다.</p>}

                            {user && (
                                <form onSubmit={handleQuestionSubmit}>
                                    <label htmlFor="question-title">질문 제목</label>
                                    <input id="question-title" type="text" value={questionTitle} onChange={(event) => setQuestionTitle(event.target.value)} />

                                    <label htmlFor="question-department">관련 부서</label>
                                    <input id="question-department" type="text" value={questionDepartment} onChange={(event) => setQuestionDepartment(event.target.value)} />

                                    <label htmlFor="question-tags">태그</label>
                                    <input id="question-tags" type="text" placeholder="급여, 온보딩, 휴가" value={questionTags} onChange={(event) => setQuestionTags(event.target.value)} />

                                    <label htmlFor="question-content">궁금한 내용</label>
                                    <textarea id="question-content" value={questionContent} onChange={(event) => setQuestionContent(event.target.value)} />

                                    <div className="button-row">
                                        <button type="submit">{editingPostId ? '수정하기' : '질문 저장하고 AI 답변 받기'}</button>
                                        {editingPostId && <button type="button" className="secondary" onClick={resetQuestionForm}>취소</button>}
                                    </div>
                                </form>
                            )}
                        </section>

                        <section className="panel">
                            <h2>질문 검색</h2>
                            <div className="filters">
                                <input type="text" placeholder="제목/내용 검색" value={keyword} onChange={handleKeywordChange} />
                                <input type="text" placeholder="부서" value={departmentFilter} onChange={handleDepartmentFilterChange} />
                                <input type="text" placeholder="태그" value={tagFilter} onChange={handleTagFilterChange} />
                            </div>
                        </section>

                        <section className="post-list">
                            {posts.map((post) => (
                                <article className="post-card" key={post.id}>
                                    <div className="post-head">
                                        <div>
                                            <h3>{post.title}</h3>
                                            <p>{post.department} · {formatDate(post.createdAt)}</p>
                                        </div>

                                        {canEdit(post) && (
                                            <div className="button-row">
                                                <button type="button" className="secondary" onClick={() => handleQuestionEditClick(post)}>본문 수정</button>
                                                <button type="button" className="danger" onClick={() => handleDeleteClick(post.id)}>삭제</button>
                                            </div>
                                        )}
                                    </div>

                                    <p className="post-content">{post.content}</p>

                                    <div className="tags">
                                        {(post.tags || []).map((tag) => (
                                            <span key={tag}>{tag}</span>
                                        ))}
                                    </div>

                                    <div className="comments">
                                        <h4>AI 답변과 메모</h4>
                                        {(post.comments || []).map((comment) => (
                                            <div className={comment.isAi ? 'comment ai-comment' : 'comment'} key={comment.id}>
                                                <p>{comment.content}</p>
                                                <small>{comment.isAi ? 'AI 답변' : comment.author?.nickname} · {formatDate(comment.createdAt)}</small>
                                                {comment.isAi && (
                                                    <button type="button" className="text-button" onClick={() => handleAppendAiAnswer(post, comment.content)}>
                                                        본문에 추가
                                                    </button>
                                                )}
                                                {user?.id === comment.author?.id && (
                                                    <button type="button" className="text-button" onClick={() => handleCommentDelete(post.id, comment.id)}>
                                                        삭제
                                                    </button>
                                                )}
                                            </div>
                                        ))}

                                        {user && (
                                            <form className="comment-form" onSubmit={(event) => handleCommentSubmit(event, post.id)}>
                                                <input
                                                    type="text"
                                                    placeholder="내 메모 추가"
                                                    value={commentText[post.id] || ''}
                                                    onChange={(event) => setCommentText({ ...commentText, [post.id]: event.target.value })}
                                                />
                                                <button type="submit">등록</button>
                                            </form>
                                        )}
                                    </div>
                                </article>
                            ))}

                            <div className="pagination">
                                <button type="button" className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button>
                                <span>{page} / {totalPages}</span>
                                <button type="button" className="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>다음</button>
                            </div>
                        </section>
                    </section>
                )}
            </main>
        </>
    );
}

export default App;
