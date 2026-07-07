import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from './store';
import './styles.css';

// Test hook: allows automated import of File objects from the console/tests.
window.__lrTest = {
  importFiles: (files) => useStore.getState().importFiles(files),
  getState: () => useStore.getState(),
};

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
