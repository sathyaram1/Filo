// #1692 — la conversazione della home: chiuderla non butta la bozza, il cursore resta nella casella, più schede home
// continuano la stessa, «Copia il testo» della ricerca copia il messaggio intero, la conversazione di un'altra app
// riaperta arriva al modello a ogni età, /home mostra quello che mostra la home ricaricata, una barra sola.
import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from './helpers/chatFinta.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { campoRicerca } from './helpers/tastiHome.mjs';

const SHOTS = 'tests/.shots';
const GIA_QUI = [
  { toolCalls: [{ id: 'h1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
  { text: 'Sei già qui, nella home.' },
];

const chatDi = (app, testo) => app.evaluate(async (_e, t) => (await globalThis.SN_IL_FILO.chats())
  .filter((c) => !c.app && c.messages.some((m) => m.text === t)).map((c) => c.id), testo);
const finita = (app, id) => app.evaluate(async (_e, x) => !!(await globalThis.SN_IL_FILO.chats()).find((c) => c.id === x)?.finita, id);

// Una conversazione dell'Editor scritta nel filo come la scrive l'app, all'ora data.
async function chatDellEditor(app, { id, ts, messaggi, soggetto = 'tesi' }) {
  await app.evaluate(async (_e, { id: chat, ts: quando, messaggi: ms, soggetto: sogg }) => {
    const T = globalThis.SN_FILO_EVENTI.TIPI;
    await globalThis.SN_IL_FILO.transazione(async (t) => {
      const passo = (k) => new Date(Date.parse(quando) + k * 1000).toISOString();
      await t.scrivi([
        t.evento(T.CHAT_APERTA, { chat, app: 'editor', rif: `doc-${chat}`, soggetto: sogg }, { autore: 'utente', ts: passo(0) }),
        t.evento(T.CHAT_TITOLO, { chat, title: `Editor su ${sogg}`, kind: globalThis.SN_CHAT_ARCHIVE.KIND_TALK, soggetto: sogg }, { autore: 'filo', ts: passo(0) }),
        ...ms.map((m, k) => t.evento(T.MESSAGGIO, {
          chat, msg: { role: m.role, text: m.text, ...(m.role === 'filo' ? { esterno: globalThis.SN_CONVERSAZIONI_APP.ESTERNO.editor } : {}) },
        }, { autore: m.role === 'user' ? 'utente' : 'filo', ts: passo(k + 1) })),
      ]);
    });
    globalThis.__filoHandlers.broadcastToFiloPages({ type: globalThis.SN_MSG.MSG.FILO_RIGHE_APP_CAMBIATE });
  }, { id, ts, messaggi, soggetto });
}

test('#1204.6 chiudere la conversazione col bottone o con la spunta dell’appunto lascia la bozza nella casella', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await modelloFinto(app, GIA_QUI);
  await chiedi(page, 'portami alla home');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });
  await page.locator('#input').fill('e domani che tempo fa?');
  await page.locator('.dash-action-btn', { hasText: 'Chiudi la conversazione' }).click();
  await expect(page.locator('.dash-action-btn', { hasText: 'Conversazione chiusa' })).toBeDisabled();
  const [chiusa] = await chatDi(app, 'portami alla home');
  await expect.poll(() => finita(app, chiusa)).toBe(true);
  await expect(page.locator('#input')).toHaveValue('e domani che tempo fa?');
  await expect(page.locator('#input')).toBeFocused();
  await ripristina(app);

  await page.locator('#input').fill('');
  await modelloFinto(app, [{ text: 'Segnato.', toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"comprare il latte","contesto":"spesa"}' }] }, { text: '' }]);
  await chiedi(page, 'segnati di comprare il latte');
  const spunta = page.locator('.dash-bubble-filo .dash-action-btn[title="Chiudi la conversazione"]');
  await expect(spunta).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await page.locator('#input').fill('anche il pane');
  await spunta.click();
  const [dellAppunto] = await chatDi(app, 'segnati di comprare il latte');
  await expect.poll(() => finita(app, dellAppunto)).toBe(true);
  await expect(page.locator('#input')).toHaveValue('anche il pane');
  await ripristina(app);

  // /clear chiude anche lui, e lì la casella conteneva il comando: si svuota.
  await modelloFinto(app, [{ text: 'Certo.' }]);
  await chiedi(page, 'ciao di nuovo');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Certo.' })).toBeVisible({ timeout: 10_000 });
  const [diNuovo] = await chatDi(app, 'ciao di nuovo');
  await page.locator('#input').fill('/clear');
  await page.locator('#input').press('Enter');
  await expect.poll(() => finita(app, diNuovo)).toBe(true);
  await expect(page.locator('#input')).toHaveValue('');
  await ripristina(app);
});

test('#1115.6 un secondo clic (o un doppio clic) su «Conversazione chiusa» lascia il cursore nella casella', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await home(app);
  const page = await openTab('filo://newtab/');
  await expect(page.locator('#input')).toBeVisible();
  await modelloFinto(app, GIA_QUI);
  await chiedi(page, 'portami alla home');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });
  await page.locator('.dash-action-btn', { hasText: 'Chiudi la conversazione' }).click();
  const chiusa = page.locator('.dash-action-btn', { hasText: 'Conversazione chiusa' });
  await expect(chiusa).toBeDisabled();
  await chiusa.click({ force: true });
  await page.keyboard.type('primo');
  await expect(page.locator('#input')).toHaveValue('primo');
  await chiusa.dblclick({ force: true });
  await page.keyboard.type(' e secondo');
  await expect(page.locator('#input')).toHaveValue('primo e secondo');
  await ripristina(app);
});

test('#869.2 due schede home continuano una conversazione sola, da tutte e due le parti', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const prima = await home(app);
  const seconda = await openTab('filo://newtab/');
  await expect(seconda.locator('#input')).toBeVisible();
  await modelloFinto(app, [{ text: 'Le orche cacciano in gruppo.' }, { text: 'Le balene filtrano il krill.' }, { text: 'Anche i delfini.' }]);

  await shell.locator('.tab').first().click();
  await chiedi(prima, 'come cacciano le orche?');
  await expect(prima.locator('.dash-bubble-filo', { hasText: 'Le orche cacciano' })).toBeVisible({ timeout: 10_000 });
  await expect(prima.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });

  await shell.locator('.tab').nth(1).click();
  await expect(seconda.locator('#bubbles .dash-bubble-filo', { hasText: 'Le orche cacciano' })).toBeVisible({ timeout: 10_000 });
  await chiedi(seconda, 'e le balene?');
  await expect(seconda.locator('.dash-bubble-filo', { hasText: 'Le balene filtrano' })).toBeVisible({ timeout: 10_000 });
  await expect(seconda.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const [orche] = await chatDi(app, 'come cacciano le orche?');
  await expect.poll(() => chatDi(app, 'e le balene?')).toEqual([orche]);

  await shell.locator('.tab').first().click();
  await chiedi(prima, 'e i delfini?');
  await expect(prima.locator('.dash-bubble-filo', { hasText: 'Anche i delfini' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => chatDi(app, 'e i delfini?')).toEqual([orche]);
  const conversazioni = await app.evaluate(async () => (await globalThis.SN_IL_FILO.chats()).filter((c) => !c.app && c.messages.length).length);
  expect(conversazioni, 'in Cronologia una conversazione sola').toBe(1);
  await ripristina(app);
});

test('#869.2 «Copia il testo» di un messaggio trovato copia il messaggio intero, non l’estratto', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const inizio = 'Le orche vivono in gruppi familiari guidati dalle femmine più anziane.';
  const fine = 'Per questo la loro caccia al leone marino sembra un balletto provato.';
  const lungo = [inizio, ...Array.from({ length: 12 }, (_, k) => `Riga di mezzo numero ${k} con dettagli sulle abitudini del branco.`), fine].join(' ');
  await app.evaluate(async (_e, testo) => {
    await globalThis.SN_FILO_CHATS.append('chat-orche', { role: 'user', text: 'raccontami delle orche' });
    await globalThis.SN_FILO_CHATS.append('chat-orche', { role: 'filo', text: testo });
  }, lungo);
  await (await campoRicerca(page)).fill('balletto');
  const trovato = page.locator('#cercaRisultati .dash-cerca-msg').first();
  await expect(trovato).toBeVisible({ timeout: 10_000 });
  await expect(trovato).toContainText('…');
  await trovato.click({ button: 'right' });
  const menu = menuDi(page);
  await menu.voce('Copia il testo').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(lungo);
});

test('#974.1 la conversazione dell’Editor di dieci giorni fa, riaperta dalla Cronologia, arriva al modello', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await home(app);
  const id = 'editor-dieci-giorni';
  await chatDellEditor(app, {
    id, ts: new Date(Date.now() - 10 * 86400000).toISOString(),
    messaggi: [{ role: 'user', text: 'Cosa ne pensi del capitolo sui licheni?' }, { role: 'filo', text: 'Va accorciato di metà.' }],
  });
  const riaperta = await openTab(`filo://dashboard/dashboard.html?chat=${id}`);
  await expect(riaperta.locator('.dash-riga-app-msg-filo', { hasText: 'Va accorciato di metà.' })).toBeVisible({ timeout: 10_000 });
  await modelloFinto(app, [{ text: 'Parlavate del capitolo sui licheni.' }]);
  await chiedi(riaperta, 'riassumimi questa conversazione');
  await expect(riaperta.locator('.dash-bubble-filo', { hasText: 'Parlavate del capitolo' })).toBeVisible({ timeout: 10_000 });
  const mandato = JSON.stringify((await chiamateAlModello(app))[0] || []);
  expect(mandato, 'il riferimento per rileggerla').toContain(id);
  await ripristina(app);
});

test('#974.1 dopo /home la home mostra le stesse righe che mostra ricaricata', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Ciao, dimmi pure.' }]);
  await chiedi(page, 'ciao Filo');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ciao, dimmi pure.' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await chatDellEditor(app, {
    id: 'editor-adesso', ts: new Date().toISOString(),
    messaggi: [{ role: 'user', text: 'Accorcio i licheni?' }, { role: 'filo', text: 'Sì, di metà.' }],
  });
  await expect(page.locator('#bubbles .dash-riga-app')).toHaveCount(1, { timeout: 10_000 });
  const righe = () => page.locator('#bubbles').evaluate((b) => [...b.querySelectorAll('.dash-bubble, .dash-riga-app')]
    .filter((x) => x.offsetParent !== null).map((x) => (x.classList.contains('dash-riga-app')
      ? `riga:${x.querySelector('.dash-riga-app-testo').textContent}` : `bolla:${x.textContent.trim().slice(0, 40)}`)));
  await page.locator('#input').fill('/home');
  await page.locator('#input').press('Enter');
  await expect(page.locator('#input')).toHaveValue('');
  const dopoHome = await righe();
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  await expect(page.locator('#bubbles .dash-bubble-filo', { hasText: 'Ciao, dimmi pure.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(righe, { timeout: 5_000 }).toEqual(dopoHome);
  await ripristina(app);
});

test('#974.1 uno scambio lungo dell’Editor aperto nella home vuota scorre con una barra sola', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await home(app);
  const id = 'editor-lungo';
  await chatDellEditor(app, {
    id, ts: new Date(Date.now() - 3600000).toISOString(),
    messaggi: Array.from({ length: 30 }, (_, k) => ({ role: k % 2 ? 'filo' : 'user', text: `Messaggio ${k}: ${'parole sul capitolo dei licheni '.repeat(6)}` })),
  });
  const riaperta = await openTab(`filo://dashboard/dashboard.html?chat=${id}`);
  await expect(riaperta.locator('.dash-riga-app-msg').first()).toBeVisible({ timeout: 10_000 });
  const scorrono = () => riaperta.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => {
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.offsetParent !== null;
  }).map((el) => el.id || el.className));
  expect(await scorrono()).toHaveLength(1);
  mkdirSync(SHOTS, { recursive: true });
  await riaperta.screenshot({ path: `${SHOTS}/1692-scambio-lungo.png` });
});
