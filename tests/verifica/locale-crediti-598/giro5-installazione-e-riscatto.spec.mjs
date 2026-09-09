// Verifica #598, quinto giro — il cammino di chi installa Filo oggi:
// nessuna chiave, la pagina Crediti chiede l'invito, il riscatto dà saldo e
// codici, la chiave personale è cifrata e sopravvive al riavvio, la chiave
// propria ha la precedenza, la chat parte con la chiave personale e scrive il
// registro d'uso nella forma che le regole Firestore accettano.
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  avviaServer, avviaFilo, apriCrediti, fintoOpenRouter, impostaOpenRouter,
  chiamateOpenRouter, commitFirestore, chiediInChat, cartellaFiloSecurity, paginaWeb,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo: il server dei crediti non si può far girare');

let server;
test.beforeEach(async () => { server = await avviaServer(); });
test.afterEach(async () => { await server.chiudi(); });

async function chiudi(filo) {
  try { await filo.app.close(); } catch (_) {}
}

test('installazione nuova: nessuna chiave, la pagina chiede l’invito e la home porta lì', async () => {
  const filo = await avviaFilo({ env: server.env });
  try {
    // Nessuna chiave da nessuna parte (né incastonata, né in ambiente).
    const src = await filo.app.evaluate(async () => globalThis.SN_WALLET_MAIN.keySource());
    expect(src).toBe('none');
    const eff = await filo.app.evaluate(async () => (await globalThis.__filoHandlers.getEffectiveSettings()).apiKeys.openrouter || '');
    expect(eff).toBe('');

    // La home chiede l'invito e porta alla pagina con un clic.
    const dash = await filo.openTab('filo://dashboard/dashboard.html');
    await expect(dash.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 15_000 });
    await expect(dash.locator('#homeMessage')).not.toContainText(/Accedi con un profilo/i);
    const sugg = dash.locator('#suggestions .dash-suggestion', { hasText: /Apri Crediti/ });
    await expect(sugg).toHaveCount(1);

    // La prima domanda in chat: stessa indicazione e il tasto «Apri Crediti»,
    // che apre davvero la pagina (nessuna scheda Crediti aperta prima).
    const bolla = await chiediInChat(dash, 'ciao, quanti crediti ho?');
    await expect(bolla).toContainText(/codice d.invito/i);
    await expect(bolla).not.toContainText(/Accedi con un profilo/i);
    const apri = bolla.locator('button', { hasText: 'Apri Crediti' });
    await expect(apri).toHaveCount(1);
    expect(filo.app.windows().filter((w) => w.url().startsWith('filo://credits')).length).toBe(0);
    await apri.click();
    await expect.poll(() => filo.app.windows().filter((w) => w.url().startsWith('filo://credits')).length, { timeout: 10_000 }).toBe(1);
    // Il server non è stato disturbato da nessuna chiamata ai modelli.
    expect(server.counters.calls.filter((c) => c.name !== 'walletState')).toHaveLength(0);

    const page = filo.app.windows().find((w) => w.url().startsWith('filo://credits'));
    await page.waitForFunction(() => !document.getElementById('wallet').hidden, null, { timeout: 15_000 });
    await expect(page.locator('#redeemForm')).toBeVisible();
    await expect(page.locator('#hero')).toBeHidden();
    await expect(page.locator('#refillHint')).toBeHidden();
    await expect(page.locator('#offlineHint')).toBeHidden();
    await expect(page.locator('#ownerSection')).toBeHidden();
    await expect(page.locator('#invitesSection')).toBeHidden();
    const testo = await page.locator('main').innerText();
    expect(testo).not.toMatch(/mezzanotte|Accedi col tuo account|1\.010/);
    // Il modulo è la prima cosa della pagina, sotto il titolo.
    const ordine = await page.evaluate(() => {
      const els = [...document.querySelectorAll('main > *')].filter((e) => !e.hidden && e.id !== 'title');
      return els[0]?.id;
    });
    expect(ordine).toBe('wallet');
    // Anche il suggerimento della home porta lì (la scheda già aperta si riusa o se ne apre un'altra: basta arrivarci).
    await sugg.click();
    await expect.poll(() => filo.app.windows().filter((w) => w.url().startsWith('filo://credits')).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  } finally { await chiudi(filo); }
});

test('riscatto: minuscole, spazi e trattini; saldo e tre codici; chiave cifrata; stessa identità al riavvio', async () => {
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  const userData = filo.userData;
  try {
    const page = await apriCrediti(filo.openTab);
    const brutto = ` ${code.slice(0, 4).toLowerCase()} - ${code.slice(4).toLowerCase()} `;
    await page.fill('#inviteCode', brutto);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemMsg')).toContainText(/riscattato/i, { timeout: 15_000 });
    await expect(page.locator('#redeemForm')).toBeHidden();
    await expect(page.locator('#balance')).toHaveText('5.000');
    await expect(page.locator('#hero')).toBeVisible();
    await expect(page.locator('#refillHint')).toContainText(/\+100 crediti ogni giorno/);
    await expect(page.locator('#offlineHint')).toBeHidden();
    await expect(page.locator('#invites li')).toHaveCount(3);
    await expect(page.locator('#invites li .sn-wallet-invite-state').first()).toHaveText('da dare');
    const codici = await page.locator('#invites li .sn-wallet-code').allInnerTexts();
    for (const c of codici) expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Copia al clic.
    await page.locator('#invites li .sn-wallet-code').first().click();
    await expect(page.locator('#invites li .sn-wallet-code').first()).toHaveText('Copiato');
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    if (clip) expect(clip).toBe(codici[0]);

    // La chiave personale: sul disco cifrata, non nelle Opzioni, usata dai modelli.
    const walletBin = join(userData, 'wallet.bin');
    expect(existsSync(walletBin)).toBe(true);
    const key = [...server.keys.keys.values()][0].key;
    expect(readFileSync(walletBin, 'latin1')).not.toContain(key);
    expect(readFileSync(walletBin, 'latin1')).not.toContain('sk-or-v1');
    const settings = await filo.app.evaluate(async () => globalThis.__filoStorage.get('settings'));
    expect(JSON.stringify(settings)).not.toContain(key);
    expect(await filo.app.evaluate(async () => globalThis.SN_WALLET_MAIN.keySource())).toBe('personal');
    const eff = await filo.app.evaluate(async () => (await globalThis.__filoHandlers.getEffectiveSettings()).apiKeys.openrouter);
    expect(eff).toBe(key);
    // Un secondo riscatto: i crediti ci sono già (dal server, non da un controllo locale).
    const [altro] = await server.codiciOwner(1);
    const esito = await filo.app.evaluate(async (_, c) => globalThis.SN_HANDLE_MESSAGE({ type: 'wallet_redeem', code: c }, { isShell: true }, 'filo://credits'), altro);
    expect(esito.ok).toBe(false);
    expect(esito.status).toBe('already_in');
    expect(esito.message).toMatch(/già i tuoi crediti/);
  } finally { await chiudi(filo); }

  // Riavvio con la stessa cartella: nessuna nuova iscrizione, solo il rinnovo.
  const signUps = server.counters.signUps;
  expect(signUps).toBe(1);
  const bis = await avviaFilo({ userData, env: server.env });
  try {
    const page = await apriCrediti(bis.openTab);
    await expect(page.locator('#balance')).toHaveText('5.000', { timeout: 15_000 });
    await expect(page.locator('#redeemForm')).toBeHidden();
    await expect(page.locator('#invites li')).toHaveCount(3);
    expect(server.counters.signUps).toBe(signUps);
    expect(server.counters.refreshes).toBeGreaterThan(0);
    // La home non chiede più l'invito.
    const dash = await bis.openTab('filo://dashboard/dashboard.html');
    await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });
    await expect(dash.locator('#homeMessage')).not.toContainText(/codice d.invito/i);
    await expect(dash.locator('#suggestions .dash-suggestion', { hasText: /Apri Crediti/ })).toHaveCount(0);
  } finally { await chiudi(bis); rmSync(userData, { recursive: true, force: true }); }
});

test('la chat usa la chiave personale, scrive il registro d’uso, e la chiave propria ha la precedenza', async () => {
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await page.fill('#inviteCode', code);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
    const key = [...server.keys.keys.values()][0].key;
    const pseudonym = [...server.store.docs.wallets.values()][0].pseudonym;

    await fintoOpenRouter(filo.app, { text: 'Risposta del modello finto: tutto bene.', costUsd: 0.0021 });
    const dash = await filo.openTab('filo://dashboard/dashboard.html');
    const bolla = await chiediInChat(dash, 'dimmi qualcosa');
    await expect(bolla).toContainText(/modello finto/);
    const calls = await chiamateOpenRouter(filo.app);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.auth).toBe(`Bearer ${key}`);

    // Il registro d'uso: righe con i soli nove campi, lo pseudonimo del server,
    // il costo che il router ha dichiarato. (Il flush parte dopo 3 secondi.)
    await filo.app.evaluate(async () => globalThis.SN_WALLET_MAIN.flush());
    await expect.poll(async () => (await commitFirestore(filo.app)).length, { timeout: 15_000 }).toBeGreaterThan(0);
    const commits = await commitFirestore(filo.app);
    const writes = commits.flatMap((c) => c.body?.writes || []);
    expect(writes.length).toBeGreaterThan(0);
    const CAMPI = ['pseudonym', 'at', 'action', 'model', 'servedBy', 'promptTokens', 'completionTokens', 'costUsd', 'credits'].sort();
    for (const w of writes) {
      expect(w.update.name).toMatch(/\/wallet-usage\/[A-Za-z0-9]{20}$/);
      expect(w.currentDocument).toEqual({ exists: false });
      expect(Object.keys(w.update.fields).sort()).toEqual(CAMPI);
      expect(w.update.fields.pseudonym.stringValue).toBe(pseudonym);
      expect(pseudonym).toHaveLength(16);
      const costo = Number(w.update.fields.costUsd.doubleValue ?? w.update.fields.costUsd.integerValue);
      expect(costo).toBeCloseTo(0.0021, 6);
      expect(w.update.fields.servedBy.stringValue).toBe('FintoHost');
      expect(Number(w.update.fields.credits.doubleValue ?? w.update.fields.credits.integerValue)).toBeGreaterThan(0);
      expect(w.update.fields.at.stringValue).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    // Il token con cui si scrive è quello dell'installazione, non uno inventato.
    for (const c of commits) expect(c.auth).toMatch(/^Bearer /);

    // La chiave propria vince, e la pagina lo dice; tolta, si torna alla personale.
    await filo.app.evaluate(async () => {
      const s = (await globalThis.__filoStorage.get('settings')).settings || {};
      await globalThis.__filoStorage.set({ settings: { ...s, apiKeys: { ...(s.apiKeys || {}), openrouter: 'sk-or-v1-mia-chiave-propria' } } });
    });
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#walletNote')).toContainText(/tua chiave OpenRouter/i, { timeout: 15_000 });
    expect(await filo.app.evaluate(async () => globalThis.SN_WALLET_MAIN.keySource())).toBe('own');
    await impostaOpenRouter(filo.app, { text: 'Con la chiave tua.' });
    const b2 = await chiediInChat(dash, 'e adesso?');
    await expect(b2).toContainText(/chiave tua/);
    const calls2 = await chiamateOpenRouter(filo.app);
    expect(calls2[calls2.length - 1].auth).toBe('Bearer sk-or-v1-mia-chiave-propria');
    // Con la chiave propria il registro non si scrive (il consumo è suo).
    const prima = (await commitFirestore(filo.app)).length;
    await filo.app.evaluate(async () => globalThis.SN_WALLET_MAIN.flush());
    await new Promise((r) => setTimeout(r, 500));
    expect((await commitFirestore(filo.app)).length).toBe(prima);

    await filo.app.evaluate(async () => {
      const s = (await globalThis.__filoStorage.get('settings')).settings || {};
      await globalThis.__filoStorage.set({ settings: { ...s, apiKeys: { ...(s.apiKeys || {}), openrouter: '' } } });
    });
    expect(await filo.app.evaluate(async () => globalThis.SN_WALLET_MAIN.keySource())).toBe('personal');
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#walletNote')).toBeHidden();
  } finally { await chiudi(filo); }
});

test('crediti finiti: con 402 la chiamata è una sola, la chat lo spiega, un 429 invece passa al tentativo dopo', async () => {
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await page.fill('#inviteCode', code);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });

    await fintoOpenRouter(filo.app, { status: 402 });
    const dash = await filo.openTab('filo://dashboard/dashboard.html');
    const bolla = await chiediInChat(dash, 'ciao');
    await expect(bolla).toContainText(/crediti sono finiti/i);
    const calls = await chiamateOpenRouter(filo.app);
    expect(calls.filter((c) => !c.url.endsWith('/models'))).toHaveLength(1);

    // Il toast in una pagina web, con la quota di domani, una volta sola.
    const sito = await paginaWeb();
    try {
      const web = await filo.openTab(sito.url);
      await web.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
      // Il primo avviso è partito con la chiamata di prima, quando questa
      // pagina non c'era; un secondo entro dieci minuti non parte (è voluto).
      // Si controlla il testo che l'avviso porta, con la quota di domani.
      const testo = await filo.app.evaluate(() => globalThis.SN_WALLET.outOfCreditsMessage({ usingOwnKey: false, dailyCredits: 100 }));
      expect(testo).toMatch(/finiti.*domani ne arrivano 100/);
      await filo.app.evaluate(async () => { globalThis.SN_WALLET_MAIN.outOfCreditsNotice(); });
      await web.waitForTimeout(800);
      const toasts = await web.evaluate(() => [...document.querySelectorAll('.sn-toast')].map((t) => t.textContent));
      expect(toasts.length).toBeLessThanOrEqual(1);
    } finally { await sito.chiudi(); }

    // Sulla catena di tentativi: un 429 passa al modello dopo, un 402 si ferma
    // al primo, in streaming e no.
    const conta = async (status, stream) => {
      await impostaOpenRouter(filo.app, { status });
      await filo.app.evaluate(() => { globalThis.__orCalls = []; });
      const esito = await filo.app.evaluate(async ({}, s) => {
        const P = globalThis.SN_PROVIDERS;
        const attempts = [
          { provider: 'openrouter', apiKey: 'k', model: 'a/uno' },
          { provider: 'openrouter', apiKey: 'k', model: 'b/due' },
        ];
        const msgs = [{ role: 'user', content: 'ciao' }];
        try {
          if (s) await P.streamCompleteWithFallback({ attempts, messages: msgs, onDelta: () => {} });
          else await P.completeWithFallback({ attempts, messages: msgs });
          return 'ok';
        } catch (e) { return String(e.message); }
      }, stream);
      const n = (await chiamateOpenRouter(filo.app)).filter((c) => !c.url.endsWith('/models')).length;
      return { esito, n };
    };
    for (const stream of [false, true]) {
      const r429 = await conta(429, stream);
      expect(r429.n).toBe(2);
      const r402 = await conta(402, stream);
      expect(r402.n).toBe(1);
      expect(r402.esito).toMatch(/402/);
    }
    await impostaOpenRouter(filo.app, { status: 429 });
    const b2 = await chiediInChat(dash, 'riprova');
    await expect(b2).toContainText(/sovraccarico|non disponibile/i);
  } finally { await chiudi(filo); }
});
