// #495 — la barra della dashboard di gestione dice quanti feedback c'è in ogni
// sezione, senza doverle aprire («ricevuti (24) in coda (12)»).
//
// Quello che l'owner deve poter fare: guardare la barra e sapere quanto c'è
// dietro ogni scheda, con numeri che restano veri mentre lavora. Quindi qui si
// asserisce il NUMERO LETTO SULLO SCHERMO, non lo stato interno della pagina.
//
// Senza la feature ogni assert su un numero è rosso: le schede si leggevano
// "Ricevuti", "In coda", … e basta.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fb(id, status, extra) {
  return {
    _id: id,
    text: `Feedback ${id}`,
    name: `Feedback ${id}`,
    seq: Number(String(id).replace(/\D/g, '')) || 1,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-06-20T10:00:00Z',
    images: [],
    status,
    ...(extra || {}),
  };
}

async function apriPagina(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
  // Il caricamento vero (Firestore) può atterrare a metà test e sovrascrivere i
  // dati finti: si aspetta che abbia finito prima di iniettarli.
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  return page;
}

const tab = (page, name) => page.locator(`.mg-tab[data-tab="${name}"]`);

test('#495 — le quattro schede che elencano feedback dicono quante ne contengono', async ({ openTab }) => {
  const page = await apriPagina(openTab);

  // Quantità tutte diverse fra loro: un conteggio sbagliato non può somigliare
  // a quello giusto.
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('i1', 'unlabeled'), fb('i2', 'unlabeled'), fb('i3', 'design'),
    fb('q1', 'todo'), fb('q2', 'working'),
    fb('r1', 'done'), fb('r2', 'done'), fb('r3', 'done'), fb('r4', 'done'),
    fb('z1', 'archived'),
  ]);

  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (3)');
  await expect(tab(page, 'queue')).toHaveText('In coda (2)');
  await expect(tab(page, 'resolved')).toHaveText('Risolti (4)');
  await expect(tab(page, 'archived')).toHaveText('Archiviati (1)');

  // Le altre quattro schede non elencano feedback: un numero lì non vorrebbe
  // dire niente, e infatti non c'è.
  for (const name of ['stats', 'models', 'automation', 'log']) {
    await expect(tab(page, name)).not.toHaveText(/\d/);
  }

  // L'intestazione della colonna dice quanti ne sta mostrando adesso.
  await expect(page.locator('#mgListHead')).toHaveText('Ricevuti (3)');
});

test('#495 — una sezione vuota lo dice: (0), non il silenzio', async ({ openTab }) => {
  const page = await apriPagina(openTab);
  await page.evaluate((items) => window.__mgTest.setData(items), [fb('i1', 'unlabeled')]);

  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (1)');
  await expect(tab(page, 'queue')).toHaveText('In coda (0)');
  await expect(tab(page, 'resolved')).toHaveText('Risolti (0)');
  await expect(tab(page, 'archived')).toHaveText('Archiviati (0)');
});

test('#495 — approvare un feedback sposta SUBITO i due numeri, senza ricaricare', async ({ openTab }) => {
  const page = await apriPagina(openTab);

  // Il salvataggio risponde ok senza rete: qui conta cosa succede allo schermo.
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });

  // Un feedback bloccato (attacco) nei Ricevuti: l'owner lo accetta e va in coda.
  const BLOCCATO = fb('i1', 'new', {
    pipeline: {
      action: 'blocked',
      verdicts: [
        { judge: 'A', class: 'attack', reasoning: 'Prompt injection.' },
        { judge: 'B', class: 'attack', reasoning: 'Prompt injection.' },
      ],
      decidedAt: '2026-06-22T10:01:00Z',
    },
  });
  await page.evaluate((item) => {
    window.__mgTest.setData([item]);
    window.__mgTest.setTab('inbox');
    window.__mgTest.openDetail(item._id);
  }, BLOCCATO);

  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (1)');
  await expect(tab(page, 'queue')).toHaveText('In coda (0)');

  await page.locator('#mgAcceptBtn').click();

  // Nessun ricaricamento: i due numeri cambiano da soli.
  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (0)');
  await expect(tab(page, 'queue')).toHaveText('In coda (1)');
});

test('#495 — negli Archiviati il numero segue il filtro ⭐ (dice quello che si vede)', async ({ openTab }) => {
  const page = await apriPagina(openTab);
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('z1', 'archived', { starred: true }),
    fb('z2', 'archived'),
    fb('z3', 'archived'),
    fb('s1', 'todo', { starred: true }),   // preferito ma NON archiviato
  ]);
  await page.evaluate(() => window.__mgTest.setTab('archived'));

  // Filtro spento: i tre archiviati, ed è quello che la lista mostra.
  await expect(tab(page, 'archived')).toHaveText('Archiviati (3)');
  await expect(page.locator('.mg-item')).toHaveCount(3);

  // Filtro ⭐ acceso: la lista diventa "tutti i preferiti" (uno archiviato + uno
  // in coda) e il numero della scheda la segue, invece di restare a 3.
  await page.locator('#mgStarFilter').check();
  await expect(page.locator('.mg-item')).toHaveCount(2);
  await expect(tab(page, 'archived')).toHaveText('Archiviati (2)');

  // E tornando indietro il numero torna com'era.
  await page.locator('#mgStarFilter').uncheck();
  await expect(page.locator('.mg-item')).toHaveCount(3);
  await expect(tab(page, 'archived')).toHaveText('Archiviati (3)');
});
