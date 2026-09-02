import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './register-sw';
import { readySfx } from './ui/sfx';
import { trackViewportHeight } from './viewport-height';
import './styles/global.css';

trackViewportHeight();
/* Installed on the home screen, audio has to be woken from inside a tap — so
 * the very first one anywhere does it, long before a draft asks for a sound. */
readySfx();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
