// DIAGNOSTICA TEMPORANEA (da cancellare): registra passo per passo cosa vede
// l'owner e cosa parte davvero, nel caso "svuoto la frase subito dopo averla
// salvata".
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const mk = (id, seq, userNote) => ({
  _id: id, seq, subSeq: 0, name: 'Feedback ' + id, text: 'testo ' + id,
  clientId: 'tester@example.com', createdAt: '2026-08-18T10:00:00Z', images: [], userNote,
});

async function prepara(page, data) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__sent = [];
    window.__pend = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = (msg) => {
      if (msg && msg.type === 'feedback_update' && Object.prototype.hasOwnProperty.call(msg, 'userNote')) {
        window.__sent.push({ id: msg.id, userNote: msg.userNote });
        return new Promise((resolve) => { window.__pend.push({ resolve }); });
      }
      return orig(msg);
    };
    window.__ok = (i) => window.__pend[i].resolve({ ok: true });
  });
  await page.evaluate((d) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(d);
    window.__mgTest.setTab('inbox');
  }, data);
}

const stato = (page) => page.evaluate(() => ({
  casella: document.getElementById('mgUserNoteText').value,
  messaggio: document.getElementById('mgUserNoteMsg').textContent,
  partiti: window.__sent.map((s) => s.id + '=' + JSON.stringify(s.userNote)),
}));

test('svuotamento subito dopo il salvataggio: passo per passo', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [mk('fb-a', 900, ''), mk('fb-b', 901, '')]);
  await page.evaluate(() => window.__mgTest.openDetail('fb-a'));

  const log = [];
  await page.locator('#mgUserNoteText').fill('ci ho lavorato, riprova');
  await page.locator('#mgUserNoteText').press('Enter');
  await page.waitForTimeout(200);
  log.push(['1. dopo il primo invio', await stato(page)]);

  await page.locator('#mgUserNoteText').fill('');
  await page.locator('#mgUserNoteText').press('Enter');
  await page.waitForTimeout(200);
  log.push(['2. svuotata e reinviata', await stato(page)]);

  await page.evaluate(() => window.__ok(0));
  await page.waitForTimeout(250);
  log.push(['3. risposta del primo invio', await stato(page)]);

  await page.evaluate(() => window.__mgTest.openDetail('fb-b'));
  await page.evaluate(() => window.__mgTest.openDetail('fb-a'));
  log.push(['4. esce e rientra', await stato(page)]);

  console.log('\n===== SVUOTAMENTO =====\n' + JSON.stringify(log, null, 1) + '\n');

  // stesso giro, ma il secondo invio riporta il testo PRECEDENTE (non vuoto)
  await page.evaluate(() => { window.__sent = []; window.__pend = []; });
  await page.evaluate(() => window.__mgTest.setData([
    { _id: 'fb-c', seq: 902, subSeq: 0, name: 'C', text: 't', clientId: 'x@y.z', createdAt: '2026-08-18T10:00:00Z', images: [], userNote: 'frase precedente' },
  ]));
  await page.evaluate(() => window.__mgTest.openDetail('fb-c'));
  const log2 = [];
  await page.locator('#mgUserNoteText').fill('nuova frase');
  await page.locator('#mgUserNoteText').press('Enter');
  await page.waitForTimeout(200);
  log2.push(['1. inviata la nuova', await stato(page)]);
  await page.locator('#mgUserNoteText').fill('frase precedente');
  await page.locator('#mgUserNoteText').press('Enter');
  await page.waitForTimeout(200);
  log2.push(['2. ripensamento: rimette la precedente', await stato(page)]);
  await page.evaluate(() => window.__ok(0));
  await page.waitForTimeout(250);
  log2.push(['3. risposta del primo invio', await stato(page)]);
  await page.evaluate(() => window.__mgTest.openDetail('fb-c'));
  log2.push(['4. riapre', await stato(page)]);
  console.log('\n===== RIPENSAMENTO =====\n' + JSON.stringify(log2, null, 1) + '\n');

  expect(true).toBe(true);
});
