import { RegistryProvider } from '@effect/atom-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App, MockApp } from './app';

import './styles.css';

const rootElement = document.querySelector('#root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <RegistryProvider>
      {/* MOCK ONLY (story #4): remove before merge. */}
      {new URLSearchParams(window.location.search).get('mock') === 'workers' ? (
        <MockApp />
      ) : (
        <App />
      )}
    </RegistryProvider>
  </StrictMode>,
);
