import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress benign platform errors
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.message?.includes('WebSocket closed without opened') || 
      event.reason?.message?.includes('vite')) {
    event.preventDefault();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
