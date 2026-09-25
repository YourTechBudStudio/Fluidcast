import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

const rootElement = document.querySelector('#root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <main className="relative z-10 flex h-full flex-col items-center justify-center gap-3">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">Fluidcast</h1>
      <p className="text-fg-muted">What's on your mind?</p>
    </main>
  </StrictMode>,
);
