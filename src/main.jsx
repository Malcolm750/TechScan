import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css'; // Assure-toi d'avoir Tailwind configuré ici

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// --- ENREGISTREMENT DU SERVICE WORKER POUR LA PWA ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Le fichier sw.js doit se trouver à la racine du dossier public/
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('ServiceWorker enregistré avec succès, scope:', registration.scope);
      })
      .catch(err => {
        console.error('Échec de l\'enregistrement du ServiceWorker:', err);
      });
  });
}