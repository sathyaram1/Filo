// Per test:shoot (#1446): un modello finto per i due controlli del correttore e una pagina con un campo, servita su
// http://127.0.0.1:47811/. Il controllo rapido conferma «quseta» e lascia in dubbio «Zanzottera»; il ragionato segna
// «alle 18». Uso: main-file:tests/agent/scenari/correttore-tre-segni.js; tab:http://127.0.0.1:47811/
const C = globalThis.SN_CONST;
await globalThis.SN_STORAGE.updateSettings({
  useDefaultModels: false,
  apiKeys: { openrouter: 'k-finta' },
  modelRegistry: { finto: { label: 'Finto', provider: 'openrouter', model: 'finto/finto', weights: 'open' } },
  models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'finto', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'finto' },
  featureFlags: { spellcheck: true, spellcheckContext: true },
});
const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
const finto = async ({ messages }) => {
  const t = String(messages[messages.length - 1].content);
  if (t.includes('Sei il controllo rapido di un correttore')) return fine('[quseta][questa][Refuso: si scrive «questa».][errore]');
  if (t.includes('proponi SUGGERIMENTI')) return fine('[alle 18][][Alle 18 di quale giorno? Nella chat si parla di martedì.][suggerimento]');
  return fine('');
};
globalThis.SN_PROVIDERS.completeWithFallback = finto;
globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
const http = process.mainModule.require('node:http');
const pagina = `<!doctype html><meta charset="utf-8"><title>Correttore</title>
<body style="margin:0;padding:28px;font:17px sans-serif;background:#faf7f2;color:#2b2622">
<p>Anna: ciao! ci vediamo martedì?</p>
<textarea id="ta" lang="it" style="display:block;width:640px;height:120px;font:20px Georgia,serif;padding:10px"></textarea>
</body>`;
if (!globalThis.__paginaCorrettore) {
  globalThis.__paginaCorrettore = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(pagina); });
  await new Promise((ok) => globalThis.__paginaCorrettore.listen(47811, '127.0.0.1', ok));
}
return 'pronto';
