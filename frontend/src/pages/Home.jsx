import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

function Home() {
    const [posts, setPosts] = useState([])
    const navigate = useNavigate()

    useEffect(() => {
        fetch('/api/posts')
            .then(res => res.json())
            .then(data => setPosts(data))
            .catch(err => console.error('게시글 불러오기 실패', err))
    }, [])

    return (
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '6px', background: '#111114', minHeight: '100vh' }}>
            <button onClick={() => navigate('/post/new')} style={{ alignSelf: 'flex-end', marginBottom: '8px' }}>
                새 게시글 작성
            </button>
            {posts.map(post => (
                <div
                    key={post.id}
                    onClick={() => navigate(`/post/${post.id}`)}
                    style={{
                        background: '#2c2c2e',
                        border: '0.5px solid #3a3a3c',
                        borderRadius: '8px',
                        padding: '14px 18px',
                        cursor: 'pointer',
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{post.author.nickname}</span>
                        <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>{post.created_at}</span>
                    </div>
                    <div style={{ fontSize: '15px', fontWeight: 500, marginBottom: '10px' }}>{post.title}</div>
                    <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--color-text-tertiary)', marginRight: '6px' }}>장소</span>
                        {post.location}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--color-text-tertiary)', marginRight: '6px' }}>참석</span>
                        {post.author.nickname}
                    </div>
                    <hr style={{ border: 'none', borderTop: '0.5px solid var(--color-border-tertiary)', margin: '10px 0' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                        <span>👍 좋아요 {post.likes}</span>
                        <span style={{
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: 'var(--color-background-info)',
                            color: 'var(--color-text-info)',
                        }}>
                            {post.category}
                        </span>
                    </div>
                </div>
            ))}
        </div>
    )
}

export default Home
