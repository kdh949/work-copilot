import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './design-system/tokens.css'
import './index.css'

// BrowserRouter needs no deploy change: nginx already serves index.html for
// unknown paths (`try_files $uri $uri/ /index.html`), so a pasted deep link
// reaches the app instead of a 404.
createRoot(document.getElementById('root')!).render( // 여기서 !는 TS에게 null이 아님에 확신을 주는 것임 (정말 값이 있다고 확신할 때만 사용)
    <StrictMode>
        <BrowserRouter>
            <App/>
        </BrowserRouter>
    </StrictMode>,
);
