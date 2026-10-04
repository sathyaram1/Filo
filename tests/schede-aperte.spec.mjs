// #534 — Leggere e guidare una scheda aperta, e i mittenti e siti fidati. Filo legge il testo come lo vede una
// persona (niente di nascosto), apre e scrive come lei, ma i clic che cancellano o spediscono e i campi delle
// password non esistono. Segnare un sito fidato chiede «conferma» e, se ci scrivono in tanti, lo sconsiglia.

import { join } from 'node:path';
import { test, expect } from './fixtures/electron.mjs';
import { home, chiedi } from './helpers/chatFinta.mjs';
import { confirmText, fillConfirmInput, clickConfirm, CONFIRM_HOST } from './helpers/confirm.mjs';

const SHOTS = join(process.cwd(), 'tests', '.shots');

async function modello(app, giri) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await app.evaluate(async (_e, g) => {
    globalThis.__chiamate = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__chiamate.push({ messages: JSON.parse(JSON.stringify(messages)) });
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = (giro.toolCalls || []).map((c) => ({ ...c, arguments: JSON.stringify(c.arguments || {}) }));
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}

const ultimoEsito = async (app, k) => {
  const c = await app.evaluate(() => globalThis.__chiamate || []);
  const tool = c[k] ? c[k].messages.filter((m) => m.role === 'tool') : [];
  return tool.map((m) => String(m.content));
};

async function dietro(shell) {
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.activate(s.tabs.find((t) => t.url.startsWith('filo://newtab')).id);
  });
}

const NEGOZIO = `<!doctype html><html><head><meta charset="utf-8"><title>Negozio di prova</title></head><body>
<h1>Offerta del giorno</h1>
<p>Il prezzo è 42 euro.</p>
<div style="display:none">NASCOSTO-UNO</div>
<span style="font-size:0">NASCOSTO-DUE</span>
<div style="position:absolute;left:-9999px">NASCOSTO-TRE</div>
<span style="color:transparent">NASCOSTO-QUATTRO</span>
<div style="opacity:0">NASCOSTO-CINQUE</div>
<button id="altro" onclick="document.getElementById('extra').hidden = false">Mostra altro</button>
<p id="extra" hidden>Spedizione gratuita fino a domenica.</p>
<label>Nome <input id="nome"></label>
<label>Password <input id="pw" type="password"></label>
<button id="elimina" onclick="window.__eliminato = 1">Elimina account</button>
<form onsubmit="window.__spedito = 1; return false"><input aria-label="Email"><button>Iscriviti alla newsletter</button></form>
</body></html>`;

test('una scheda dietro: Filo legge il testo che si vede, apre e scrive come una persona, e i clic che cancellano o spediscono non partono', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const negozio = await testServer.openReady(openTab, NEGOZIO);
  await dietro(shell);
  const page = await home(app);
  const S = 'Negozio di prova';
  await modello(app, [
    { toolCalls: [{ id: 'l1', name: 'LEGGI_SCHEDA', arguments: { scheda: S } }] },
    { toolCalls: [{ id: 'l2', name: 'APRI_ELEMENTO', arguments: { scheda: S, elemento: 'Mostra altro' } }] },
    { toolCalls: [{ id: 'l3', name: 'SCRIVI_CAMPO', arguments: { scheda: S, campo: 'Nome', testo: 'Ada' } }] },
    {
      toolCalls: [
        { id: 'l4', name: 'APRI_ELEMENTO', arguments: { scheda: S, elemento: 'Elimina account' } },
        { id: 'l5', name: 'APRI_ELEMENTO', arguments: { scheda: S, elemento: 'Iscriviti alla newsletter' } },
        { id: 'l6', name: 'SCRIVI_CAMPO', arguments: { scheda: S, campo: 'Password', testo: 'segreta' } },
      ],
    },
    { toolCalls: [{ id: 'l7', name: 'LEGGI_SCHEDA', arguments: { scheda: S } }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'guarda la pagina del negozio');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 60_000 });

  const [prima] = await ultimoEsito(app, 1);
  expect(prima).toContain('Il prezzo è 42 euro.');
  for (const n of ['UNO', 'DUE', 'TRE', 'QUATTRO', 'CINQUE']) expect(prima).not.toContain(`NASCOSTO-${n}`);
  expect(prima).toMatch(/\d+\. pulsante «Mostra altro»/);
  expect(prima).toContain('sito non fra i fidati');
  // La scritta «Password» si vede, ma il suo campo non è fra quelli in cui Filo può scrivere.
  expect(prima).not.toMatch(/\d+\. campo «Password»/);

  // Nella pagina è successo quello che la chat dice: la parte in più si vede, il nome è scritto.
  await expect(negozio.locator('#extra')).toBeAttached();
  expect(await negozio.evaluate(() => document.getElementById('extra').hidden)).toBe(false);
  expect(await negozio.evaluate(() => document.getElementById('nome').value)).toBe('Ada');
  // E non è successo quello che non deve esistere.
  expect(await negozio.evaluate(() => [window.__eliminato, window.__spedito, document.getElementById('pw').value])).toEqual([undefined, undefined, '']);
  const rifiuti = (await ultimoEsito(app, 4)).slice(-3).join('\n');
  expect(rifiuti).toContain('NON fatto: «Elimina account» invia, paga, pubblica o cancella');
  expect(rifiuti).toContain('NON fatto: «Iscriviti alla newsletter» spedisce un modulo');
  expect(rifiuti).toContain('NON scritto: è un campo di password');
  const [dopo] = (await ultimoEsito(app, 5)).slice(-1);
  expect(dopo).toContain('Spedizione gratuita fino a domenica.');
});

const BLOG = `<!doctype html><html><head><meta charset="utf-8"><title>Blog di tutti</title></head><body>
<article><p>Un articolo.</p><span class="author">Anna</span></article>
<div class="comment"><span class="author">Bruno</span> Bel post.</div>
<div class="comment"><span class="author">Carla</span> Non sono d'accordo.</div>
<textarea aria-label="Scrivi un commento"></textarea>
</body></html>`;

test('segnare fidato un sito dove scrivono in tanti: lo sconsiglia nel riquadro, si può fare lo stesso con «conferma», e si toglie senza', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await openTab(testServer.html(BLOG, { pubblico: true }));
  await dietro(shell);
  const page = await home(app);
  await modello(app, [
    { toolCalls: [{ id: 'f1', name: 'SEGNA_FIDATO', arguments: { sito: 'sito-pubblico.test' } }] },
    { text: 'Ti chiedo conferma.' },
  ]);
  await chiedi(page, 'considera fidato questo blog');
  const bottone = page.locator('.dash-action-btn', { hasText: 'Segnare come fidato il sito sito-pubblico.test' });
  await expect(bottone).toBeVisible({ timeout: 60_000 });
  await bottone.click();
  await expect.poll(() => confirmText(page)).toContain('Te lo sconsiglio: sito-pubblico.test ha un campo per commentare e mostra 3 autori diversi');
  expect(await confirmText(page)).toContain('Così Filo si fida di più');
  expect(await confirmText(page)).not.toContain('non è reversibile');
  await fillConfirmInput(page, 'conferma');
  await clickConfirm(page, 'danger');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  await expect.poll(() => app.evaluate(async () => ((await globalThis.SN_STORAGE.getRaw('filo_fiducia', null)) || {}).siti || []))
    .toEqual([expect.objectContaining({ sito: 'sito-pubblico.test', via: 'chat' })]);

  // «Di chi ti fidi?» si chiede anche in chat.
  await modello(app, [
    { toolCalls: [{ id: 'f3', name: 'ELENCA_FIDATI', arguments: {} }] },
    { text: 'Ecco di chi mi fido.' },
  ]);
  await chiedi(page, 'di chi ti fidi?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco di chi mi fido.' })).toBeVisible({ timeout: 60_000 });
  const [elenco] = await ultimoEsito(app, 1);
  expect(elenco).toContain('Siti fidati (1)');
  expect(elenco).toContain('- sito-pubblico.test (segnato in chat)');
  expect(elenco).toContain('Mittenti fidati: nessuno.');
  // Anche chi passa dalle impostazioni li trova: gli elenchi sono voci come le altre, tenute fuori dalle impostazioni.
  await modello(app, [
    { toolCalls: [{ id: 'f4', name: 'LEGGI_IMPOSTAZIONI', arguments: { cerca: 'siti fidati' } }] },
    { text: 'Letto.' },
  ]);
  await chiedi(page, 'quali siti fidati ho?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Letto.' })).toBeVisible({ timeout: 60_000 });
  expect((await ultimoEsito(app, 1)).join('\n')).toContain('sito-pubblico.test (segnato in chat)');

  await modello(app, [
    { toolCalls: [{ id: 'f2', name: 'TOGLI_FIDATO', arguments: { sito: 'sito-pubblico.test' } }] },
    { text: 'Tolto.' },
  ]);
  await chiedi(page, 'non fidarti più di quel blog');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Tolto.' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  expect(await app.evaluate(async () => ((await globalThis.SN_STORAGE.getRaw('filo_fiducia', null)) || {}).siti)).toEqual([]);
});

test('un mittente si segna per indirizzo, mai per nome: col solo nome Filo non segna niente', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modello(app, [
    { toolCalls: [{ id: 'm1', name: 'SEGNA_FIDATO', arguments: { mittente: 'Marco' } }] },
    { text: 'Mi serve il suo indirizzo.' },
  ]);
  await chiedi(page, 'fidati di Marco');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Mi serve il suo indirizzo.' })).toBeVisible({ timeout: 60_000 });
  const [esito] = await ultimoEsito(app, 1);
  expect(esito).toContain('non è un indirizzo email');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
});

test('Preferenze: l\'interruttore è acceso e spiegato; aggiungere un fidato vuole «conferma», toglierlo no', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setRaw('filo_fiducia', { mittenti: [{ indirizzo: 'marco@uni.it', via: 'inviati', dal: 1 }], siti: [] });
  });
  const page = await openTab('filo://preferences/');
  await page.waitForLoadState('domcontentloaded');
  const sezione = page.locator('#sec-schede');
  await expect(sezione.locator('#schedeLeggere')).toBeChecked();
  await expect(sezione).toContainText('non preme mai Invia, Paga o Elimina');
  await expect(sezione.locator('#fidatiMittenti')).toContainText('marco@uni.it');
  await expect(sezione.locator('#fidatiMittenti')).toContainText('dagli Inviati');
  await expect(sezione.locator('#fidatiMittentiConto')).toHaveText('(1)');

  // Aggiungere: il riquadro chiede di scrivere «conferma».
  await sezione.locator('#fidatiMittenteNuovo').fill('Luca <Luca@Example.org>');
  await sezione.locator('#fidatiMittenteForm button').click();
  await expect.poll(() => confirmText(page)).toContain('Le mail di luca@example.org non conteranno più come scritte da uno sconosciuto');
  await page.screenshot({ path: join(SHOTS, 'preferenze-fidati-conferma.png') });
  await fillConfirmInput(page, 'conferma');
  await clickConfirm(page, 'danger');
  await expect(sezione.locator('#fidatiMittenti')).toContainText('luca@example.org');
  await expect(sezione.locator('#fidatiMittenti')).toContainText('aggiunto qui');

  // Un indirizzo storto non apre niente: lo dice sotto il campo.
  await sezione.locator('#fidatiMittenteNuovo').fill('marco');
  await sezione.locator('#fidatiMittenteForm button').click();
  await expect(sezione.locator('#fidatiMittenteErrore')).toHaveText('Non è un indirizzo email.');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);

  // Un sito di molti autori: il riquadro lo sconsiglia, ma lascia scegliere.
  await sezione.locator('#fidatiSitoNuovo').fill('https://www.reddit.com/r/italy');
  await sezione.locator('#fidatiSitoForm button').click();
  await expect.poll(() => confirmText(page)).toContain('Te lo sconsiglio: reddit.com è un sito dove pubblica chiunque');
  await clickConfirm(page, 'cancel');
  await expect(sezione.locator('#fidatiSiti')).toContainText('Nessun sito fidato');

  // Togliere: un clic, nessun riquadro.
  const riga = sezione.locator('#fidatiMittenti .mem-riga', { hasText: 'marco@uni.it' });
  await riga.hover();
  await riga.locator('.mem-via').click();
  await expect(sezione.locator('#fidatiMittenti')).not.toContainText('marco@uni.it');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  const fid = await app.evaluate(() => globalThis.SN_STORAGE.getRaw('filo_fiducia', null));
  expect(fid.mittenti.map((m) => m.indirizzo)).toEqual(['luca@example.org']);
  expect(fid.tolti).toEqual(['marco@uni.it']);

  // L'interruttore si spegne da qui, senza riquadri.
  await sezione.locator('#schedeLeggere').uncheck();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).schedeAperte)).toEqual({ leggere: false });
  await sezione.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'preferenze-schede-aperte.png') });
  await page.locator('#theme').selectOption('dark');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.snTheme)).toBe('dark');
  await sezione.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'preferenze-schede-aperte-scuro.png') });
});
