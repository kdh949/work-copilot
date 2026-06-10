import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

function Register() {
    const [name, setName] = useState('');
    const [user_id, setId] = useState('');
    const [nickname, setNickname] = useState('');
    const [password, setPw] = useState('');
    const [confirm, setConfirm] = useState('');
    const navigate = useNavigate();

    async function handleRegister() {
        if (password !== confirm) {
            alert('비밀번호가 일치하지 않습니다.');
            return;
        }

        try {
            const res = await fetch('/api/account/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, user_id, nickname, password })
            });

            if (!res.ok) {
                const data = await res.json();
                alert(data.message || '회원가입 실패');
                return;
            }

            alert('회원가입 성공!');
            navigate('/login');
        } catch (err) {
            alert('네트워크 오류');
        }
    }

    return (
        <div>
            <h1>회원가입</h1>
            <input type="text" placeholder="이름" value={name} onChange={e => setName(e.target.value)} />
            <input type="text" placeholder="아이디" value={user_id} onChange={e => setId(e.target.value)} />
            <input type="text" placeholder="닉네임" value={nickname} onChange={e => setNickname(e.target.value)} />
            <input type="password" placeholder="비밀번호" value={password} onChange={e => setPw(e.target.value)} />
            <input type="password" placeholder="비밀번호 확인" value={confirm} onChange={e => setConfirm(e.target.value)} />
            <button onClick={handleRegister}>회원가입</button>
        </div>
    )
}

export default Register