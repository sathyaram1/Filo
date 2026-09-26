// #536 — il guardiano degli avvisi, dal finto Gmail alla colonna della home.
//
// Le tre cose che il feedback chiede di provare: una mail che imita la banca
// non diventa una notifica ma una riga che dice cosa ha visto; una mail normale
// diventa una notifica col mittente in chiaro; col guardiano irraggiungibile
// l'avviso resta in coda e compare quando torna.
//
// Il testo avvelenato parte davvero da una pagina web servita in locale: è da
// lì che arriva nella vita vera, e una prova che se lo scrive da sé proverebbe
// mezzo cammino.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, confirmText } from './helpers/confirm.mjs';

const NEWTAB = 'filo://newtab/';

const GMAIL = `<!doctype html><meta charset="utf-8"><title>Posta</title>
  <div id="m1" data-da="sicurezza@banca-clienti.invalid">
    Gentile cliente, per un controllo antifrode confermi le credenziali del
    conto entro oggi, altrimenti il conto verra' sospeso.
  </div>
  <div id="m2" data-da="marco.bianchi@example.invalid">
    Ciao, la riunione di lunedi' e' spostata alle 16:30 in sala 2. Ci sei?
  </div>`;

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek, gemma',
        [C.ACTIONS.NOTICE_GUARD]: 'claude, gemma-lite',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// Mette al posto della pipeline dei provider una risposta decisa dal test, e
// registra su che modelli è stata chiesta. `verdetto` null = nessuna risposta
// (rete giù, fornitore fermo).
async function guardianoRisponde(app, verdetto) {
  await app.evaluate(async (_e, verdetto) => {
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__guardOrig) globalThis.__guardOrig = P.completeWithFallback;
    globalThis.__guardModelli = [];
    P.completeWithFallback = async ({ attempts }) => {
      globalThis.__guardModelli.push(attempts.map((a) => a.model).join('|'));
      if (verdetto === null) throw new Error('fornitore giu');
      return {
        text: JSON.stringify(verdetto),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
  }, verdetto);
}

// Legge una mail dalla pagina e la propone come avviso, ESATTAMENTE come farà
// il giro di lettura della posta: dalla superficie di Filo, col mittente e la
// classe di fiducia della fonte.
async function proponi(dash, testo, fonte) {
  return dash.evaluate(async ({ testo, fonte }) => {
    const { MSG } = window.SN_MSG;
    return chrome.runtime.sendMessage({
      type: MSG.FILO_AVVISO_PROPOSTO, testo, fonte, classe: 'messaggio',
      richiesta: 'avvisami delle mail importanti', modelloProduttore: 'deepseek',
    });
  }, { testo, fonte });
}

function schede(dash) {
  return dash.evaluate(() => [...document.querySelectorAll('.dash-live-card')].map((c) => ({
    testo: c.querySelector('.dash-live-text')?.textContent || '',
    meta: c.querySelector('.dash-live-meta')?.textContent || '',
    attesa: c.dataset.attesa === '1',
    link: [...c.querySelectorAll('.dash-live-links .dash-live-link')].map((b) => b.textContent),
  })));
}

test('una mail che imita la banca non diventa una notifica: diventa una riga che dice cosa ha visto', async ({ app, openTab, testServer }) => {
  await configura(app);
  await guardianoRisponde(app, { passa: false, motivo: 'credenziali' });

  const posta = await testServer.openReady(openTab, GMAIL);
  const esca = await posta.evaluate(() => document.getElementById('m1').textContent.trim());
  const dash = await openTab(NEWTAB);

  const r = await proponi(dash, `La tua banca scrive: ${esca}`, 'sicurezza@banca-clienti.invalid');
  expect(r.ok).toBe(true);
  expect(r.esito).toBe('blocca');

  await expect(dash.locator('.dash-live-card')).toHaveCount(1);
  const viste = await schede(dash);
  expect(viste[0].testo).toContain('Ho fermato un avviso nato da sicurezza@banca-clienti.invalid');
  expect(viste[0].testo).toContain('credenziali');
  // La cosa che conta: il testo della mail non è arrivato sotto gli occhi.
  expect(viste[0].testo).not.toContain('antifrode');

  // E il blocco si ritrova in Preferenze, perché un guardiano che grida al
  // lupo si riconosce solo contandone i blocchi.
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#guardianoBlocchi .grd-row')).toHaveCount(1);
  await expect(pref.locator('#guardianoBlocchi .grd-motivo')).toContainText('credenziali');
  await expect(pref.locator('#guardianoVuoto')).toBeHidden();

  // Il registro si svuota, ma non per sbaglio: prima chiede, e un no lo lascia
  // dov'era.
  await pref.locator('#guardianoSvuota').click();
  await expect.poll(() => confirmText(pref)).toContain('Svuota il registro');
  await clickConfirm(pref, 'cancel');
  await expect(pref.locator('#guardianoBlocchi .grd-row')).toHaveCount(1);
  await pref.locator('#guardianoSvuota').click();
  await clickConfirm(pref, 'ok');
  await expect(pref.locator('#guardianoVuoto')).toBeVisible();
  await expect(pref.locator('#guardianoSvuota')).toBeHidden();

  // Il secondo giudizio NON è girato sul modello che ha scritto il testo.
  const modelli = await app.evaluate(() => globalThis.__guardModelli);
  expect(modelli.length).toBeGreaterThan(0);
  expect(modelli.join(' ')).not.toContain('deepseek-v4-pro');
});

test('una mail normale diventa una notifica, col mittente in chiaro e i collegamenti che dicono dove portano', async ({ app, openTab, testServer }) => {
  await configura(app);
  await guardianoRisponde(app, { passa: true, motivo: null });

  const posta = await testServer.openReady(openTab, GMAIL);
  const mail = await posta.evaluate(() => document.getElementById('m2').textContent.trim());
  const dash = await openTab(NEWTAB);

  const r = await proponi(
    dash,
    `${mail} [il calendario](https://calendario.example.invalid/evento/22)`,
    'marco.bianchi@example.invalid',
  );
  expect(r.esito).toBe('passa');

  await expect(dash.locator('.dash-live-card')).toHaveCount(1);
  const viste = await schede(dash);
  expect(viste[0].testo).toContain('16:30');
  expect(viste[0].attesa).toBe(false);
  expect(viste[0].meta).toBe('da marco.bianchi@example.invalid');
  // La scritta del collegamento è la sua destinazione, non «il calendario».
  expect(viste[0].link).toHaveLength(1);
  expect(viste[0].link[0]).toContain('calendario.example.invalid');
  expect(viste[0].link[0]).not.toContain('il calendario');
});

test('col guardiano irraggiungibile l\'avviso resta in coda, e compare quando torna', async ({ app, openTab, testServer }) => {
  await configura(app);
  await guardianoRisponde(app, null);

  const posta = await testServer.openReady(openTab, GMAIL);
  const mail = await posta.evaluate(() => document.getElementById('m2').textContent.trim());
  const dash = await openTab(NEWTAB);

  const r = await proponi(dash, mail, 'marco.bianchi@example.invalid');
  expect(r.esito).toBe('attesa');

  await expect(dash.locator('.dash-live-card')).toHaveCount(1);
  let viste = await schede(dash);
  expect(viste[0].attesa).toBe(true);
  expect(viste[0].testo).toContain('in attesa del controllo');
  // Non si perde, ma nemmeno si legge: è proprio il testo che nessuno ha
  // ancora guardato.
  expect(viste[0].testo).not.toContain('16:30');

  // Il fornitore torna. «Controlla adesso» sulla scheda è la strada di chi non
  // vuole aspettare il giro successivo.
  await guardianoRisponde(app, { passa: true, motivo: null });
  await dash.locator('.dash-live-card[data-attesa="1"] .dash-live-link').click();

  await expect(dash.locator('.dash-live-card[data-attesa="1"]')).toHaveCount(0);
  viste = await schede(dash);
  expect(viste[0].testo).toContain('16:30');
  expect(viste[0].meta).toBe('da marco.bianchi@example.invalid');
});

test('inserimenti insoliti: vuoto, spazi, HTML, emoji, e un avviso troppo lungo che viene rifiutato col numero', async ({ app, openTab }) => {
  await configura(app);
  await guardianoRisponde(app, { passa: true, motivo: null });
  const dash = await openTab(NEWTAB);

  for (const vuoto of ['', '   ', '\n\n']) {
    const r = await proponi(dash, vuoto, 'x@y.invalid');
    expect(r.ok).toBe(false);
  }
  await expect(dash.locator('.dash-live-card')).toHaveCount(0);

  // Un taglio silenzioso qui vorrebbe dire mostrare la coda senza averla
  // guardata: si rifiuta, e il rifiuto porta il numero.
  const tetto = await app.evaluate(() => globalThis.SN_GUARDIANO_AVVISI.MAX_TESTO());
  const lungo = await proponi(dash, 'a'.repeat(tetto + 1), 'x@y.invalid');
  expect(lungo.ok).toBe(false);
  expect(lungo.code).toBe('troppo_lungo');
  expect(lungo.max).toBe(tetto);
  await expect(dash.locator('.dash-live-card')).toHaveCount(0);

  // Al tetto esatto passa: il limite è un limite, non un margine.
  expect((await proponi(dash, 'b'.repeat(tetto), 'x@y.invalid')).esito).toBe('passa');
  await expect(dash.locator('.dash-live-card')).toHaveCount(1);

  // Markup e emoji arrivano come testo, non come pezzi di pagina.
  const r = await proponi(dash, '🙂 <img src=x onerror=alert(1)> <b>grassetto</b>', 'x@y.invalid');
  expect(r.esito).toBe('passa');
  await expect(dash.locator('.dash-live-card')).toHaveCount(2);
  const html = await dash.evaluate(() => document.querySelector('.dash-live-card .dash-live-text').innerHTML);
  expect(html).not.toContain('<img');
  expect(html).not.toContain('<b>');
  expect(html).toContain('🙂');
});

test('un sito visitato non può proporre avvisi', async ({ app, openTab, testServer }) => {
  await configura(app);
  await guardianoRisponde(app, { passa: true, motivo: null });
  const posta = await testServer.openReady(openTab, GMAIL);

  const r = await posta.evaluate(async () => {
    try {
      return await chrome.runtime.sendMessage({
        type: 'filo_avviso_proposto', testo: 'Apri subito il link della banca.',
        fonte: 'la pagina', classe: 'messaggio',
      });
    } catch (e) { return { ok: false, error: String(e && e.message) }; }
  });
  expect(r.ok).toBe(false);

  const dash = await openTab(NEWTAB);
  await expect(dash.locator('.dash-live-card')).toHaveCount(0);
});
