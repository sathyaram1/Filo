// Per test:shoot (#1448): un modello finto che riempie «nel 14xx» con 1492 e manda a cercare «p/e di soli xx», una ricerca
// finta che risponde 27, e una pagina con un campo su http://127.0.0.1:47812/ (/scuro: pagina scura).
// Uso: main-file:tests/agent/scenari/correttore-segnaposto.js; tab:http://127.0.0.1:47812/
const C = globalThis.SN_CONST;
await globalThis.SN_STORAGE.updateSettings({
  useDefaultModels: false,
  apiKeys: { openrouter: 'k-finta' },
  modelRegistry: { finto: { label: 'Finto', provider: 'openrouter', model: 'finto/finto', weights: 'open' } },
  models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'finto', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'finto' },
  featureFlags: { spellcheck: true, spellcheckContext: true },
  correttore: { segnaposti: true, segnapostiWeb: true, pausaRagionatoMs: 1000 },
});
const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
const finto = async ({ messages }) => {
  const t = String(messages[messages.length - 1].content);
  if (t.includes('Chi scrive ha messo delle x')) return fine('[27][Rapporto prezzo/utili di Alphabet][1][20 ottobre 2026]');
  if (String(messages[0].content).includes('proponi SUGGERIMENTI')) {
    return fine([
      '[nel 14xx][nel 1492][Cristoforo Colombo sbarcò in America il 12 ottobre 1492][segnaposto]',
      '[di soli xx][][Alphabet P/E ratio][cerca][web]',
    ].join('\n'));
  }
  return fine('[][][][nessuno]');
};
globalThis.SN_PROVIDERS.completeWithFallback = finto;
globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
globalThis.SN_FONTI_SEGNAPOSTO.wikipedia = async () => [];
globalThis.SN_FONTI_SEGNAPOSTO.web = async () => [{ titolo: 'Alphabet PE ratio', sito: 'borsa.example', url: 'https://borsa.example/goog', data: '', testo: 'Alphabet P/E ratio: 27.1 as of October 20, 2026' }];
const http = process.mainModule.require('node:http');
const pagina = (scuro) => `<!doctype html><meta charset="utf-8"><title>Segnaposto</title>
<body style="margin:0;padding:40px 28px;font:17px sans-serif;${scuro ? 'background:#1f1b18;color:#ece4da;color-scheme:dark' : 'background:#faf7f2;color:#2b2622'}">
<textarea id="ta" lang="it" style="display:block;width:760px;height:150px;font:20px Georgia,serif;padding:10px"></textarea>
</body>`;
if (!globalThis.__paginaSegnaposto) {
  globalThis.__paginaSegnaposto = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(pagina(q.url.includes('scuro'))); });
  await new Promise((ok) => globalThis.__paginaSegnaposto.listen(47812, '127.0.0.1', ok));
}
return 'pronto';
