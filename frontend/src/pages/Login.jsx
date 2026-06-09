function Login() {
    const [id, setId] = useState('');
    const [password, setPassword] = useState('');
    const navigate = useNavigate();

    async function handleLogin() {
        // 백엔드 nest.js에 로그인 요청
        const res = await fetch ('/api/auth/login', {
            method : 'POST', 
            headers : { 'Content-Type' : 'application/json' },
            body: JSON.stringify({id, password})
        })
        const data = await res.json();
        localStorage.setItem('token', data.token);
        navigate('/');
    }

    return (
        <div>
            <h1>로그인</h1>
            <input type = "text" placeholder = "아이디" value = {id} onChange = {e => setId(e.target.value)} />
            <input type = "password" placeholder = "비밀번호" value = {password} onChange = {e => setPassword(e.target.value)} />
            <button onClick = {handleLogin}>로그인</button>
        </div>
    )
}

export default Login