// SPEC TEMPORANEA DI VERIFICA INDIPENDENTE — travaso fra feedback della
// "frase per chi ha segnalato". Da cancellare a fine verifica.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fb(id, seq, text, userNote, extra) {
  return Object.assign({
    _id: id, name: `Titolo ${id}`, text, seq, subSeq: 0,
    status: 'done', userNote: userNote || '',
    clientId: `t${seq}@example.com`, createdAt: `2026-06-0${seq}T10:00:00Z`,
    images: [], notes: '',
  }, extra || {});
}

const FBS = [
  fb('AAA', 1, 'TESTO-DEL-PRIMO', 'frase-iniziale-A'),
  fb('BBB', 2, 'TESTO-DEL-SECONDO', 'frase-iniziale-B'),
  fb('CCC', 3, 'TESTO-DEL-TERZO', ''),
];

// Installa un canale finto verso il main: registra ogni feedback_update e
// risponde con la latenza voluta. Tutto il resto passa all'originale.
async function stubChannel(page) {
  await page.evaluate(() => {
    const orig = window.filo && window.filo.message ? window.filo.message.bind(window.filo) : null;
    window.__sent = [];
    window.__lat = { ms: 0, fail: null };   // fail: id che deve fallire
    window.filo = window.filo || {};
    window.filo.message = (msg) => {
      if (!msg || msg.type !== 'feedback_update') {
        return orig ? orig(msg) : Promise.resolve({ ok: true });
      }
      window.__sent.push(JSON.parse(JSON.stringify(msg)));
      const ms = window.__lat.ms;
      const shouldFail = window.__lat.fail && window.__lat.fail === msg.id;
      return new Promise((res) => setTimeout(() => {
        res(shouldFail ? { ok: false, error: 'ERRORE-DEL-SERVER' } : { ok: true });
      }, ms));
    };
  });
}

async function boot(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest);
  await stubChannel(page);
  await page.evaluate((fbs) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(fbs);
    window.__mgTest.setTab('resolved');
  }, FBS);
  return page;
}

const box = '#mgUserNoteText';
const btn = '#mgUserNoteBtn';
const msg = '#mgUserNoteMsg';

// Salva bypassando il bottone disabilitato (Enter chiama lo stesso codice):
// serve per i salvataggi in rapida successione.
async function saveViaEnter(page, text) {
  await page.fill(box, text);
  await page.locator(box).press('Enter');
}

for (const ms of [100, 400, 2000]) {
  test(`travaso: risposta a ${ms}ms non deve riscrivere il pannello di un altro feedback`, async ({ openTab }) => {
    const page = await boot(openTab);
    await page.evaluate((m) => { window.__lat.ms = m; }, ms);

    await page.evaluate(() => window.__mgTest.openDetail('AAA'));
    await saveViaEnter(page, 'MESSAGGIO-PER-A');
    // subito su un altro feedback, prima che la risposta atterri
    await page.evaluate(() => window.__mgTest.openDetail('BBB'));
    await expect(page.locator(box)).toHaveValue('frase-iniziale-B');

    await page.waitForTimeout(ms + 600);

    // la casella deve ancora mostrare la frase di B, non quella di A
    await expect(page.locator(box)).toHaveValue('frase-iniziale-B');
    // la conversazione deve essere quella di B
    await expect(page.locator('#mgThread')).toContainText('TESTO-DEL-SECONDO');
    await expect(page.locator('#mgThread')).not.toContainText('TESTO-DEL-PRIMO');
    // nessun "Salvata" appiccicato al feedback sbagliato
    await expect(page.locator(msg)).toHaveText('');

    // il salvataggio successivo deve andare su B con la frase di B
    await saveViaEnter(page, 'MESSAGGIO-PER-B');
    await page.waitForTimeout(ms + 600);
    const sent = await page.evaluate(() => window.__sent);
    expect(sent).toEqual([
      { type: 'feedback_update', id: 'AAA', userNote: 'MESSAGGIO-PER-A' },
      { type: 'feedback_update', id: 'BBB', userNote: 'MESSAGGIO-PER-B' },
    ]);

    // tornando su A la frase deve essere quella giusta E salvata davvero
    await page.evaluate(() => window.__mgTest.openDetail('AAA'));
    await expect(page.locator(box)).toHaveValue('MESSAGGIO-PER-A');
    await expect(page.locator('#mgThread')).toContainText('TESTO-DEL-PRIMO');
    // e non deve ripartire un salvataggio identico
    await saveViaEnter(page, 'MESSAGGIO-PER-A');
    await expect(page.locator(msg)).toHaveText('Nessuna modifica');
  });
}

test('salvataggi in rapida successione su feedback diversi: ciascuno finisce sul suo documento', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.evaluate(() => { window.__lat.ms = 700; });

  await page.evaluate(() => window.__mgTest.openDetail('AAA'));
  await saveViaEnter(page, 'PER-A');
  await page.evaluate(() => window.__mgTest.openDetail('BBB'));
  await saveViaEnter(page, 'PER-B');
  await page.evaluate(() => window.__mgTest.openDetail('CCC'));
  await saveViaEnter(page, 'PER-C');

  await page.waitForTimeout(2500);
  const sent = await page.evaluate(() => window.__sent);
  expect(sent).toEqual([
    { type: 'feedback_update', id: 'AAA', userNote: 'PER-A' },
    { type: 'feedback_update', id: 'BBB', userNote: 'PER-B' },
    { type: 'feedback_update', id: 'CCC', userNote: 'PER-C' },
  ]);
  // ognuno rilegge la propria
  for (const [id, v, t] of [['AAA', 'PER-A', 'TESTO-DEL-PRIMO'], ['BBB', 'PER-B', 'TESTO-DEL-SECONDO'], ['CCC', 'PER-C', 'TESTO-DEL-TERZO']]) {
    await page.evaluate((x) => window.__mgTest.openDetail(x), id);
    await expect(page.locator(box)).toHaveValue(v);
    await expect(page.locator('#mgThread')).toContainText(t);
  }
});

test('la risposta che atterra mentre l\'owner sta scrivendo su un altro feedback non cancella quello che sta scrivendo', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.evaluate(() => { window.__lat.ms = 900; });

  await page.evaluate(() => window.__mgTest.openDetail('AAA'));
  await saveViaEnter(page, 'PER-A');
  await page.evaluate(() => window.__mgTest.openDetail('CCC'));
  await page.locator(box).click();
  await page.keyboard.type('sto-scrivendo-su-C');
  await page.waitForTimeout(1400);   // la risposta di A atterra qui
  await expect(page.locator(box)).toHaveValue('sto-scrivendo-su-C');
  await expect(page.locator('#mgThread')).toContainText('TESTO-DEL-TERZO');
});

test('errore del server in ritardo: non compare sul feedback sbagliato', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.evaluate(() => { window.__lat.ms = 800; window.__lat.fail = 'AAA'; });

  await page.evaluate(() => window.__mgTest.openDetail('AAA'));
  await saveViaEnter(page, 'PER-A-CHE-FALLISCE');
  await page.evaluate(() => window.__mgTest.openDetail('BBB'));
  await page.waitForTimeout(1400);
  await expect(page.locator(msg)).toHaveText('');
  await expect(page.locator(box)).toHaveValue('frase-iniziale-B');

  // ma su A l'errore si deve poter vedere quando resta selezionato
  await page.evaluate(() => window.__mgTest.openDetail('AAA'));
  await saveViaEnter(page, 'ANCORA-A');
  await page.waitForTimeout(1400);
  await expect(page.locator(msg)).toHaveText('ERRORE-DEL-SERVER');
  // e la frase NON deve risultare salvata in locale
  await page.evaluate(() => window.__mgTest.openDetail('BBB'));
  await page.evaluate(() => window.__mgTest.openDetail('AAA'));
  await expect(page.locator(box)).toHaveValue('frase-iniziale-A');
});

test('salvataggio seguito da cambio scheda o da ricerca: nessun travaso', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.evaluate(() => { window.__lat.ms = 700; });

  // cambio scheda durante l'attesa
  await page.evaluate(() => window.__mgTest.openDetail('AAA'));
  await saveViaEnter(page, 'PER-A-TAB');
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.waitForTimeout(1200);
  // il pannello di dettaglio resta chiuso: nessuna frase riapparsa dal nulla
  await expect(page.locator('#mgDetail')).toBeHidden();
  await expect(page.locator('#mgUserNote')).toBeHidden();

  // la frase è comunque stata salvata davvero
  await page.evaluate(() => window.__mgTest.setTab('resolved'));
  await page.evaluate(() => window.__mgTest.openDetail('AAA'));
  await expect(page.locator(box)).toHaveValue('PER-A-TAB');

  // deselezione durante l'attesa (setTab azzera la selezione) + ricerca
  await saveViaEnter(page, 'PER-A-DUE');
  await page.evaluate(() => window.__mgTest.setTab('resolved'));
  await page.evaluate(() => window.__mgTest.openDetail('BBB'));
  await page.waitForTimeout(1200);
  await expect(page.locator(box)).toHaveValue('frase-iniziale-B');
  const sent = await page.evaluate(() => window.__sent.map((m) => `${m.id}:${m.userNote}`));
  expect(sent).toEqual(['AAA:PER-A-TAB', 'AAA:PER-A-DUE']);
  await page.evaluate(() => window.__mgTest.openDetail('AAA'));
  await expect(page.locator(box)).toHaveValue('PER-A-DUE');
});

// ── Gli ALTRI comandi asincroni del pannello ────────────────────────────────
test('preferito: la risposta in ritardo non ridipinge il pannello di un altro feedback', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.evaluate(() => { window.__lat.ms = 800; });

  await page.evaluate(() => window.__mgTest.openDetail('AAA'));
  await page.click('#mgStarBtn');
  await page.evaluate(() => window.__mgTest.openDetail('BBB'));
  await page.waitForTimeout(1400);
  // B non è preferito: il bottone deve dirlo
  await expect(page.locator('#mgStarBtn')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mgManageMsg')).toHaveText('');
  // ma su A la stella è davvero stata messa
  await page.evaluate(() => window.__mgTest.openDetail('AAA'));
  await expect(page.locator('#mgStarBtn')).toHaveAttribute('aria-pressed', 'true');
});

test('archivia: la risposta in ritardo non deve chiudere il dettaglio di un ALTRO feedback', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.evaluate(() => { window.__lat.ms = 800; });

  await page.evaluate(() => window.__mgTest.openDetail('AAA'));
  await page.click('#mgArchiveBtn');
  await page.evaluate(() => window.__mgTest.openDetail('BBB'));
  await page.waitForTimeout(1400);
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgThread')).toContainText('TESTO-DEL-SECONDO');
  await expect(page.locator(box)).toHaveValue('frase-iniziale-B');
});

test('errore in ritardo su preferito/archivia: non compare sul feedback sbagliato', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.evaluate(() => { window.__lat.ms = 800; window.__lat.fail = 'AAA'; });

  await page.evaluate(() => window.__mgTest.openDetail('AAA'));
  await page.click('#mgStarBtn');
  await page.evaluate(() => window.__mgTest.openDetail('BBB'));
  await page.waitForTimeout(1400);
  await expect(page.locator('#mgManageMsg')).toHaveText('');
});

test('risposta ai chiarimenti: risposta in ritardo non chiude/ridipinge un altro feedback', async ({ openTab }) => {
  const page = await boot(openTab);
  await page.evaluate(() => {
    window.__lat.ms = 800;
    window.__mgTest.setData([
      Object.assign({}, { _id: 'CLA', name: 'Chiarimento', text: 'TESTO-CHIARIMENTO', seq: 9, subSeq: 0,
        status: 'clarify', clientId: 'c@example.com', createdAt: '2026-06-09T10:00:00Z', images: [], notes: '', userNote: '' }),
      Object.assign({}, { _id: 'BBB', name: 'Secondo', text: 'TESTO-DEL-SECONDO', seq: 2, subSeq: 0,
        status: 'done', clientId: 'b@example.com', createdAt: '2026-06-02T10:00:00Z', images: [], notes: '', userNote: 'frase-iniziale-B' }),
    ]);
  });
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.evaluate(() => window.__mgTest.openDetail('CLA'));
  const clarifyVisible = await page.locator('#mgClarify').isVisible();
  test.skip(!clarifyVisible, 'il feedback finto non finisce in stato chiarimento');
  await page.fill('#mgClarifyText', 'risposta owner');
  await page.click('#mgClarifyBtn');
  await page.evaluate(() => window.__mgTest.setTab('resolved'));
  await page.evaluate(() => window.__mgTest.openDetail('BBB'));
  await page.waitForTimeout(1400);
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgThread')).toContainText('TESTO-DEL-SECONDO');
});
