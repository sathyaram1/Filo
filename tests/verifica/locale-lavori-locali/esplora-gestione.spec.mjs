// Verifica locale «lavori locali»: la Gestione vista dall'owner, con Firestore finto.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const SHOTS = process.env.VERIF_SHOTS || '';

function fb(id, seq, status, extra = {}) {
  return {
    _id: id, _updateTime: 'v1', seq, subSeq: 0, name: `Segnalazione ${seq}`, text: `Testo ${seq}`,
    status, statusPublic: 'open', clientId: 'tester@example.com',
    createdAt: new Date(Date.UTC(2026, 8, 30) + seq * 60e3).toISOString(), images: [], ...extra,
  };
}
const DOCS = [
  fb('loc', 950, 'todo', { clientId: 'local:claude', senderProof: 'admin', localOnly: { by: 'local:claude', at: Date.UTC(2026, 8, 30) }, name: 'Lavoro della sessione' }),
  fb('own', 951, 'todo', { clientId: 'owner:abc', senderProof: 'admin', name: 'Segnalazione dell’owner dall’app' }),
  fb('usr', 952, 'todo', { clientId: 'anon-123', name: 'Segnalazione di un utente' }),
  fb('old', 953, 'todo', { clientId: 'local:claude', name: 'Aperto da una sessione prima della prova' }),
  fb('rcv', 954, 'design', { clientId: 'anon-456', statusReason: 'locale', notes: 'Richiede lavoro locale. tocca le regole', name: 'Utente: serve lavoro locale' }),
];

async function apri(openTab) {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((docs) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        return { ok: true, by: 'owner@example.com', at: Date.now() };
      }
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs.map((d) => ({ ...d })));
  }, DOCS);
  return page;
}
const ids = (page) => page.locator('#mgList .mg-item').evaluateAll((els) => els.map((e) => e.dataset.id));
const conta = (page, tab) => page.locator(`.mg-tab[data-tab="${tab}"] .mg-tab-count`).textContent();

test('lavori locali: dove stanno, cosa offre il dettaglio', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => window.__mgTest.setTab('local'));
  const inLocale = await ids(page);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  const inCoda = await ids(page);
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  const inRicevuti = await ids(page);
  const riga = await page.locator('.mg-item[data-id="rcv"]').innerText();
  console.log('LOCALE', inLocale, 'CODA', inCoda, 'RICEVUTI', inRicevuti, 'conteggi', await conta(page, 'local'), await conta(page, 'queue'), await conta(page, 'inbox'));
  console.log('RIGA RICEVUTO', JSON.stringify(riga));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ricevuti.png` });

  const dettaglio = async (id, tab) => {
    await page.evaluate(({ id, tab }) => { window.__mgTest.setTab(tab); window.__mgTest.openDetail(id); }, { id, tab });
    await page.waitForTimeout(300);
    const btnLocale = page.locator('#mgLocalBtn');
    const btnPre = page.locator('#mgPreapproveBtn');
    const info = {
      locale: (await btnLocale.count()) ? { visibile: await btnLocale.isVisible(), testo: await btnLocale.textContent(), title: await btnLocale.getAttribute('title') } : 'assente',
      pre: (await btnPre.count()) ? { visibile: await btnPre.isVisible(), testo: await btnPre.textContent(), title: await btnPre.getAttribute('title') } : 'assente',
      segno: await page.locator('.mg-local-sign, .mg-localsign, [class*="local"]').allInnerTexts().catch(() => []),
    };
    console.log('DETTAGLIO', id, JSON.stringify(info));
    return info;
  };
  await dettaglio('loc', 'local');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dettaglio-locale.png` });
  await page.emulateMedia({ colorScheme: 'dark' });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dettaglio-locale-scuro.png` });
  await page.emulateMedia({ colorScheme: 'light' });
  await dettaglio('own', 'queue');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dettaglio-owner.png` });
  await dettaglio('usr', 'queue');
  await dettaglio('old', 'queue');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dettaglio-vecchio-locale.png` });
  const iconaVecchio = await page.locator('.mg-item[data-id="old"]').innerText();
  console.log('RIGA VECCHIO', JSON.stringify(iconaVecchio));

  // Il tasto 💻 sul feedback dell'owner: parte il segno e la pratica passa nei Lavori locali.
  await page.evaluate(() => { window.__mgTest.setTab('queue'); window.__mgTest.openDetail('own'); });
  await page.locator('#mgLocalBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  console.log('UPDATE', JSON.stringify(await page.evaluate(() => window.__updates)));
  console.log('MSG', await page.locator('#mgManageMsg, .mg-manage-msg, #mgMsg').allInnerTexts().catch(() => []));
  await page.evaluate(() => window.__mgTest.setTab('local'));
  console.log('LOCALE DOPO', await ids(page), await conta(page, 'local'));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dopo-segno.png` });
});

test('le schede della Gestione a 360 punti non fanno scorrere la pagina di lato', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(300);
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  console.log('GESTIONE 360', JSON.stringify(o));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/gestione-360.png` });
});

test('la pagina dei feedback: le cinque schede a 360 punti', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined' && window.__fbTest);
  await page.evaluate((docs) => {
    SN_FEEDBACK.list = async () => [];
    window.__fbTest.setAdmin(true, { email: 'owner@example.com' });
    window.__fbTest.setData(docs.map((d) => ({ ...d })));
  }, DOCS);
  const nomi = await page.locator('.fb-tab').allInnerTexts();
  console.log('SCHEDE FEEDBACK', JSON.stringify(nomi));
  await page.evaluate(() => window.__fbTest.setTab && window.__fbTest.setTab('local'));
  await page.waitForTimeout(300);
  console.log('CARTE LOCALI', await page.locator('.fb-card').count());
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(300);
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  console.log('FEEDBACK 360', JSON.stringify(o));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/feedback-360.png` });
});
