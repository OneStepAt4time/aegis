import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { I18nProvider } from './i18n/context';
import './index.css';

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/dashboard/sw.js')
      .then((registration) => {
        if (import.meta.env.DEV) console.log('SW registered:', registration);
      })
      .catch((error) => {
        if (import.meta.env.DEV) console.log('SW registration failed:', error);
      });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <BrowserRouter basename="/dashboard">
        <App />
      </BrowserRouter>
    </I18nProvider>
  </React.StrictMode>,
);
