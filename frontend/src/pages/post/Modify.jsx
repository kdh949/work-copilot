import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

function Modify() {
    const categories = ['공지', '후기', '가입인사', '자유', '관심사', '투표']
    const navigate = useNavigate();

    const handlePostSubmit = (e) => {
        e.preventDefault();
        // 게시글 수정 로직 추가
        navigate('/');
    };

    const mockPosts = [
        {
            id: 1,
            author: { 
                nickname: '테스터', 
                name: '홍길동'
            },
            category: '가입인사',
            title: '테스트 게시글',
            location: '서울',
            created_at: '2026-06-10',
        }
    ]

    return (
        <div>
            <h1>게시글 수정</h1>
            <form onSubmit={handlePostSubmit}>
                <input type = "text" placeholder = "제목" defaultValue={mockPosts[0].title} />
                <select defaultValue={mockPosts[0].category}>
                    {categories.map(category => (
                        <option key={category} value={category}>
                            {category}
                        </option>
                    ))}
                </select>
                <input type = "text" placeholder = "참석자" defaultValue={mockPosts[0].author.nickname} />
                <input type = "text" placeholder = "장소" defaultValue={mockPosts[0].location} />
                <button>게시글 수정</button>
                <button onClick={() => window.history.back()}>뒤로가기</button>
            </form>
        </div>
    )
}

export default Modify