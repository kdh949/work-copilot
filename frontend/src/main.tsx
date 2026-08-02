import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './design-system/tokens.css'
import './index.css'

createRoot(document.getElementById('root')!).render( // 여기서 !는 TS에게 null이 아님에 확신을 주는 것임 (정말 값이 있다고 확신할 때만 사용)
    <StrictMode>
        <App/>
    </StrictMode>,
);
