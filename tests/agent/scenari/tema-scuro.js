// Per test:shoot (#1246): il tema scuro di Filo e quello del sistema, che decide i colori della cornice e della barra.
// Uso: main-file:tests/agent/scenari/tema-scuro.js
electron.nativeTheme.themeSource = 'dark';
const percorso = process.mainModule.require('node:path').join(process.cwd(), 'src', 'main', 'services', 'handlers.js');
await process.mainModule.require(percorso).applySettingsUpdate({ theme: 'dark' });
