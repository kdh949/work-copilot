import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useState, useEffect, createContext } from 'react';
import Home from './pages/Home';
import Login from './pages/Login';
import Join from './pages/join';
import PostDetail from './pages/post/PostDetail';
import AddPost from './pages/post/AddPost';
import Modify from './pages/post/Modify';
import PrivateRoute from './components/PrivateRoute';

export const AuthContext = createContext(null);

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');

    if (!token) {
      setLoading(false);
      return;
    }

    fetch('/api/auth/verify', {
      headers: {Authorization: `Bearer ${token}`}
    })
    .then(res => res.json())
    .then(data => {
      if (data.ok) {
        setUser({id: data.id})
      }
      else {
        localStorage.removeItem('token')
      }
    })
    .catch(() => localStorage.removeItem('token'))
    .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      <BrowserRouter> {/* 여기서부터 URL 감지용도 */}
        <Routes>      {/* 아래에 경로 목록들을 정의해둠 */}
          {/* path = url 주소(경로) / element = 그 경로에서 보여줄 컴포넌트 */}
          {/* 로그인 페이지는 항상 진입 가능하게 */}
          <Route path = "/login" element={<Login />} />
          <Route path = "/join" element={<Join />} />

          {/* 페이지는 프라이빗하게 운영 예정 */}
          <Route element = {<PrivateRoute />}>
            <Route path = "/" element={<Home />} />
            <Route path = "/post/new" element={<AddPost />} />
            <Route path = "/post/:id" element={<PostDetail />} />
            <Route path = "/post/:id/modify" element={<Modify />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  )
}

export default App