//
// This is the renderer entry point that mounts the React app shell while
// delegating editor internals to a dedicated CodeMirror wrapper component.
//

import '../index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

// centralizing root lookup/mount keeps startup failure explicit when the
// HTML shell and renderer entry drift out of sync during refactors.
const rootElement = document.querySelector<HTMLElement>('#root');

if (!rootElement) {
  throw new Error('Missing React root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
