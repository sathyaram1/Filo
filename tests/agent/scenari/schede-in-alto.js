// Per test:shoot (#1246): a schermo intero, poi le schede scese dal bordo alto. Uso:
// main-file:tests/agent/scenari/schede-in-alto.js; wait:900; shot:schermo-intero; main-file:tests/agent/scenari/schede-in-alto.js; wait:600; shot:schede
const tm = electron.BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
if (!tm.contentFullscreen) tm.setContentFullscreen(true);
else tm.schedeInAlto.mostra();
