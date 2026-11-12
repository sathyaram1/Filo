// Per test:shoot (#1447): la correzione automatica a fine parola e il suo lampo, su una pagina servita su
// http://127.0.0.1:47812/ (/scuro: pagina scura; con SCENARIO_SCURO=1 anche Filo è scuro). Uso:
// main-file:tests/agent/scenari/correttore-automatica.js; tab:http://127.0.0.1:47812/; click-view:#ta; type:Domani vedo marco e poi; key:Space; type:perchè,; shot:lampo
await globalThis.SN_STORAGE.updateSettings({
  theme: process.env.SCENARIO_SCURO === '1' ? 'dark' : 'light',
  featureFlags: { spellcheck: true, spellcheckContext: false },
  correttore: { modelloErrori: false, automatica: true },
});
const http = process.mainModule.require('node:http');
const pagina = (scuro) => `<!doctype html><meta charset="utf-8"><title>Correzione automatica</title>
<body style="margin:0;padding:28px;font:17px sans-serif;${scuro ? 'background:#1f1b18;color:#ece4da;color-scheme:dark' : 'background:#faf7f2;color:#2b2622'}">
<p>Anna: ci vediamo domani?</p>
<textarea id="ta" lang="it" style="display:block;width:640px;height:120px;font:20px Georgia,serif;padding:10px"></textarea>
</body>`;
if (!globalThis.__paginaAutomatica) {
  globalThis.__paginaAutomatica = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(pagina(q.url.includes('scuro'))); });
  await new Promise((ok) => globalThis.__paginaAutomatica.listen(47812, '127.0.0.1', ok));
}
return 'pronto';
