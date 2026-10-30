import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppToaster } from './components/AppToaster';
import { refreshSession } from './lib/api';
import { queryClient } from './lib/queryClient';
import './index.css';

// Restore the session from the httpOnly refresh cookie (the access token is never persisted).
void refreshSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <AppToaster />
    </QueryClientProvider>
  </StrictMode>,
);
