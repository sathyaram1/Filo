// VERIFICA INDIPENDENTE (temporanea) — frase per il mittente, dashboard di
// gestione. Costruita da zero: stubba il canale verso il main per poter
// decidere ESITO e ORDINE di ogni scrittura, e guarda cosa parte davvero.
//
// Il punto sotto esame: quando due salvataggi sullo stesso feedback si
// accavallano e il PRIMO riesce mentre il SECONDO fallisce, a destinazione
// c'e' un testo che la pagina non conosce. Da li' un salvataggio successivo
// NON deve essere scartato come "Nessuna modifica".

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const FBS = [
  {
    _id: 'fb-a', name: 'Alfa', text: 'testo alfa', seq: 900, subSeq: 0,
    status: 'new', clientId: 'tester@example.com',
    createdAt: '2026-06-01T10:00:00Z', images: [], userNote: 'V0',
  },
  {
    _id: 'fb-b', name: 'Beta', text: 'testo beta', seq: 901, subSeq: 0,
    status: 'done', clientId: 'altro@example.com',
    createdAt: '2026-06-02T10:00:00Z', images: [], userNote: 'W0',
  },
];

async function boot(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  // Il caricamento VERO da Firestore deve essere finito, o sovrascrive i finti.
  await page.evaluate(() => window.__mgTest.whenReady());

  // Canale stubbato: ogni feedback_update viene registrato e lasciato appeso
  // finche' il test non decide come farlo finire.
  await page.evaluate(() => {
    window.__upd = [];
    window.__res = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = (msg) => {
      if (msg && msg.type === 'feedback_update') {
        const i = window.__upd.length;
        window.__upd.push({ id: msg.id, userNote: msg.userNote });
        return new Promise((resolve, reject) => { window.__res[i] = { resolve, reject }; });
      }
      return orig(msg);
    };
    window.__settle = (i, ok) => {
      const r = window.__res[i];
      if (!r) throw new Error('nessuna scrittura #' + i);
      if (ok) r.resolve({ ok: true }); else r.reject(new Error('rete giu'));
    };
  });

  await page.evaluate((fbs) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(JSON.parse(JSON.stringify(fbs)));
  }, FBS);
  return page;
}

const open  = (page, id) => page.evaluate((i) => window.__mgTest.openDetail(i), id);
const sent  = (page) => page.evaluate(() => window.__upd.map((u) => `${u.id}:${u.userNote}`));
const settle = (page, i, ok) => page.evaluate(([j, o]) => window.__settle(j, o), [i, ok]);
const msg   = (page) => page.locator('#mgUserNoteMsg').textContent();
const box   = (page) => page.locator('#mgUserNoteText').inputValue();

// Scrive nella casella e conferma con Invio (unica strada per accavallare due
// salvataggi sullo stesso feedback: il bottone si spegne mentre e' in volo).
async function saveEnter(page, text) {
  await page.fill('#mgUserNoteText', text);
  await page.locator('#mgUserNoteText').press('Enter');
}
async function saveBtn(page, text) {
  await page.fill('#mgUserNoteText', text);
  await page.locator('#mgUserNoteBtn').click();
}

// Attende che il numero di scritture partite raggiunga n (o fallisce).
async function waitSent(page, n) {
  await page.waitForFunction((k) => window.__upd.length === k, n, { timeout: 3000 });
}

test('caso base: risalvare lo STESSO testo a bocce ferme non spedisce niente', async ({ openTab }) => {
  const page = await boot(openTab);
  await open(page, 'fb-a');
  expect(await box(page)).toBe('V0');
  await saveBtn(page, 'V0');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Nessuna modifica');
  expect(await sent(page)).toEqual([]);

  // E un testo nuovo invece parte, e dopo il successo torna a fare "no-op".
  await saveBtn(page, 'V1');
  await waitSent(page, 1);
  await settle(page, 0, true);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  await saveBtn(page, 'V1');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Nessuna modifica');
  expect(await sent(page)).toEqual(['fb-a:V1']);
});

test('PRIMO riesce, SECONDO fallisce: da li in poi ogni salvataggio parte comunque', async ({ openTab }) => {
  const page = await boot(openTab);
  await open(page, 'fb-a');

  await saveEnter(page, 'A1');
  await waitSent(page, 1);
  await saveEnter(page, 'A2');
  await waitSent(page, 2);

  await settle(page, 0, true);   // A1 arriva a destinazione
  await settle(page, 1, false);  // A2 no  → a destinazione c'e' A1, ma la pagina non lo sa
  await expect(page.locator('#mgUserNoteMsg')).toHaveClass(/mg-err/);

  // 1) stesso testo che la pagina RICORDA (V0): deve partire.
  await saveBtn(page, 'V0');
  await waitSent(page, 3);
  await settle(page, 2, false);  // fallisce di nuovo: restiamo nell'ignoto

  // 2) stesso testo dell'ULTIMO spedito (A2): deve partire.
  await saveBtn(page, 'A2');
  await waitSent(page, 4);
  await settle(page, 3, false);

  // 3) il testo che e' DAVVERO a destinazione (A1): deve partire lo stesso.
  await saveBtn(page, 'A1');
  await waitSent(page, 5);
  await settle(page, 4, true);

  expect(await sent(page)).toEqual([
    'fb-a:A1', 'fb-a:A2', 'fb-a:V0', 'fb-a:A2', 'fb-a:A1',
  ]);
  // Ora la pagina sa di nuovo cosa c'e' a destinazione: no-op legittimo.
  await saveBtn(page, 'A1');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Nessuna modifica');
  expect((await sent(page)).length).toBe(5);
});

test('PRIMO riesce, SECONDO fallisce (esiti in ordine inverso): stesso risultato', async ({ openTab }) => {
  const page = await boot(openTab);
  await open(page, 'fb-a');
  await saveEnter(page, 'A1');
  await waitSent(page, 1);
  await saveEnter(page, 'A2');
  await waitSent(page, 2);
  await settle(page, 1, false);  // prima il fallimento del secondo
  await settle(page, 0, true);   // poi il successo del primo (risposta superata)
  await expect(page.locator('#mgUserNoteMsg')).toHaveClass(/mg-err/);

  await saveBtn(page, 'V0');
  await waitSent(page, 3);
  expect(await sent(page)).toEqual(['fb-a:A1', 'fb-a:A2', 'fb-a:V0']);
});

test('PRIMO fallisce, SECONDO riesce: nessuna ambiguita, il no-op resta legittimo', async ({ openTab }) => {
  const page = await boot(openTab);
  await open(page, 'fb-a');
  await saveEnter(page, 'A1');
  await waitSent(page, 1);
  await saveEnter(page, 'A2');
  await waitSent(page, 2);
  await settle(page, 0, false);  // il vecchio fallisce: e' superato, non conta
  await settle(page, 1, true);   // il nuovo arriva → destinazione = A2
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  expect(await box(page)).toBe('A2');

  await saveBtn(page, 'A2');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Nessuna modifica');
  expect(await sent(page)).toEqual(['fb-a:A1', 'fb-a:A2']);

  // e rientrando trova quello che ha salvato
  await open(page, 'fb-b');
  await open(page, 'fb-a');
  expect(await box(page)).toBe('A2');
});

test('SECONDO riesce prima, PRIMO fallisce dopo: destinazione nota, no-op legittimo', async ({ openTab }) => {
  const page = await boot(openTab);
  await open(page, 'fb-a');
  await saveEnter(page, 'A1');
  await waitSent(page, 1);
  await saveEnter(page, 'A2');
  await waitSent(page, 2);
  await settle(page, 1, true);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  await settle(page, 0, false);
  await page.waitForTimeout(200);
  // Il fallimento superato non deve sporcare la schermata ne' il dato.
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  await saveBtn(page, 'A2');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Nessuna modifica');
  expect(await sent(page)).toEqual(['fb-a:A1', 'fb-a:A2']);
});

test('TRE invii con fallimenti in mezzo', async ({ openTab }) => {
  const page = await boot(openTab);
  await open(page, 'fb-a');
  await saveEnter(page, 'A1'); await waitSent(page, 1);
  await saveEnter(page, 'A2'); await waitSent(page, 2);
  await saveEnter(page, 'A3'); await waitSent(page, 3);

  // A1 ok, A2 ko, A3 ok → l'ultimo spedito e' arrivato: destinazione nota.
  await settle(page, 0, true);
  await settle(page, 1, false);
  await settle(page, 2, true);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  await saveBtn(page, 'A3');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Nessuna modifica');
  expect((await sent(page)).length).toBe(3);

  // Ora: due nuovi invii, l'ULTIMO fallisce → di nuovo ignoto.
  await saveEnter(page, 'A4'); await waitSent(page, 4);
  await saveEnter(page, 'A5'); await waitSent(page, 5);
  await settle(page, 3, true);
  await settle(page, 4, false);
  await saveBtn(page, 'A3');   // testo vecchio, diverso da tutto: deve partire
  await waitSent(page, 6);
  // (il precedente e' ancora in volo: il bottone e' spento, si usa Invio)
  await saveEnter(page, 'A5');  // e anche l'ultimo spedito, se ritentato
  await waitSent(page, 7);
  expect(await sent(page)).toEqual([
    'fb-a:A1', 'fb-a:A2', 'fb-a:A3', 'fb-a:A4', 'fb-a:A5', 'fb-a:A3', 'fb-a:A5',
  ]);
});

test('fallimento mentre si guarda un ALTRO feedback, poi si rientra', async ({ openTab }) => {
  const page = await boot(openTab);
  await open(page, 'fb-a');
  await saveEnter(page, 'A1'); await waitSent(page, 1);
  await saveEnter(page, 'A2'); await waitSent(page, 2);
  await open(page, 'fb-b');                     // si passa ad un altro
  await settle(page, 0, true);
  await settle(page, 1, false);
  await page.waitForTimeout(200);
  // Nessuna contaminazione sul feedback che si sta guardando.
  expect(await box(page)).toBe('W0');
  expect(await msg(page)).toBe('');

  await open(page, 'fb-a');
  expect(await box(page)).toBe('V0');           // ridipinge il valore vecchio
  await saveBtn(page, 'V0');                    // che pero' NON e' cio' che c'e' la'
  await waitSent(page, 3);
  expect(await sent(page)).toEqual(['fb-a:A1', 'fb-a:A2', 'fb-a:V0']);
});

test('fallimento, poi uscita e rientro, poi correzione del testo', async ({ openTab }) => {
  const page = await boot(openTab);
  await open(page, 'fb-a');
  await saveEnter(page, 'A1'); await waitSent(page, 1);
  await saveEnter(page, 'A2'); await waitSent(page, 2);
  await settle(page, 0, true);
  await settle(page, 1, false);
  await open(page, 'fb-b');
  await open(page, 'fb-a');
  await saveBtn(page, 'A9');                    // testo corretto
  await waitSent(page, 3);
  await settle(page, 2, true);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  await open(page, 'fb-b');
  await open(page, 'fb-a');
  expect(await box(page)).toBe('A9');
  expect(await sent(page)).toEqual(['fb-a:A1', 'fb-a:A2', 'fb-a:A9']);
});

test('due fallimenti di fila, poi ritentativo con la STESSA identica frase', async ({ openTab }) => {
  const page = await boot(openTab);
  await open(page, 'fb-a');
  await saveBtn(page, 'A1'); await waitSent(page, 1);
  await settle(page, 0, false);
  await expect(page.locator('#mgUserNoteMsg')).toHaveClass(/mg-err/);
  // stessa frase, ritentata: deve ripartire
  await saveBtn(page, 'A1'); await waitSent(page, 2);
  await settle(page, 1, false);
  await saveBtn(page, 'A1'); await waitSent(page, 3);
  await settle(page, 2, true);
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  expect(await sent(page)).toEqual(['fb-a:A1', 'fb-a:A1', 'fb-a:A1']);
  await saveBtn(page, 'A1');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Nessuna modifica');
  expect((await sent(page)).length).toBe(3);
});

test('fallimento su un feedback mentre un ALTRO sta salvando: nessun travaso', async ({ openTab }) => {
  const page = await boot(openTab);
  await open(page, 'fb-a');
  await saveEnter(page, 'A1'); await waitSent(page, 1);
  await saveEnter(page, 'A2'); await waitSent(page, 2);
  await open(page, 'fb-b');
  await saveBtn(page, 'B1');   await waitSent(page, 3);

  await settle(page, 0, true);   // A1 arriva
  await settle(page, 1, false);  // A2 no  → A ambiguo
  await settle(page, 2, true);   // B1 arriva
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  expect(await box(page)).toBe('B1');

  // B non e' contaminato: risalvare B1 e' un no-op legittimo.
  await saveBtn(page, 'B1');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Nessuna modifica');

  // A invece riparte sempre.
  await open(page, 'fb-a');
  expect(await box(page)).toBe('V0');
  await saveBtn(page, 'V0'); await waitSent(page, 5);
  expect(await sent(page)).toEqual(['fb-a:A1', 'fb-a:A2', 'fb-b:B1', 'fb-b:B1', 'fb-a:V0']);
});

test('la casella c\'e\' su tutte le schede e sui feedback chiusi; non-admin esclusa', async ({ openTab }) => {
  const page = await boot(openTab);
  // fb-b e' 'done' → scheda Risolti
  await page.evaluate(() => window.__mgTest.setTab('done'));
  await open(page, 'fb-b');
  await expect(page.locator('#mgUserNote')).toBeVisible();
  expect(await box(page)).toBe('W0');

  await page.evaluate(() => window.__mgTest.setAdmin(false));
  await open(page, 'fb-b');
  await expect(page.locator('#mgUserNote')).toBeHidden();
});
