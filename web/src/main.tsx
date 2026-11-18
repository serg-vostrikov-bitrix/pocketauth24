import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StatusPage } from './StatusPage';
import './theme.css';
import './status.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <StatusPage />
  </StrictMode>,
);
