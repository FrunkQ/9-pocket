import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setUpInstall } from './lib/install';
import { loadPhotos } from './lib/photos';
import './styles.css';

void loadPhotos();
setUpInstall();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
