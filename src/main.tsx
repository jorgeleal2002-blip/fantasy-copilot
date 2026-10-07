import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './register-sw';
import { trackViewportHeight } from './viewport-height';
import './styles/global.css';

trackViewportHeight();
/* An app does not zoom. iPhone ignores the viewport's "no" in Safari and
 * sometimes on the home screen too, so the pinch itself is refused: Safari's
 * own gesture events, and a second finger on a page that is not a map. */
const noZoom = (e: Event) => e.preventDefault();
document.addEventListener('gesturestart', noZoom, { passive: false });
document.addEventListener('gesturechange', noZoom, { passive: false });
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
/* Installed on the home screen, audio has to be woken from inside a tap — so
 * the very first one anywhere does it, long before a draft asks for a sound. */

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
