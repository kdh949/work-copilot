import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Header, type MenuName } from "./components/Header";

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const CHAT_SUGGESTIONS = ['입사 첫날 해야 할 일', '급여일과 휴가 규정', '우리 부서 온보딩', '필요한 계정 신청'];
const SIGNUP_DEPARTMENTS = ['제품', '엔지니어링', '고객성공', '인사', '총무', '재무'];
const WIKI_PAGE_SIZE = 12;

type User = {
    id: number;
    email: string;
    nickname: string;
    department?: string | null;
    employeeNumber?: string | null;
    role: string;
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
    sourceId?: string | null;
    wikiPath?: string[] | null;
    parentSourceId?: string | null;
    depth?: number;
    docType?: string | null;
    summary?: string | null;
    tags: string[];
    author: User;
    comments?: Comment[];
    createdAt: string;
};

type PostListResponse = {
    items: BoardPost[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
};

type AiResponse = {
    answer: string;
    searchMode?: string;
    department?: string | null;
    sources?: {
        sourceId: string;
        title: string;
        department: string;
        postId?: number | null;
    }[];
};

type WikiTreeNode = {
    path: string[];
    name: string;
    depth: number;
    documentCount: number;
};

type WikiTreeBranch = WikiTreeNode & {
    children: WikiTreeBranch[];
};

function App() {
    const [menu, setMenu] = useState<MenuName>('login');
    const [token, setToken] = useState(localStorage.getItem('accessToken') || '');
    const [user, setUser] = useState<User | null>(null);
    const [message, setMessage] = useState('');

    const [signupEmployeeNumber, setSignupEmployeeNumber] = useState('');
    const [signupEmail, setSignupEmail] = useState('');
    const [signupPassword, setSignupPassword] = useState('');
    const [signupNickname, setSignupNickname] = useState('');
    const [signupDepartment, setSignupDepartment] = useState(SIGNUP_DEPARTMENTS[0]);

    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');

    const [wikiPosts, setWikiPosts] = useState<BoardPost[]>([]);
    const [wikiTreeNodes, setWikiTreeNodes] = useState<WikiTreeNode[]>([]);
    const [selectedWikiPath, setSelectedWikiPath] = useState<string[]>([]);
    const [selectedWikiDetail, setSelectedWikiDetail] = useState<BoardPost | null>(null);
    const [wikiPage, setWikiPage] = useState(1);
    const [wikiTotal, setWikiTotal] = useState(0);
    const [wikiTotalPages, setWikiTotalPages] = useState(1);
    const [notes, setNotes] = useState<BoardPost[]>([]);
    const [selectedWikiId, setSelectedWikiId] = useState<number | null>(null);
    const [selectedNoteViewId, setSelectedNoteViewId] = useState<number | null>(null);
    const [openedWikiPaths, setOpenedWikiPaths] = useState<string[]>([]);
    const [openedNoteDepartments, setOpenedNoteDepartments] = useState<string[]>([]);

    const [keyword, setKeyword] = useState('');
    const [departmentFilter, setDepartmentFilter] = useState('');
    const [tagFilter, setTagFilter] = useState('');

    const [editingPostId, setEditingPostId] = useState<number | null>(null);
    const [postTitle, setPostTitle] = useState('');
    const [postContent, setPostContent] = useState('');
    const [postDepartment, setPostDepartment] = useState('공통');
    const [postTags, setPostTags] = useState('');

    const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
    const [noteTitle, setNoteTitle] = useState('');
    const [noteContent, setNoteContent] = useState('');
    const [noteDepartment, setNoteDepartment] = useState('공통');
    const [noteTags, setNoteTags] = useState('');

    const [commentText, setCommentText] = useState<Record<number, string>>({});

    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isChatLoading, setIsChatLoading] = useState(false);
    const [isChatSignalVisible, setIsChatSignalVisible] = useState(true);
    const [chatQuestion, setChatQuestion] = useState('');
    const [chatSubmittedQuestion, setChatSubmittedQuestion] = useState('');
    const [chatAnswer, setChatAnswer] = useState('');
    const [chatSources, setChatSources] = useState<AiResponse['sources']>([]);
    const [chatNoteTitle, setChatNoteTitle] = useState('');
    const [selectedNoteId, setSelectedNoteId] = useState('');
    const [chatError, setChatError] = useState('');

    useEffect(() => {
        if (menu === 'posts') {
            loadWikiTree();
        }
    }, [menu]);

    useEffect(() => {
        if (menu === 'posts') {
            loadWikiPosts();
        }
    }, [menu, keyword, tagFilter, selectedWikiPath, wikiPage]);

    useEffect(() => {
        if (menu === 'notes' || isChatOpen) {
            loadNotes();
        }
    }, [menu, token, keyword, departmentFilter, tagFilter, isChatOpen]);

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

            if (menu === 'login') {
                setMenu('posts');
            }
        } catch {
            handleLogout();
        }
    }

    async function loadWikiTree() {
        try {
            const nodes = await request<WikiTreeNode[]>('/posts/wiki/tree');
            setWikiTreeNodes(nodes);

            if (nodes.length > 0 && selectedWikiPath.length === 0) {
                const firstPath = nodes[0].path;
                setSelectedWikiPath(firstPath);
                setOpenedWikiPaths(getAncestorPathKeys(firstPath));
            }
        } catch (error) {
            showError(error);
        }
    }

    async function loadWikiPosts() {
        try {
            const params = makeWikiSearchParams();
            const data = await request<PostListResponse>(`/posts/wiki?${params.toString()}`);
            setWikiPosts(data.items);
            setWikiTotal(data.total);
            setWikiTotalPages(data.totalPages || 1);

            if (data.items.length > 0) {
                setSelectedWikiId((currentId) => {
                    if (currentId && data.items.some((item) => item.id === currentId)) {
                        return currentId;
                    }

                    return null;
                });
            } else {
                setSelectedWikiId(null);
            }

        } catch (error) {
            showError(error);
        }
    }

    async function loadWikiDetail(postId: number, options: { syncPath?: boolean } = {}) {
        try {
            const post = await request<BoardPost>(`/posts/${postId}`);
            setSelectedWikiId(post.id);
            setSelectedWikiDetail(post);

            if (options.syncPath && post.wikiPath && post.wikiPath.length > 0) {
                setSelectedWikiPath(post.wikiPath);
                setWikiPage(1);
                setOpenedWikiPaths((paths) => {
                    const nextPaths = [...paths];

                    for (const pathKey of getAncestorPathKeys(post.wikiPath || [])) {
                        if (!nextPaths.includes(pathKey)) {
                            nextPaths.push(pathKey);
                        }
                    }

                    return nextPaths;
                });
            }
        } catch (error) {
            showError(error);
        }
    }

    async function loadNotes() {
        if (!token) {
            setNotes([]);
            return;
        }

        try {
            const params = makeSearchParams();
            const data = await request<PostListResponse>(`/posts/notes/my?${params.toString()}`);
            setNotes(data.items);

            if (data.items.length > 0) {
                const firstPost = data.items[0];
                const firstDepartment = getPostDepartment(firstPost);

                setSelectedNoteViewId((currentId) => {
                    if (currentId && data.items.some((item) => item.id === currentId)) {
                        return currentId;
                    }

                    return firstPost.id;
                });

                setOpenedNoteDepartments((departments) => {
                    if (departments.includes(firstDepartment)) {
                        return departments;
                    }

                    return [...departments, firstDepartment];
                });

                if (!selectedNoteId) {
                    setSelectedNoteId(String(firstPost.id));
                }
            } else {
                setSelectedNoteViewId(null);
                setSelectedNoteId('');
            }
        } catch (error) {
            showError(error);
        }
    }

    function makeSearchParams() {
        const params = new URLSearchParams();

        params.set('page', '1');
        params.set('limit', '100');

        if (keyword) {
            params.set('keyword', keyword);
        }
        if (departmentFilter) {
            params.set('department', departmentFilter);
        }
        if (tagFilter) {
            params.set('tag', tagFilter);
        }

        return params;
    }

    function makeWikiSearchParams() {
        const params = new URLSearchParams();

        params.set('page', String(wikiPage));
        params.set('limit', String(WIKI_PAGE_SIZE));

        for (const segment of selectedWikiPath) {
            params.append('path', segment);
        }

        if (keyword) {
            params.set('keyword', keyword);
        }
        if (tagFilter) {
            params.set('tag', tagFilter);
        }

        return params;
    }

    async function handleSignupSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        try {
            const newUser = await request<User>('/auth/signup', {
                method: 'POST',
                body: JSON.stringify({
                    employeeNumber: signupEmployeeNumber,
                    email: signupEmail,
                    password: signupPassword,
                    nickname: signupNickname,
                    department: signupDepartment,
                }),
            });

            setMessage(`회원가입이 완료되었습니다. 역할: ${newUser.role}`);
            setSignupEmployeeNumber('');
            setSignupEmail('');
            setSignupPassword('');
            setSignupNickname('');
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
        setNotes([]);
        setIsChatOpen(false);
        setMenu('login');
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
                setMessage('회사 위키 문서가 수정되었습니다.');
            } else {
                await request('/posts', {
                    method: 'POST',
                    body,
                });
                setMessage('회사 위키 문서가 작성되었습니다.');
            }

            resetPostForm();
            await loadWikiPosts();
        } catch (error) {
            showError(error);
        }
    }

    async function handleNoteSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        const body = JSON.stringify({
            title: noteTitle,
            content: noteContent,
            department: noteDepartment,
            tags: splitTags(noteTags),
        });

        try {
            if (editingNoteId) {
                const updatedNote = await request<BoardPost>(`/posts/${editingNoteId}`, {
                    method: 'PATCH',
                    body,
                });
                setSelectedNoteViewId(updatedNote.id);
                setMessage('내 노트가 수정되었습니다.');
            } else {
                const newNote = await request<BoardPost>('/posts/notes', {
                    method: 'POST',
                    body,
                });
                setSelectedNoteViewId(newNote.id);
                setSelectedNoteId(String(newNote.id));
                setMessage('내 노트가 작성되었습니다.');
            }

            resetNoteForm();
            await loadNotes();
        } catch (error) {
            showError(error);
        }
    }

    async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const question = chatQuestion.trim();

        if (!question) {
            setChatError('질문을 입력해주세요.');
            return;
        }

        try {
            setIsChatLoading(true);
            setChatError('');
            setChatSubmittedQuestion(question);
            setChatAnswer('');
            setChatSources([]);

            const data = await request<AiResponse>('/ai/chat', {
                method: 'POST',
                body: JSON.stringify({
                    question,
                }),
            });

            setChatAnswer(data.answer);
            setChatSources(data.sources || []);

            if (!chatNoteTitle) {
                setChatNoteTitle(question.slice(0, 30) || 'AI 정리 노트');
            }
        } catch (error) {
            if (error instanceof Error) {
                setChatError(error.message);
            } else {
                setChatError('오류가 발생했습니다.');
            }
            showError(error);
        } finally {
            setIsChatLoading(false);
        }
    }

    async function handleSaveChatAsNewNote() {
        if (!chatAnswer) {
            setMessage('저장할 AI 답변이 없습니다.');
            return;
        }

        try {
            const newNote = await request<BoardPost>('/posts/notes', {
                method: 'POST',
                body: JSON.stringify({
                    title: chatNoteTitle || 'AI 정리 노트',
                    content: makeAiNoteContent(''),
                    department: user?.department || '공통',
                    tags: ['AI', '챗봇'],
                }),
            });

            setSelectedNoteViewId(newNote.id);
            setSelectedNoteId(String(newNote.id));
            setMessage('AI 답변을 새 노트로 저장했습니다.');
            await loadNotes();
        } catch (error) {
            showError(error);
        }
    }

    async function handleAppendChatToNote() {
        if (!chatAnswer) {
            setMessage('추가할 AI 답변이 없습니다.');
            return;
        }

        const note = notes.find((item) => item.id === Number(selectedNoteId));

        if (!note) {
            setMessage('추가할 노트를 선택해주세요.');
            return;
        }

        try {
            await request(`/posts/${note.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    content: makeAiNoteContent(note.content),
                }),
            });

            setSelectedNoteViewId(note.id);
            setMessage('AI 답변을 선택한 노트에 추가했습니다.');
            await loadNotes();
        } catch (error) {
            showError(error);
        }
    }

    function makeAiNoteContent(oldContent: string) {
        const nextContent = `[질문]\n${chatSubmittedQuestion || chatQuestion}\n\n[AI 정리]\n${chatAnswer}`;

        if (!oldContent) {
            return nextContent;
        }

        return `${oldContent}\n\n${nextContent}`;
    }

    function handleEditClick(post: BoardPost) {
        setEditingPostId(post.id);
        setPostTitle(post.title);
        setPostContent(post.content);
        setPostDepartment(post.department);
        setPostTags((post.tags || []).join(', '));
    }

    function handleNoteEditClick(post: BoardPost) {
        setSelectedNoteViewId(post.id);
        setEditingNoteId(post.id);
        setNoteTitle(post.title);
        setNoteContent(post.content);
        setNoteDepartment(post.department);
        setNoteTags((post.tags || []).join(', '));
    }

    async function handleDeleteClick(postId: number) {
        try {
            await request(`/posts/${postId}`, {
                method: 'DELETE',
            });

            setMessage('삭제되었습니다.');
            await loadWikiPosts();
            setSelectedWikiDetail(null);
            await loadNotes();
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
            await loadWikiDetail(postId);
        } catch (error) {
            showError(error);
        }
    }

    async function handleCommentDelete(postId: number, commentId: number) {
        try {
            await request(`/posts/${postId}/comments/${commentId}`, {
                method: 'DELETE',
            });

            await loadWikiDetail(postId);
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

    function resetNoteForm() {
        setEditingNoteId(null);
        setNoteTitle('');
        setNoteContent('');
        setNoteDepartment('공통');
        setNoteTags('');
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
        setKeyword(event.target.value);
        setWikiPage(1);
        setSelectedWikiId(null);
        setSelectedWikiDetail(null);
    }

    function handleDepartmentFilterChange(event: ChangeEvent<HTMLInputElement>) {
        setDepartmentFilter(event.target.value);
    }

    function handleTagFilterChange(event: ChangeEvent<HTMLInputElement>) {
        setTagFilter(event.target.value);
        setWikiPage(1);
        setSelectedWikiId(null);
        setSelectedWikiDetail(null);
    }

    function canManageWiki() {
        return user?.role === 'admin';
    }

    function canEdit(post: BoardPost) {
        if (post.boardType === 'wiki') {
            return canManageWiki();
        }

        return user && post.author && user.id === post.author.id;
    }

    function formatDate(value: string) {
        return new Date(value).toLocaleString();
    }

    function toggleWikiPath(path: string[]) {
        const pathKey = getPathKey(path);

        if (openedWikiPaths.includes(pathKey)) {
            setOpenedWikiPaths(openedWikiPaths.filter((item) => item !== pathKey));
            return;
        }

        setOpenedWikiPaths([...openedWikiPaths, pathKey]);
    }

    function selectWikiPath(path: string[]) {
        setSelectedWikiPath(path);
        setWikiPage(1);
        setSelectedWikiId(null);
        setSelectedWikiDetail(null);
        setOpenedWikiPaths((paths) => {
            const nextPaths = [...paths];

            for (const pathKey of getAncestorPathKeys(path)) {
                if (!nextPaths.includes(pathKey)) {
                    nextPaths.push(pathKey);
                }
            }

            return nextPaths;
        });
    }

    function toggleNoteDepartment(department: string) {
        if (openedNoteDepartments.includes(department)) {
            setOpenedNoteDepartments(openedNoteDepartments.filter((item) => item !== department));
            return;
        }

        setOpenedNoteDepartments([...openedNoteDepartments, department]);
    }

    function getDepartments(posts: BoardPost[]) {
        const departments: string[] = [];

        for (const post of posts) {
            const department = getPostDepartment(post);

            if (!departments.includes(department)) {
                departments.push(department);
            }
        }

        return departments;
    }

    function getPostDepartment(post: BoardPost) {
        return post.department || '개인';
    }

    function selectedWikiPost() {
        return selectedWikiDetail || wikiPosts.find((post) => post.id === selectedWikiId) || null;
    }

    function selectedNotePost() {
        return notes.find((post) => post.id === selectedNoteViewId) || notes[0];
    }

    function getPathKey(path: string[]) {
        return path.join(' / ');
    }

    function getAncestorPathKeys(path: string[]) {
        const keys: string[] = [];

        for (let index = 0; index < path.length; index += 1) {
            keys.push(getPathKey(path.slice(0, index + 1)));
        }

        return keys;
    }

    function buildWikiTree(nodes: WikiTreeNode[]): WikiTreeBranch[] {
        const branchMap = new Map<string, WikiTreeBranch>();
        const roots: WikiTreeBranch[] = [];

        for (const node of nodes) {
            branchMap.set(getPathKey(node.path), {
                ...node,
                children: [],
            });
        }

        for (const node of nodes) {
            const branch = branchMap.get(getPathKey(node.path));

            if (!branch) {
                continue;
            }

            if (node.path.length === 1) {
                roots.push(branch);
                continue;
            }

            const parent = branchMap.get(getPathKey(node.path.slice(0, -1)));
            parent?.children.push(branch);
        }

        return roots;
    }

    function renderWikiTree(branches: WikiTreeBranch[]) {
        return branches.map((branch) => {
            const pathKey = getPathKey(branch.path);
            const isOpen = openedWikiPaths.includes(pathKey);
            const isSelected = getPathKey(selectedWikiPath) === pathKey;
            const hasChildren = branch.children.length > 0;

            return (
                <div className="tree-group" key={pathKey}>
                    <div className="tree-category-row" style={{ paddingLeft: `${branch.depth * 14}px` }}>
                        <button type="button" className="tree-toggle" onClick={() => toggleWikiPath(branch.path)}>
                            {hasChildren ? (isOpen ? '▾' : '▸') : '•'}
                        </button>
                        <button
                            type="button"
                            className={isSelected ? 'tree-category active' : 'tree-category'}
                            onClick={() => selectWikiPath(branch.path)}
                        >
                            <span>{branch.name}</span>
                            <small>{branch.documentCount}</small>
                        </button>
                    </div>

                    {hasChildren && isOpen && renderWikiTree(branch.children)}
                </div>
            );
        });
    }

    function handleTagClick(tag: string) {
        setTagFilter(tag);
        setWikiPage(1);
        setSelectedWikiId(null);
        setSelectedWikiDetail(null);
    }

    function makeExcerpt(post: BoardPost) {
        const source = post.summary || post.content || '';
        const text = source.replace(/[#*_>`\-\[\]]/g, '').replace(/\s+/g, ' ').trim();

        return text.length > 180 ? `${text.slice(0, 180)}...` : text;
    }

    function getDepartmentSuggestions(posts: BoardPost[]) {
        const value = departmentFilter.trim().toLowerCase();

        if (!value) {
            return [];
        }

        return getDepartments(posts)
            .filter((department) => department.toLowerCase().includes(value))
            .filter((department) => department !== departmentFilter)
            .slice(0, 5);
    }

    function getTagSuggestions(posts: BoardPost[]) {
        const value = tagFilter.trim().toLowerCase();
        const tags: string[] = [];

        if (!value) {
            return [];
        }

        for (const post of posts) {
            for (const tag of post.tags || []) {
                if (!tags.includes(tag)) {
                    tags.push(tag);
                }
            }
        }

        return tags
            .filter((tag) => tag.toLowerCase().includes(value))
            .filter((tag) => tag !== tagFilter)
            .slice(0, 5);
    }

    function openChatModal() {
        setIsChatOpen(true);
        setIsChatSignalVisible(false);

        if (token) {
            loadNotes();
        }
    }

    function toggleChatWidget() {
        if (isChatOpen) {
            setIsChatOpen(false);
            return;
        }

        openChatModal();
    }

    function closeChatModal() {
        setIsChatOpen(false);
    }

    function handleChatSuggestionClick(question: string) {
        setChatQuestion(question);
        setChatError('');
    }

    async function handleChatSourceClick(source: NonNullable<AiResponse['sources']>[number]) {
        if (!source.postId) {
            return;
        }

        setMenu('posts');
        setIsChatOpen(false);
        setIsChatSignalVisible(false);
        await loadWikiDetail(source.postId, { syncPath: true });
    }

    function renderSearchFilters(posts: BoardPost[]) {
        const departmentSuggestions = getDepartmentSuggestions(posts);
        const tagSuggestions = getTagSuggestions(posts);

        return (
            <div className="filters">
                <input type="text" placeholder="제목/내용 검색" value={keyword} onChange={handleKeywordChange} />

                <div className="suggestion-field">
                    <input type="text" placeholder="부서" value={departmentFilter}
                           onChange={handleDepartmentFilterChange} />
                    {departmentSuggestions.length > 0 && (
                        <div className="suggestion-list">
                            {departmentSuggestions.map((department) => (
                                <button type="button" key={department} onClick={() => setDepartmentFilter(department)}>
                                    {department}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="suggestion-field">
                    <input type="text" placeholder="태그" value={tagFilter} onChange={handleTagFilterChange} />
                    {tagSuggestions.length > 0 && (
                        <div className="suggestion-list">
                            {tagSuggestions.map((tag) => (
                                <button type="button" key={tag} onClick={() => setTagFilter(tag)}>
                                    {tag}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    function renderWikiFilters() {
        const tagSuggestions = getTagSuggestions(wikiPosts);

        return (
            <div className="filters">
                <input type="text" placeholder="제목/내용 검색" value={keyword} onChange={handleKeywordChange} />

                <div className="suggestion-field">
                    <input type="text" placeholder="태그" value={tagFilter} onChange={handleTagFilterChange} />
                    {tagSuggestions.length > 0 && (
                        <div className="suggestion-list">
                            {tagSuggestions.map((tag) => (
                                <button type="button" key={tag} onClick={() => handleTagClick(tag)}>
                                    {tag}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    function renderMarkdown(content: string, className: string) {
        return (
            <div className={className}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {content}
                </ReactMarkdown>
            </div>
        );
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

                {menu === 'login' && (
                    <section className="auth-layout">
                        <section className="panel auth-card">
                            <h2>로그인</h2>
                            <p className="auth-subtitle">회사 내부 위키는 직원 로그인 후 사용할 수 있습니다.</p>
                            <form onSubmit={handleLoginSubmit}>
                                <label htmlFor="login-email">이메일</label>
                                <input id="login-email" type="email" value={loginEmail}
                                       onChange={(event) => setLoginEmail(event.target.value)} />

                                <label htmlFor="login-password">비밀번호</label>
                                <input id="login-password" type="password" value={loginPassword}
                                       onChange={(event) => setLoginPassword(event.target.value)} />

                                <button type="submit">로그인</button>
                            </form>
                        </section>

                        <section className="panel signup-small">
                            <h2>회원가입</h2>
                            <form onSubmit={handleSignupSubmit}>
                                <label htmlFor="signup-employee-number">사번</label>
                                <input id="signup-employee-number" type="text" value={signupEmployeeNumber}
                                       onChange={(event) => setSignupEmployeeNumber(event.target.value)} />

                                <label htmlFor="signup-email">이메일</label>
                                <input id="signup-email" type="email" value={signupEmail}
                                       onChange={(event) => setSignupEmail(event.target.value)} />

                                <label htmlFor="signup-password">비밀번호</label>
                                <input id="signup-password" type="password" value={signupPassword}
                                       onChange={(event) => setSignupPassword(event.target.value)} />

                                <label htmlFor="signup-nickname">닉네임</label>
                                <input id="signup-nickname" type="text" value={signupNickname}
                                       onChange={(event) => setSignupNickname(event.target.value)} />

                                <label htmlFor="signup-department">부서</label>
                                <select id="signup-department" value={signupDepartment}
                                        onChange={(event) => setSignupDepartment(event.target.value)}>
                                    {SIGNUP_DEPARTMENTS.map((department) => (
                                        <option key={department} value={department}>{department}</option>
                                    ))}
                                </select>

                                <button type="submit" className="secondary">가입하기</button>
                            </form>
                        </section>
                    </section>
                )}

                {menu === 'posts' && (
                    <section className="wiki-layout">
                        <aside className="wiki-sidebar">
                            <h2>분류</h2>
                            {renderWikiFilters()}

                            <div className="tree">
                                {renderWikiTree(buildWikiTree(wikiTreeNodes))}
                            </div>
                        </aside>

                        <section className="wiki-main">
                            {canManageWiki() && (
                                <section className="panel">
                                    <h2>{editingPostId ? '회사 위키 수정' : '회사 위키 작성'}</h2>
                                    <form onSubmit={handlePostSubmit}>
                                        <label htmlFor="post-title">제목</label>
                                        <input id="post-title" type="text" value={postTitle}
                                               onChange={(event) => setPostTitle(event.target.value)} />

                                        <label htmlFor="post-department">부서</label>
                                        <input id="post-department" type="text" value={postDepartment}
                                               onChange={(event) => setPostDepartment(event.target.value)} />

                                        <label htmlFor="post-tags">태그</label>
                                        <input id="post-tags" type="text" placeholder="급여, 온보딩, 개발" value={postTags}
                                               onChange={(event) => setPostTags(event.target.value)} />

                                        <label htmlFor="post-content">내용</label>
                                        <textarea id="post-content" value={postContent}
                                                  onChange={(event) => setPostContent(event.target.value)} />

                                        <div className="button-row">
                                            <button type="submit">{editingPostId ? '수정하기' : '작성하기'}</button>
                                            {editingPostId && <button type="button" className="secondary"
                                                                      onClick={resetPostForm}>취소</button>}
                                        </div>
                                    </form>
                                </section>
                            )}

                            <section className="wiki-card-list">
                                <div className="wiki-card-list-head">
                                    <div>
                                        <h2>{selectedWikiPath.length > 0 ? selectedWikiPath.join(' / ') : '문서'}</h2>
                                        <p>총 {wikiTotal}개 문서 · {wikiPage}/{wikiTotalPages} 페이지</p>
                                    </div>

                                    {tagFilter && (
                                        <button type="button" className="secondary" onClick={() => {
                                            setTagFilter('');
                                            setWikiPage(1);
                                        }}>
                                            태그 필터 해제: {tagFilter}
                                        </button>
                                    )}
                                </div>

                                {wikiPosts.length > 0 ? (
                                    wikiPosts.map((post) => (
                                        <article
                                            key={post.id}
                                            className={selectedWikiId === post.id ? 'wiki-card active' : 'wiki-card'}
                                        >
                                            <button
                                                type="button"
                                                className="wiki-card-open"
                                                onClick={() => loadWikiDetail(post.id)}
                                            >
                                                <div className="wiki-card-title-row">
                                                    <h3>{post.title}</h3>
                                                    {post.docType && <span>{post.docType}</span>}
                                                </div>
                                                <p>{makeExcerpt(post)}</p>
                                                <small>{post.author?.nickname || '작성자 없음'} · {formatDate(post.createdAt)}</small>
                                            </button>

                                            <div className="wiki-card-tags">
                                                {(post.tags || []).slice(0, 5).map((tag) => (
                                                    <button type="button" key={tag} onClick={() => handleTagClick(tag)}>
                                                        {tag}
                                                    </button>
                                                ))}
                                            </div>
                                        </article>
                                    ))
                                ) : (
                                    <section className="panel">
                                        <h2>문서가 없습니다.</h2>
                                        <p>다른 분류를 선택하거나 검색 조건을 변경해주세요.</p>
                                    </section>
                                )}

                                <div className="pagination">
                                    <button type="button" className="secondary" disabled={wikiPage <= 1}
                                            onClick={() => setWikiPage((page) => Math.max(1, page - 1))}>
                                        이전
                                    </button>
                                    <span>{wikiPage} / {wikiTotalPages}</span>
                                    <button type="button" className="secondary" disabled={wikiPage >= wikiTotalPages}
                                            onClick={() => setWikiPage((page) => Math.min(wikiTotalPages, page + 1))}>
                                        다음
                                    </button>
                                </div>
                            </section>

                            {selectedWikiPost() && (
                                <article className="document">
                                    <div className="post-head">
                                        <div>
                                            <h2>{selectedWikiPost()?.title}</h2>
                                            <p>{selectedWikiPost()?.wikiPath?.join(' / ') || selectedWikiPost()?.department} · {selectedWikiPost()?.author?.nickname} · {formatDate(selectedWikiPost()?.createdAt || '')}</p>
                                        </div>

                                        {selectedWikiPost() && canEdit(selectedWikiPost()!) && (
                                            <div className="button-row">
                                                <button type="button" className="secondary"
                                                        onClick={() => handleEditClick(selectedWikiPost()!)}>수정
                                                </button>
                                                <button type="button" className="danger"
                                                        onClick={() => handleDeleteClick(selectedWikiPost()!.id)}>삭제
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {renderMarkdown(selectedWikiPost()?.content || '', 'post-content markdown-content')}

                                    <div className="tags">
                                        {(selectedWikiPost()?.tags || []).map((tag) => (
                                            <button type="button" key={tag} onClick={() => handleTagClick(tag)}>{tag}</button>
                                        ))}
                                    </div>

                                    {selectedWikiPost() && (
                                        <div className="comments">
                                            <h4>댓글</h4>
                                            {(selectedWikiPost()?.comments || []).map((comment) => (
                                                <div className="comment" key={comment.id}>
                                                    <p>{comment.content}</p>
                                                    <small>{comment.isAi ? 'AI 답변' : comment.author?.nickname} · {formatDate(comment.createdAt)}</small>
                                                    {(user?.id === comment.author?.id || canManageWiki()) && (
                                                        <button type="button" className="text-button"
                                                                onClick={() => handleCommentDelete(selectedWikiPost()!.id, comment.id)}>
                                                            삭제
                                                        </button>
                                                    )}
                                                </div>
                                            ))}

                                            {user && (
                                                <form className="comment-form"
                                                      onSubmit={(event) => handleCommentSubmit(event, selectedWikiPost()!.id)}>
                                                    <input
                                                        type="text"
                                                        placeholder="댓글 입력"
                                                        value={commentText[selectedWikiPost()!.id] || ''}
                                                        onChange={(event) => setCommentText({
                                                            ...commentText,
                                                            [selectedWikiPost()!.id]: event.target.value
                                                        })}
                                                    />
                                                    <button type="submit">등록</button>
                                                </form>
                                            )}
                                        </div>
                                    )}
                                </article>
                            )}
                        </section>
                    </section>
                )}

                {menu === 'notes' && (
                    <section className="wiki-layout">
                        <aside className="wiki-sidebar">
                            <h2>내 노트</h2>
                            {!user && <p>로그인하면 내 노트를 볼 수 있습니다.</p>}

                            {user && (
                                <>
                                    {renderSearchFilters(notes)}

                                    <div className="tree">
                                        {getDepartments(notes).map((department) => (
                                            <div className="tree-group" key={department}>
                                                <button type="button" className="tree-department"
                                                        onClick={() => toggleNoteDepartment(department)}>
                                                    {openedNoteDepartments.includes(department) ? '▾' : '▸'} {department}
                                                </button>

                                                {openedNoteDepartments.includes(department) && notes
                                                    .filter((note) => getPostDepartment(note) === department)
                                                    .map((note) => (
                                                        <button
                                                            type="button"
                                                            className={selectedNotePost()?.id === note.id ? 'tree-post active' : 'tree-post'}
                                                            key={note.id}
                                                            onClick={() => setSelectedNoteViewId(note.id)}
                                                        >
                                                            {note.title}
                                                        </button>
                                                    ))}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </aside>

                        <section className="wiki-main">
                            <section className="panel">
                                <h2>{editingNoteId ? '내 노트 수정' : '내 노트 작성'}</h2>
                                {!user && <p>로그인하면 내 노트를 작성할 수 있습니다.</p>}

                                {user && (
                                    <form onSubmit={handleNoteSubmit}>
                                        <label htmlFor="note-title">제목</label>
                                        <input id="note-title" type="text" value={noteTitle}
                                               onChange={(event) => setNoteTitle(event.target.value)} />

                                        <label htmlFor="note-department">관련 부서</label>
                                        <input id="note-department" type="text" value={noteDepartment}
                                               onChange={(event) => setNoteDepartment(event.target.value)} />

                                        <label htmlFor="note-tags">태그</label>
                                        <input id="note-tags" type="text" placeholder="급여, 온보딩, 휴가" value={noteTags}
                                               onChange={(event) => setNoteTags(event.target.value)} />

                                        <label htmlFor="note-content">내용</label>
                                        <textarea id="note-content" value={noteContent}
                                                  onChange={(event) => setNoteContent(event.target.value)} />

                                        <div className="button-row">
                                            <button type="submit">{editingNoteId ? '수정하기' : '작성하기'}</button>
                                            {editingNoteId && <button type="button" className="secondary"
                                                                      onClick={resetNoteForm}>취소</button>}
                                        </div>
                                    </form>
                                )}
                            </section>

                            {user && selectedNotePost() ? (
                                <article className="document">
                                    <div className="post-head">
                                        <div>
                                            <h2>{selectedNotePost()?.title}</h2>
                                            <p>{selectedNotePost()?.department} · {formatDate(selectedNotePost()?.createdAt || '')}</p>
                                        </div>

                                        <div className="button-row">
                                            <button type="button" className="secondary"
                                                    onClick={() => handleNoteEditClick(selectedNotePost()!)}>수정
                                            </button>
                                            <button type="button" className="danger"
                                                    onClick={() => handleDeleteClick(selectedNotePost()!.id)}>삭제
                                            </button>
                                        </div>
                                    </div>

                                    <p className="post-content">{selectedNotePost()?.content}</p>

                                    <div className="tags">
                                        {(selectedNotePost()?.tags || []).map((tag) => (
                                            <span key={tag}>{tag}</span>
                                        ))}
                                    </div>
                                </article>
                            ) : (
                                <section className="panel">
                                    <h2>아직 저장한 노트가 없습니다.</h2>
                                    <p>AI 챗봇 답변을 저장하거나 직접 노트를 작성하면 여기에 표시됩니다.</p>
                                </section>
                            )}
                        </section>
                    </section>
                )}
            </main>

            {user && (
                <div className="chat-widget-area">
                    {isChatOpen && (
                        <section className="chat-widget">
                            <div className="chat-widget-head">
                                <div>
                                    <h2>AI 챗봇</h2>
                                    <p>회사 위키 기반 답변</p>
                                </div>
                                <button type="button" className="text-button" onClick={closeChatModal}>닫기</button>
                            </div>

                            <div className="chat-greeting">
                                <div className="chat-avatar">AI</div>
                                <p>회사 위키를 기준으로 답변하고, 필요한 답변은 내 노트에 저장할 수 있어요.</p>
                            </div>

                            {user && (
                                <div className="chat-suggestions">
                                    {CHAT_SUGGESTIONS.map((question) => (
                                        <button type="button" key={question}
                                                onClick={() => handleChatSuggestionClick(question)}>
                                            {question}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className="chat-messages">
                                {!user && (
                                    <div className="chat-bubble ai-bubble">
                                        로그인하면 회사 위키를 바탕으로 질문할 수 있습니다.
                                    </div>
                                )}

                                {user && !chatSubmittedQuestion && !chatAnswer && !isChatLoading && (
                                    <div className="chat-bubble ai-bubble">
                                        궁금한 내용을 입력하거나 추천 질문을 선택해주세요.
                                    </div>
                                )}

                                {chatSubmittedQuestion && (
                                    <div className="chat-bubble user-bubble">
                                        {chatSubmittedQuestion}
                                    </div>
                                )}

                                {isChatLoading && (
                                    <div className="chat-bubble ai-bubble">
                                        답변을 찾고 있습니다.
                                    </div>
                                )}

                                {chatError && (
                                    <div className="chat-bubble error-bubble">
                                        {chatError}
                                    </div>
                                )}

                                {chatAnswer && (
                                    <div className="chat-bubble ai-bubble">
                                        {renderMarkdown(chatAnswer, 'markdown-content chat-markdown')}
                                    </div>
                                )}

                                {chatSources && chatSources.length > 0 && (
                                    <div className="chat-sources">
                                        <strong>참고 문서</strong>
                                        {chatSources.map((source) => (
                                            <button
                                                type="button"
                                                key={source.sourceId}
                                                disabled={!source.postId}
                                                onClick={() => handleChatSourceClick(source)}
                                            >
                                                <span>{source.title}</span>
                                                <small>{source.department}</small>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {user && (
                                <form className="chat-input-form" onSubmit={handleChatSubmit}>
                                    <div className="chat-input-row">
                                    <textarea
                                        id="chat-question"
                                        placeholder="메시지를 입력하세요"
                                        value={chatQuestion}
                                        onChange={(event) => setChatQuestion(event.target.value)}
                                    />
                                        <button type="submit" disabled={isChatLoading}>
                                            전송
                                        </button>
                                    </div>
                                </form>
                            )}

                            {user && chatAnswer && (
                                <div className="chat-note-save">
                                    <label htmlFor="chat-note-title">새 노트 제목</label>
                                    <input id="chat-note-title" type="text" value={chatNoteTitle}
                                           onChange={(event) => setChatNoteTitle(event.target.value)} />

                                    <div className="chat-note-actions">
                                        <button type="button" onClick={handleSaveChatAsNewNote}>새 노트로 저장</button>
                                    </div>

                                    <label htmlFor="target-note">기존 노트 선택</label>
                                    <select id="target-note" value={selectedNoteId}
                                            onChange={(event) => setSelectedNoteId(event.target.value)}>
                                        <option value="">노트 선택</option>
                                        {notes.map((note) => (
                                            <option key={note.id} value={note.id}>{note.title}</option>
                                        ))}
                                    </select>

                                    <div className="chat-note-actions">
                                        <button type="button" className="secondary" onClick={handleAppendChatToNote}>기존
                                            노트에 추가
                                        </button>
                                    </div>
                                </div>
                            )}
                        </section>
                    )}

                    {isChatSignalVisible && !isChatOpen && (
                        <div className="chat-signal">
                            <span>궁금한 점은 AI에게 물어보세요.</span>
                            <button type="button" onClick={() => setIsChatSignalVisible(false)}>닫기</button>
                        </div>
                    )}

                    <button type="button"
                            className={isChatOpen ? 'chat-floating-button active' : 'chat-floating-button'}
                            onClick={toggleChatWidget}>
                        AI
                    </button>
                </div>
            )}
        </>
    );
}

export default App;
