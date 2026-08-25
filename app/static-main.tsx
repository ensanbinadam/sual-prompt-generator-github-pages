import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './globals.css';
import Home from './page';

const root = document.getElementById('root');
if (!root) throw new Error('تعذر العثور على عنصر تشغيل التطبيق.');

createRoot(root).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
