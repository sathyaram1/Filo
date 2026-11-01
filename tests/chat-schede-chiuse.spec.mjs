// #884 — in chat si ritrovano le schede chiuse o archiviate per contenuto e per chi le ha chiuse (a mano, dalla chat,
// dalla pulizia), e si riaprono com'erano; se la pagina non c'è più, la chat resta davanti col riassunto salvato.
// Il modello è finto e prende l'id dall'esito che riceve, come farebbe uno vero. Regole: tests/unit/cercaSchedeChiuse.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from './helpers/chatFinta.mjs';

// Su un nome di rete pubblico: una pagina di 127.0.0.1 è della rete di casa, e al modello ne arriva solo il sito.
const PUBBLICO = { pubblico: true };

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);

async function tornaAllaHome(shell) {
  const h = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
}

const archivio = (app) => app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.listMeta())
  .map((t) => ({ id: t.id, title: t.title, url: t.url, motivo: t.motivo, giro: t.giro || null })));

const esitoPerIlModello = async (app, id) => {
  for (const msgs of await chiamateAlModello(app)) {
    const m = msgs.find((x) => x.role === 'tool' && x.tool_call_id === id);
    if (m) return String(m.content);
  }
  return '';
};

// Giri del modello; con `riapri` l'id di RIAPRI_SCHEDA lo legge dall'ultimo esito che ha ricevuto.
async function modelloCheRiapre(app, giri) {
  await modelloFinto(app, [{ text: '' }]);
  await app.evaluate((_e, g) => {
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      globalThis.__chatFinta_calls.push(JSON.parse(JSON.stringify(messages)));
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      let calls = [];
      if (giro.call) {
        let args = giro.call.args || {};
        if (giro.riapri) {
          const esito = [...messages].reverse().find((m) => m.role === 'tool');
          const id = (String(esito ? esito.content : '').match(/\[([0-9a-f]{8}-[0-9a-f-]{27})\]/) || [])[1] || 'nessuno';
          args = { id };
        }
        calls = [{ id: giro.call.id, name: giro.call.name, arguments: JSON.stringify(args) }];
      }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [],
        text: giro.text || '', toolCalls: calls, finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}

test('si ritrovano per chi le ha chiuse e per contenuto, e si riaprono com\'erano', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const chat = await home(app);
  await openTab(testServer.html('<title>Le orche del Mediterraneo</title><p>orche', PUBBLICO));
  await openTab(testServer.html('<title>Ricetta del pane</title><p>pane', PUBBLICO));
  await openTab(testServer.html('<title>Notizie di ieri</title><p>notizie', PUBBLICO));
  await openTab(testServer.html('<title>Lettura</title><p>resta', PUBBLICO));
  await tornaAllaHome(shell);
  const perTitolo = async (t) => (await schede(shell)).find((x) => x.title === t);
  const urlOrche = (await perTitolo('Le orche del Mediterraneo')).url;

  // A mano, dalla chat, dalla pulizia.
  await shell.evaluate((id) => window.filoShell.tabs.close(id), (await perTitolo('Le orche del Mediterraneo')).id);
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.chiudiSchede([id]),
    (await perTitolo('Ricetta del pane')).id);
  await app.evaluate(async ({ BrowserWindow }) => {
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((x, i) => ({ i, action: /Notizie/.test(x.title) ? 'archive' : 'keep', reason: 'notizie già lette' })),
    });
    await BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.runAutoTriage({ trigger: 'idle' });
  });
  await expect.poll(async () => (await archivio(app)).map((t) => `${t.title}:${t.motivo}`).sort(), { timeout: 10_000 })
    .toEqual(['Le orche del Mediterraneo:mano', 'Notizie di ieri:pulizia', 'Ricetta del pane:filo']);
  expect((await archivio(app)).find((t) => t.motivo === 'pulizia').giro).toBe('idle');

  await modelloCheRiapre(app, [
    { call: { id: 'm1', name: 'SCHEDE_CHIUSE', args: { motivo: 'pulizia' } } },
    { text: 'La pulizia ha archiviato le notizie di ieri.' },
  ]);
  await chiedi(chat, 'cosa ha archiviato la pulizia?');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'notizie di ieri' })).toBeVisible({ timeout: 15_000 });
  const pulizia = await esitoPerIlModello(app, 'm1');
  expect(pulizia).toContain('Notizie di ieri');
  expect(pulizia).toContain('archiviata dalla pulizia delle schede (per inattività)');
  expect(pulizia).not.toContain('Ricetta del pane');
  expect(pulizia).not.toContain('Le orche');
  expect(pulizia).toMatch(/<<<DATI_PAGINA>>>[\s\S]*Notizie di ieri[\s\S]*<<<FINE_DATI_PAGINA>>>/);
  await expect(chat.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });

  await modelloCheRiapre(app, [
    { call: { id: 'c1', name: 'SCHEDE_CHIUSE', args: { cerca: 'orche' } } },
    { call: { id: 'c2', name: 'RIAPRI_SCHEDA' }, riapri: true },
    { text: 'Ho riaperto la pagina sulle orche.' },
  ]);
  await chiedi(chat, 'riaprimi la pagina sulle orche che ho chiuso');
  await expect.poll(async () => (await schede(shell)).filter((t) => t.url === urlOrche).length, { timeout: 15_000 }).toBe(1);
  // La pagina c'è: riaperta davanti, come dalla ricerca del filo.
  await expect.poll(async () => { const x = await shell.evaluate(async () => window.filoShell.tabs.snapshot()); return x.tabs.find((t) => t.id === x.activeId).url; }).toBe(urlOrche);
  expect(await esitoPerIlModello(app, 'c1')).toContain('chiusa dall\'utente');
  const riga = chat.locator('.dash-activity').last();
  await expect(riga).toContainText('Riaperta', { timeout: 10_000 });
  await expect(riga).toContainText('Le orche del Mediterraneo');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Ho riaperto la pagina sulle orche.' })).toBeVisible({ timeout: 10_000 });
  await ripristina(app);
});

test('una pagina che non c\'è più si riapre dietro, sull\'errore, e in chat resta il riassunto', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  const chat = await home(app);
  const sparita = `${testServer.originPubblico}/pagina-che-non-esiste-piu`;
  const RIASSUNTO = 'Le orche cacciano in gruppo e comunicano con fischi diversi per ogni branco.';
  await app.evaluate(async (_e, [url, riassunto]) => {
    const e = await globalThis.SN_ARCHIVED_TABS.archive({
      url, title: 'Orche: come cacciano', closedAt: new Date(Date.now() - 86_400_000).toISOString(), reason: 'manual',
    });
    await globalThis.SN_ARCHIVED_TABS.update(e.id, { summary: riassunto });
  }, [sparita, RIASSUNTO]);

  await modelloCheRiapre(app, [
    { call: { id: 's1', name: 'SCHEDE_CHIUSE', args: { cerca: 'orche' } } },
    { call: { id: 's2', name: 'RIAPRI_SCHEDA' }, riapri: true },
    { text: 'La pagina non c\'è più: parlava di come cacciano le orche.' },
  ]);
  await chiedi(chat, 'riaprimi la pagina sulle orche');

  const carta = chat.locator('.dash-riassunto-chiusa');
  await expect(carta).toBeVisible({ timeout: 20_000 });
  await expect(carta).toContainText('Orche: come cacciano');
  await expect(carta).toContainText(RIASSUNTO);
  await expect(carta).toContainText('non risponde più');
  // L'utente resta nella chat, dove c'è il riassunto; la scheda sull'errore è dietro, per riprovare.
  const s = await shell.evaluate(async () => window.filoShell.tabs.snapshot());
  expect(String(s.tabs.find((t) => t.id === s.activeId).url)).toMatch(/^filo:\/\/newtab/);
  expect(s.tabs.some((t) => t.url === sparita)).toBe(true);
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'parlava di come cacciano' })).toBeVisible({ timeout: 10_000 });
  const esito = await esitoPerIlModello(app, 's2');
  expect(esito).toContain('non c\'è più');
  expect(esito).toMatch(/<<<DATI_PAGINA>>>[\s\S]*Le orche cacciano in gruppo[\s\S]*<<<FINE_DATI_PAGINA>>>/);
  await chat.screenshot({ path: 'tests/.shots/chat-schede-chiuse-riassunto.png' });
  await chat.emulateMedia({ colorScheme: 'dark' });
  await chat.screenshot({ path: 'tests/.shots/chat-schede-chiuse-riassunto-scuro.png' });
  await ripristina(app);
});
