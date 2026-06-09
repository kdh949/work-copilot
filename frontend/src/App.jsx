import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import Home from './pages/Home';
import PostDetail from './pages/PostDetail';
import Login from './pages/Login';
import PrivateRoute from './components/PrivateRoute';

function App() {
  return (
    <BrowserRouter> {/* 여기서부터 URL 감지용도 */}
      <Routes>      {/* 아래에 경로 목록들을 정의해둠 */}
        {/* path = url 주소(경로) / element = 그 경로에서 보여줄 컴포넌트 */}
        {/* 로그인 페이지는 항상 진입 가능하게 */}
        <Route path = "/login" element={<Login />} />

        {/* 페이지는 프라이빗하게 운영 예정 */}
        <Route element = {<PrivateRoute />}>
          <Route path = "/" element={<Home />} />
          <Route path = "/post/:id" element={<PostDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App