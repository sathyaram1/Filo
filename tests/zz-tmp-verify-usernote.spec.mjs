// SPEC TEMPORANEA DI VERIFICA — da cancellare a fine verifica.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const BASE = {
  seq: 900, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-08-18T10:00:00Z',
  images: [],
  status: 'todo',
};

const A = (extra) => ({ ...BASE, _id: 'fb-a', seq: 900, name: 'Feed A', text: 'testo A', ...extra });
const B = (extra) => ({ ...BASE, _id: 'fb-b', seq: 901, name: 'Feed B', text: 'testo B', ...extra });

// Canale verso il main sotto controllo del test: ogni feedback_update resta
// appeso finché il test non lo sblocca (successo o rifiuto), così le risposte
// si possono far tornare nell'ordine che si vuole.
async function prepara(page, feeds, tab = 'queue', openId = 'fb-a', admin = true) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());

  await page.evaluate(() => {
    window.__sentRaw = [];
    window.__pend = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__sentRaw.push(JSON.parse(JSON.stringify(msg)));
        return new Promise((res) => { window.__pend.push(res); });
      }
      return orig(msg);
    };
    window.__ok = (i) => window.__pend[i]({ ok: true });
    window.__ko = (i, e) => window.__pend[i]({ ok: false, error: e || 'rifiutato dal server' });
    window.__sent = () => window.__sentRaw.map((m) => ({ id: m.id, note: m.userNote, keys: Object.keys(m).sort() }));
  });

  await page.evaluate(({ fs, t, id, ad }) => {
    window.__mgTest.setAdmin(ad);
    window.__mgTest.setData(fs);
    window.__mgTest.setTab(t);
    if (id) window.__mgTest.openDetail(id);
  }, { fs: feeds, t: tab, id: openId, ad: admin });
}

const box = (page) => page.locator('#mgUserNoteText');
const msg = (page) => page.locator('#mgUserNoteMsg');
const sent = (page) => page.evaluate(() => window.__sent());
const nPend = (page) => page.evaluate(() => window.__pend.length);

async function salva(page, testo) {
  await box(page).fill(testo);
  await box(page).press('Enter');
}

// Aspetta che sia partito l'n-esimo update (o fallisce se non parte).
async function attendiInvii(page, n) {
  await page.waitForFunction((k) => window.__pend.length >= k, n, { timeout: 3000 }).catch(() => {});
  return nPend(page);
}

async function rientra(page, id) {
  await page.evaluate((x) => { window.__mgTest.openDetail('fb-b'); window.__mgTest.openDetail(x); }, id);
}

test('ritiro subito dopo il salvataggio: la casella svuotata parte davvero', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [A({ userNote: '' }), B({})]);

  await salva(page, 'prima frase');
  expect(await attendiInvii(page, 1)).toBe(1);
  await salva(page, '');
  expect(await attendiInvii(page, 2)).toBe(2);

  expect(await sent(page)).toEqual([
    { id: 'fb-a', note: 'prima frase', keys: ['id', 'type', 'userNote'] },
    { id: 'fb-a', note: '', keys: ['id', 'type', 'userNote'] },
  ]);

  await page.evaluate(() => { window.__ok(0); window.__ok(1); });
  await expect(msg(page)).toHaveText('Frase rimossa');
  await expect(box(page)).toHaveValue('');
  await rientra(page, 'fb-a');
  await expect(box(page)).toHaveValue('');
});

test('ritorno alla frase precedente mentre il salvataggio e in volo', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [A({ userNote: 'vecchia' }), B({})]);

  await salva(page, 'nuova');
  expect(await attendiInvii(page, 1)).toBe(1);
  await salva(page, 'vecchia');
  expect(await attendiInvii(page, 2)).toBe(2);

  expect((await sent(page)).map((s) => s.note)).toEqual(['nuova', 'vecchia']);
  await page.evaluate(() => { window.__ok(0); window.__ok(1); });
  await expect(box(page)).toHaveValue('vecchia');
  await rientra(page, 'fb-a');
  await expect(box(page)).toHaveValue('vecchia');
});

test('tre salvataggi: il terzo che ripristina il primo parte', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [A({ userNote: '' }), B({})]);

  await salva(page, 'uno');
  await attendiInvii(page, 1);
  await salva(page, 'due');
  await attendiInvii(page, 2);
  await salva(page, 'uno');
  expect(await attendiInvii(page, 3)).toBe(3);
  expect((await sent(page)).map((s) => s.note)).toEqual(['uno', 'due', 'uno']);

  await page.evaluate(() => { window.__ok(0); window.__ok(1); window.__ok(2); });
  await expect(box(page)).toHaveValue('uno');
  await rientra(page, 'fb-a');
  await expect(box(page)).toHaveValue('uno');
});

test('ripensamento dopo essere usciti e rientrati nel feedback', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [A({ userNote: 'x' }), B({})]);

  await salva(page, 'y');
  await attendiInvii(page, 1);
  await rientra(page, 'fb-a');            // il pannello ridipinge col vecchio 'x'
  await expect(box(page)).toHaveValue('x');
  await box(page).press('Enter');          // risalvare 'x' = ritirare 'y'
  expect(await attendiInvii(page, 2)).toBe(2);
  expect((await sent(page)).map((s) => s.note)).toEqual(['y', 'x']);

  await page.evaluate(() => { window.__ok(0); window.__ok(1); });
  await expect(box(page)).toHaveValue('x');
  await rientra(page, 'fb-a');
  await expect(box(page)).toHaveValue('x');
});

test('dopo un salvataggio fallito, riprovare la stessa frase riparte', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [A({ userNote: '' }), B({})]);

  await salva(page, 'zeta');
  await attendiInvii(page, 1);
  await page.evaluate(() => window.__ko(0));
  await expect(msg(page)).toHaveText(/rifiutato/);

  await box(page).press('Enter');
  expect(await attendiInvii(page, 2)).toBe(2);
  expect((await sent(page)).map((s) => s.note)).toEqual(['zeta', 'zeta']);
  await page.evaluate(() => window.__ok(1));
  await expect(msg(page)).toHaveText('Salvata');
  await rientra(page, 'fb-a');
  await expect(box(page)).toHaveValue('zeta');
});

test('ritiro fallito dopo un salvataggio andato a buon fine: si puo riprovare', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [A({ userNote: '' }), B({})]);

  // 1) scrivo 'zeta' e salvo — la risposta arriva dopo
  await salva(page, 'zeta');
  await attendiInvii(page, 1);
  // 2) ci ripenso, svuoto e risalvo mentre la prima e' ancora in volo
  await salva(page, '');
  expect(await attendiInvii(page, 2)).toBe(2);
  // 3) la PRIMA va a buon fine (a destinazione ora c'e' 'zeta')…
  await page.evaluate(() => window.__ok(0));
  // 4) …e il RITIRO fallisce
  await page.evaluate(() => window.__ko(1));
  await expect(msg(page)).toHaveText(/rifiutato/);

  // 5) l'owner riprova il ritiro: la casella e' gia' vuota, ma a destinazione
  //    c'e' 'zeta'. Deve partire un nuovo svuotamento.
  await box(page).press('Enter');
  const n = await attendiInvii(page, 3);
  expect(await msg(page).innerText()).not.toBe('Nessuna modifica');
  expect(n).toBe(3);
  expect((await sent(page)).map((s) => s.note)).toEqual(['zeta', '', '']);
});

test('ripensamento su un feedback mentre un altro ha un salvataggio in volo', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [A({ userNote: '' }), B({ userNote: '' })]);

  await salva(page, 'per A');
  await attendiInvii(page, 1);
  await page.evaluate(() => window.__mgTest.openDetail('fb-b'));
  await salva(page, 'per B');
  await attendiInvii(page, 2);
  await salva(page, '');                     // ritiro su B, con A ancora in volo
  expect(await attendiInvii(page, 3)).toBe(3);
  expect(await sent(page)).toEqual([
    { id: 'fb-a', note: 'per A', keys: ['id', 'type', 'userNote'] },
    { id: 'fb-b', note: 'per B', keys: ['id', 'type', 'userNote'] },
    { id: 'fb-b', note: '', keys: ['id', 'type', 'userNote'] },
  ]);
  await page.evaluate(() => { window.__ok(0); window.__ok(1); window.__ok(2); });
  await expect(box(page)).toHaveValue('');
  await rientra(page, 'fb-a');
  await expect(box(page)).toHaveValue('per A');
});

test('a bocce ferme risalvare lo stesso testo non spedisce niente', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [A({ userNote: 'ferma' }), B({})]);

  await box(page).press('Enter');
  await expect(msg(page)).toHaveText('Nessuna modifica');
  expect(await nPend(page)).toBe(0);

  await salva(page, 'cambiata');
  await attendiInvii(page, 1);
  await page.evaluate(() => window.__ok(0));
  await expect(msg(page)).toHaveText('Salvata');
  await box(page).press('Enter');
  await expect(msg(page)).toHaveText('Nessuna modifica');
  expect(await nPend(page)).toBe(1);
});

test('la casella e visibile su ogni scheda e sui chiusi, e non per il non-admin', async ({ openTab }) => {
  const page = await openTab(URL);
  const chiuso = { ...BASE, _id: 'fb-c', seq: 902, name: 'Feed C', text: 'testo C', status: 'done', userNote: 'gia detta' };
  await prepara(page, [A({}), B({}), chiuso], 'queue', 'fb-a');
  await expect(page.locator('#mgUserNote')).toBeVisible();

  for (const t of ['inbox', 'queue', 'resolved', 'archived']) {
    await page.evaluate((x) => window.__mgTest.setTab(x), t);
    await page.evaluate(() => window.__mgTest.openDetail('fb-c'));
    await expect(page.locator('#mgUserNote')).toBeVisible();
    await expect(box(page)).toHaveValue('gia detta');
  }

  await page.evaluate(() => { window.__mgTest.setAdmin(false); window.__mgTest.openDetail('fb-c'); });
  await expect(page.locator('#mgUserNote')).toBeHidden();
});
