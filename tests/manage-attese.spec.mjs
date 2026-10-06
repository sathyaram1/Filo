// «ASPETTA #N» IN GESTIONE (#903).
//
// COSA DEVE ESSERE VERO
//   1. Dal dettaglio l'owner scrive «#12, #13»: il main riceve i numeri, la scheda mostra ciascuno col suo stato
//      (#12 in coda, #13 archiviato dopo la fusione) e la pratica passa fra quelli che «Aspettano», fuori da «In coda».
//   2. Si toglie dalla stessa scheda: la casella sparisce e la pratica torna In coda.
//   3. Un rifiuto del main (numero inesistente, giro) si legge con il suo motivo, e niente cambia.
//   4. Dal tasto destro sulla scheda si arriva alla casella, e si toglie tutto in un gesto.
//   5. «Non aspettare più» sotto il campo c'è solo con due attese o più: con una basta la sua ×.
//   6. Un gesto fatto mentre una scrittura è in volo parte dall'elenco già scritto, non da quello di prima.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const ID_DEL_NUMERO = { 12: 'f12', 13: 'f13' };

function fb(over = {}) {
  return Object.assign({
    _id: 'f903', name: 'La pratica che aspetta', text: 'Testo.', seq: 903, subSeq: 0,
    status: 'todo', statusPublic: 'open', clientId: 'owner:me', senderProof: 'admin',
    createdAt: '2026-10-01T07:00:00Z', images: [],
  }, over);
}
const LISTA = [
  fb(),
  fb({ _id: 'f12', seq: 12, name: 'Il primo', status: 'todo' }),
  fb({ _id: 'f13', seq: 13, name: 'Il secondo', status: 'archived', statusPublic: 'closed', resolvedInVersion: '0.2.230' }),
];

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((ids) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') {
        window.__updates.push(msg);
        if (msg.waitsFor === undefined) return { ok: true };
        const numeri = String(msg.waitsFor).split(/[\s,]+/).filter(Boolean).map((n) => n.replace('#', ''));
        const ignoto = numeri.find((n) => !ids[n]);
        if (ignoto) return { ok: false, error: `#${ignoto} non esiste` };
        return { ok: true, waitsFor: numeri.map((n) => ({ id: ids[n], num: n })) };
      }
      return orig(msg);
    };
  }, ID_DEL_NUMERO);
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, LISTA);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
}

const tabBtn = (page, tab) => page.locator(`.mg-tab[data-tab="${tab}"]`);

test('dal dettaglio: «aspetta #12, #13» si scrive, mostra lo stato di ciascuno, e si toglie', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (2)');
  await page.evaluate(() => window.__mgTest.openDetail('f903'));

  const toggle = page.locator('#mgAtteseToggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText('⏳ Aspetta');
  await expect(page.locator('#mgAttese')).toBeHidden();
  await toggle.click();
  await expect(page.locator('#mgAtteseInput')).toBeFocused();
  await page.locator('#mgAtteseInput').fill('#12, #13');
  await page.locator('#mgAtteseInput').press('Enter');

  await expect(page.locator('#mgManageMsg')).toContainText('aspetta #12, #13');
  expect(await page.evaluate(() => window.__updates)).toEqual([{ type: 'feedback_update', id: 'f903', waitsFor: '12, 13' }]);
  const chip = (n) => page.locator('#mgAtteseLista .mg-attesa', { hasText: `#${n}` });
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(2);
  await expect(chip(12)).toContainText('in coda');
  await expect(chip(13)).toContainText('fuso');
  await expect(chip(13)).toHaveClass(/mg-attesa--fuso/);
  await expect(toggle).toHaveText('⏳ Aspetta #12, #13');
  await expect(page.locator('#mgAtteseInput')).toHaveValue('');

  // Fuori da «In coda»: sta fra quelli che aspettano, col numero ancora aperto sulla scheda.
  await expect(tabBtn(page, 'waiting')).toHaveText('Aspettano (1)');
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (1)');
  await tabBtn(page, 'waiting').click();
  const riga = page.locator('.mg-item[data-id="f903"]');
  await expect(riga).toBeVisible();
  await expect(riga.locator('.mg-attesa-badge')).toHaveText('⏳ #12');
  await expect(riga.locator('.mg-attesa-badge')).toHaveAttribute('title', /#12 \(in coda\), #13 \(fuso\)/);

  // Se si può mettere si può togliere: una alla volta, dalla × di ciascuna.
  await page.evaluate(() => window.__mgTest.openDetail('f903'));
  await chip(12).locator('.mg-attesa-togli').click();
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(1);
  expect((await page.evaluate(() => window.__updates))[1]).toEqual({ type: 'feedback_update', id: 'f903', waitsFor: '13' });
  // Resta solo un aspettato già fuso: torna In coda.
  await expect(tabBtn(page, 'waiting')).toHaveText('Aspettano (0)');
  await chip(13).locator('.mg-attesa-togli').click();
  await expect(page.locator('#mgManageMsg')).toContainText('non aspetta più niente');
  await expect(page.locator('#mgAttese')).toBeHidden();
  await expect(toggle).toHaveText('⏳ Aspetta');
  expect((await page.evaluate(() => window.__updates))[2]).toEqual({ type: 'feedback_update', id: 'f903', waitsFor: '' });
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (2)');
});

test('un rifiuto del main si legge col suo motivo, e la pratica non cambia', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.openDetail('f903'));
  await page.locator('#mgAtteseToggle').click();
  await page.locator('#mgAtteseInput').fill('999');
  await page.locator('#mgAtteseAggiungi').click();
  await expect(page.locator('#mgManageMsg')).toHaveText('Attese non scritte: #999 non esiste');
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(0);
  await expect(page.locator('#mgAtteseInput')).toHaveValue('999');
  // Un numero storto non parte nemmeno.
  await page.locator('#mgAtteseInput').fill('12, abc');
  await page.locator('#mgAtteseAggiungi').click();
  await expect(page.locator('#mgManageMsg')).toContainText('«abc» non è un numero di feedback');
  expect((await page.evaluate(() => window.__updates)).length).toBe(1);
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (2)');
});

test('tasto destro sulla scheda: «Aspetta un altro feedback…» apre la casella, «Non aspettare più» toglie tutto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  const menu = page.locator('.mg-ctxmenu');
  await page.locator('.mg-item[data-id="f903"]').click({ button: 'right' });
  await expect(menu.locator('.sn-select-option', { hasText: 'Non aspettare più' })).toHaveCount(0);
  await menu.locator('.sn-select-option', { hasText: 'Aspetta un altro feedback' }).click();
  await expect(page.locator('#mgAtteseInput')).toBeFocused();
  await page.locator('#mgAtteseInput').fill('12');
  await page.locator('#mgAtteseInput').press('Enter');
  await expect(tabBtn(page, 'waiting')).toHaveText('Aspettano (1)');

  await tabBtn(page, 'waiting').click();
  await page.locator('.mg-item[data-id="f903"]').click({ button: 'right' });
  await menu.locator('.sn-select-option', { hasText: 'Non aspettare più' }).click();
  await expect(tabBtn(page, 'waiting')).toHaveText('Aspettano (0)');
  expect((await page.evaluate(() => window.__updates)).map((u) => u.waitsFor)).toEqual(['12', '']);
});

test('la pagina gemella dei feedback ha la stessa sezione, e la scheda dice cosa aspetta', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW && window.SN_FB_ATTESE);
  await page.evaluate((items) => window.__fbTest.setData(items), [
    fb({ waitsFor: [{ id: 'f12', num: '12' }, { id: 'f13', num: '13' }] }), ...LISTA.slice(1),
  ]);
  await expect(page.locator('#tabs [data-tab="waiting"]')).toHaveText('Aspettano (1)');
  await expect(page.locator('#tabs [data-tab="queue"]')).toHaveText('In coda (1)');
  await page.locator('#tabs [data-tab="waiting"]').click();
  await expect(page.locator('.fb-card[data-id="f903"] .fb-attesa')).toHaveText('⏳ aspetta #12 non ancora fuso, #13 fuso');
});

test('«Non aspettare più» sotto il campo solo con due attese o più', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.openDetail('f903'));
  await page.locator('#mgAtteseToggle').click();
  await expect(page.locator('#mgAtteseInput')).toBeVisible();
  const tutte = page.locator('#mgAtteseTogliTutte');
  await expect(tutte).toBeHidden();
  await page.locator('#mgAtteseInput').fill('12');
  await page.locator('#mgAtteseInput').press('Enter');
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(1);
  await expect(tutte).toBeHidden();
  await page.locator('#mgAtteseInput').fill('13');
  await page.locator('#mgAtteseInput').press('Enter');
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(2);
  await expect(tutte).toBeVisible();
});

test('un gesto mentre una scrittura è in volo non cancella quella prima', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  // Il main risponde dopo un po', come con la rete vera.
  await page.evaluate(() => {
    const prima = window.filo.message;
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') await new Promise((r) => setTimeout(r, 1200));
      return prima(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.openDetail('f903'));
  await page.locator('#mgAtteseToggle').click();
  const campo = page.locator('#mgAtteseInput');
  await campo.fill('12');
  await campo.press('Enter');
  await expect(campo).toHaveValue('');
  await campo.fill('13');
  await campo.press('Enter');
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(2, { timeout: 10000 });
  expect((await page.evaluate(() => window.__updates)).map((u) => u.waitsFor)).toEqual(['12', '12, 13']);

  // La × premuta mentre un'aggiunta è in volo toglie solo la sua.
  await page.locator('#mgAtteseLista .mg-attesa', { hasText: '#13' }).locator('.mg-attesa-togli').click();
  await campo.fill('13');
  await campo.press('Enter');
  await page.locator('#mgAtteseLista .mg-attesa', { hasText: '#12' }).locator('.mg-attesa-togli').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length), { timeout: 10000 }).toBe(5);
  expect((await page.evaluate(() => window.__updates)).slice(2).map((u) => u.waitsFor)).toEqual(['12', '12, 13', '13']);
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(1);
  await expect(page.locator('#mgAtteseLista')).toContainText('#13');
});

test('coi numeri il tasto delle attese non allunga la fila dei tasti; con uno solo si legge intero', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  const sfora = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el.scrollWidth - el.clientWidth; }, sel);
  const larghezza = () => page.evaluate(() => document.getElementById('mgAtteseToggle').getBoundingClientRect().width);
  const altri = [12, 13, 14].map((n) => fb({ _id: `f${n}`, seq: n, name: `Il ${n}` }));
  await page.evaluate((l) => window.__mgTest.setData(l), [
    fb({ waitsFor: [{ id: 'f12', num: '663.2' }] }),
    fb({ _id: 'f904', seq: 904, waitsFor: altri.map((a) => ({ id: a._id, num: `${a.seq}0663.2` })) }),
    ...altri,
  ]);
  await page.evaluate(() => window.__mgTest.openDetail('f903'));
  await expect(page.locator('#mgAtteseToggle')).toHaveText('⏳ Aspetta #663.2');
  expect(await sfora('#mgAtteseToggle')).toBeLessThanOrEqual(1);
  const uno = await larghezza();

  await page.evaluate(() => window.__mgTest.openDetail('f904'));
  await expect(page.locator('#mgAtteseLista .mg-attesa')).toHaveCount(3);
  expect(await larghezza()).toBeLessThanOrEqual(uno + 40);
  await expect(page.locator('#mgAtteseToggle')).toHaveAttribute('title', /#140663\.2/);
  await page.screenshot({ path: 'tests/.shots/aspetta-tre-numeri.png' });
});
