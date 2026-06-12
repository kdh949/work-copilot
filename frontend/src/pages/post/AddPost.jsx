import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

function AddPost() {
    const navigate = useNavigate();

    const handlePostSubmit = (e) => {
        e.preventDefault();
        // 게시글 등록 로직 추가
        navigate('/');
    };

    return (
        <div>
            <h1>게시글 작성</h1>
            <form onSubmit={handlePostSubmit}>
                <input type = "text" placeholder = "제목" />
                <select>
                    {categories.map(category => (
                        <option key={category} value={category}>
                            {category}
                        </option>
                    ))}
                </select>
                <input type = "text" placeholder = "참석자" />
                <input type = "text" placeholder = "장소" />
                <button>게시글 등록</button>
                <button onClick={() => window.history.back()}>뒤로가기</button>
            </form>
        </div>
    )
}

export default AddPost