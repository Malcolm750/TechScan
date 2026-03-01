import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// --- ENREGISTREMENT DU SERVICE WORKER (AVEC MISE À JOUR AUTO) ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('ServiceWorker enregistré avec succès.');

        // Détecte si Vercel a déployé une nouvelle mise à jour
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Une nouvelle version est prête ! On rafraîchit la page automatiquement.
              console.log('Nouvelle version disponible, mise à jour en cours...');
              window.location.reload();
            }
          });
        });
      })
      .catch(err => {
        console.error('Échec de l\'enregistrement du ServiceWorker:', err);
      });
  });
}