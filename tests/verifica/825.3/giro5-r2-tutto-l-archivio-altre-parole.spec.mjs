// Giro 5: «cancella tutto l'archivio» detto con altre parole lascia fuori le pagine della rete di casa.
import { test, expect } from '../../fixtures/electron.mjs';

const RICHIESTE = ['tutte le schede chiuse', 'tutta la cronologia delle schede', 'tutto quanto', 'svuota completamente l\'archivio'];

test('ogni modo di chiedere tutto l\'archivio propone anche le pagine di casa', async ({ app, shell }) => {
  void shell;
  const out = await app.evaluate(async (_e, richieste) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const items = [
      { id: 'a', url: 'https://gatti.example.com/', title: 'Gatti persiani' },
      { id: 'b', url: 'https://torte.example.com/', title: 'Ricetta della torta' },
      { id: 'c', url: 'http://192.168.1.1/', title: 'Pannello del router' },
    ].map((x, i) => ({ ...x, favicon: '', closedAt: new Date(Date.now() - i * 1000).toISOString(), reason: 'manual', coOpenUrls: [], snippet: x.title }));
    await chrome.storage.local.set({ [C.STORAGE_KEYS.ARCHIVED_TABS]: items });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async () => { throw new Error('fetch failed'); };
    // Il giudice capisce «tutto»: prende ogni pagina che gli arriva.
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const user = String(messages[1] && messages[1].content || '');
      const presi = [...user.matchAll(/^#(\d+) /gm)].map((m) => Number(m[1]));
      return { text: JSON.stringify({ pertinenti: presi }), provider: attempts[0].provider, model: attempts[0].model, usage: {} };
    };
    const MSG = globalThis.SN_MSG.MSG;
    const res = {};
    for (const q of richieste) {
      const r = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.ARCHIVIO_DA_CANCELLARE, query: q }, { url: 'filo://dashboard/dashboard.html' });
      res[q] = (r.results || []).map((x) => x.title);
    }
    return res;
  }, RICHIESTE);
  const fuori = RICHIESTE.filter((q) => !out[q].includes('Pannello del router'));
  expect(fuori, 'richieste di tutto l\'archivio che lasciano fuori la pagina del router').toEqual([]);
});
