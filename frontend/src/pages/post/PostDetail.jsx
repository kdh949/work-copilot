import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

function PostDetail() {
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
            <h1>게시글 상세</h1>
            {mockPosts.map(post => (
                <div key={post.id}>
                    <h2>{post.title}</h2>
                    <p>작성자: {post.author.nickname}</p>
                    <p>카테고리: {post.category}</p>
                    <p>위치: {post.location}</p>
                    <p>작성일: {post.created_at}</p>
                </div>
            ))}
            <button onClick={() => window.history.back()}>뒤로가기</button>
            <button onClick={() => window.location.href = `/post/${mockPosts[0].id}/modify`}>수정하기</button>
            <button onClick={() => window.location.href = `/api/posts/${mockPosts[0].id}`}>삭제하기</button>
        </div>
    )
}

export default PostDetail