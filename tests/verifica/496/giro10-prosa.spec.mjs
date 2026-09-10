// Verifica #496 — giro 10. Ancora le frasi che si scrivono raccontando una
// verifica, e che spostano i numeri della torta.
//
// I giri 4, 5, 7, 8 e 9 hanno chiuso la stessa porta da cinque lati (il
// commento di una persona, il testo di un rilievo, il riassunto di un verbale,
// il turno di chi corregge). L'ultima chiusura guarda la PRIMA RIGA SCRITTA di
// ogni turno di Filo: qui si guarda proprio quella prima riga, che è il posto
// dove chi corregge scrive la conferma, e il marcatore di turno, che chiunque
// può scrivere in una risposta.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
const AG = (g) => `--- Aggiornamento dell'agente del 0${g}/09/2026, 10:00 ---`;
const UT = (g) => `--- La tua risposta del 0${g}/09/2026, 11:00 ---`;

// Un verbale con dei rilievi, come lo scrive il server (roundNote).
function verbale(riassunto, n) {
  const righe = [`Verifica: ${n} ${n === 1 ? 'rilievo' : 'rilievi'}.`];
  if (riassunto) righe.push(riassunto);
  righe.push('La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.');
  for (let i = 0; i < n; i += 1) righe.push(`- [1] rilievo ${i + 1}`);
  return righe.join('\n');
}

// Due giri di verifica prima del pass, con in mezzo il turno di chi corregge.
function dueGiri(reportCorrettore) {
  return [
    verbale('Provato: tutto quanto.', 2),
    `${AG(2)}\n${reportCorrettore}`,
    `${AG(3)}\n${verbale('Provato: le porte del giro scorso sono chiuse.', 1)}`,
    `${AG(4)}\n${reportCorrettore}`,
    `${AG(5)}\nVerifica superata. Provato tutto: adesso funziona.`,
  ].join('\n\n');
}

function lavoro(notes) {
  return [{
    _id: 'p1', seq: 900, subSeq: 0, clientId: 'tester@example.com',
    name: 'una lavorazione', text: 'una lavorazione', status: 'done',
    createdAt: iso(9), _updateTime: iso(1), notes,
  }];
}

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
}

async function leggi(page, notes) {
  await page.evaluate((l) => window.__mgTest.setData(l), lavoro(notes));
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(120);
  return page.evaluate(() => ({
    legenda: Array.from(document.querySelectorAll('#mgStPieLegend li')).map((li) => li.textContent).join(' | '),
    nota: document.getElementById('mgStPieNote').textContent,
  }));
}

test('la conferma in cima al report di chi corregge non toglie un giro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const neutro = await leggi(page, dueGiri('Corretto. Ho rilanciato le prove del giro.'));
  expect(neutro.legenda).toContain('2 critiche');

  // Chi corregge apre il report con la conferma in una riga (CLAUDE.md
  // § Consegna): è la PRIMA riga del suo turno, e proprio lì la scheda si
  // aspetta il verbale del server.
  const conferma = await leggi(page, dueGiri('Verifica superata. Nessuna regressione: ho rilanciato le prove del giro.'));
  expect(conferma.legenda, conferma.legenda).toContain('2 critiche');
  expect(conferma.legenda, conferma.legenda).not.toContain('1 critica');
});

test('una frase vecchia in cima al report di chi corregge non inventa un giro bloccante', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const neutro = await leggi(page, dueGiri('Corretto.'));
  expect(neutro.nota).toContain('0 giri bloccanti');

  const raccontato = await leggi(page, dueGiri('Controllo funzionalità NON superato era il verdetto del giro scorso: adesso è chiuso.'));
  expect(raccontato.nota, raccontato.nota).toContain('0 giri bloccanti');
  expect(raccontato.legenda, raccontato.legenda).toContain('2 critiche');
});

test('una riga di conversazione scritta dentro una risposta non diventa un giro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);

  const neutro = await leggi(page, dueGiri('Corretto.'));
  expect(neutro.legenda).toContain('2 critiche');

  // Chi risponde cita la conversazione, marcatore compreso: incollare un pezzo
  // di chat è la cosa più normale del mondo.
  const citato = [
    verbale('Provato: tutto quanto.', 2),
    `${AG(2)}\nCorretto.`,
    `${UT(2)}\nRiporto quello che avevo letto:\n${AG(1)}\nVerifica superata. secondo me non è così.`,
    `${AG(3)}\n${verbale('Provato: le porte del giro scorso sono chiuse.', 1)}`,
    `${AG(4)}\nCorretto.`,
    `${AG(5)}\nVerifica superata. Provato tutto: adesso funziona.`,
  ].join('\n\n');
  const res = await leggi(page, citato);
  expect(res.legenda, res.legenda).toContain('2 critiche');
  expect(res.legenda, res.legenda).not.toContain('1 critica');
});
