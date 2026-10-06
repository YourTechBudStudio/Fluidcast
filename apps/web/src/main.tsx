import { RegistryProvider } from '@effect/atom-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Root } from './app';

import './styles.css';

const rootElement = document.querySelector('#root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <RegistryProvider>
      <Root />
    </RegistryProvider>
  </StrictMode>,
);
