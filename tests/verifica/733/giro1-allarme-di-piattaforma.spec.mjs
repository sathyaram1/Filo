// Giro 1 di verifica del feedback #733 — «Filo per Linux non esce, e se il
// lavoro che lo costruisce fallisce nessuno lo viene a sapere».
//
// COSA PROVA
//   Il sintomo: chi sta su Linux apre la pagina di download e non trova
//   niente, e nessuno se n'era accorto per sei giorni. Il rimedio consegnato
//   rende il guasto rumoroso: se la mezza release di una piattaforma fallisce
//   si apre un feedback. Qui si guarda che quel feedback dica il VERO, e che
//   chi lo prende in mano abbia poi una strada per rimettere i file al loro
//   posto.
//
//   Non apre Filo: non c'è niente da cliccare. Sta qui, e non fra gli unit
//   test, perché è la memoria di QUESTO giro — chi corregge la rilancia con
//   `npx playwright test tests/verifica/733`.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => fs.readFileSync(path.join(RADICE, p), 'utf8');
const allarme = await import(path.join(RADICE, 'scripts', 'release-platform-alarm.mjs'));

const VERSIONE = 'v0.2.229';
const REPO = 'sathyaram1/Filo';
const FOGLIETTO = 'Se-Filo-non-si-apre-Linux.txt';
const APPIMAGE = 'Filo-Linux.AppImage';

// Quello che il lavoro passa all'allarme quando si ferma: gli esiti dei passi
// e l'elenco dei file che il controllo finale non ha trovato nella release.
const componi = ({ passo, mancanti = '' }) => allarme.componiAllarme({
  piattaforma: 'Linux',
  versione: VERSIONE,
  passo,
  esecuzione: `https://github.com/${REPO}/actions/runs/123`,
  repo: REPO,
  mancanti,
});

test('il guasto di una piattaforma diventa un feedback che dice cosa è successo e dove guardare', () => {
  const { titolo, testo } = componi({ passo: 'build' });
  expect(titolo, 'il titolo non nomina la piattaforma').toContain('Linux');
  expect(titolo, 'il titolo non nomina la versione').toContain(VERSIONE);
  expect(testo, 'non si capisce quale passo si è fermato').toMatch(/Passo fallito/);
  expect(testo, 'manca il collegamento all\'esecuzione: chi prende il feedback deve ripartire da lì').toContain('/actions/runs/123');
  expect(testo, 'chi legge deve sapere che la versione per Windows resta buona').toMatch(/Windows/);
});

// Il guasto più probabile dopo la costruzione è il foglietto del primo avvio
// che non sale: il pacchetto e il manifesto degli aggiornamenti sono già nella
// release. Il feedback non deve raccontare un guasto più grosso di quello vero.
test('il feedback dichiara rotto solo quello che è davvero rotto', () => {
  const solofoglietto = componi({ passo: 'controllo', mancanti: FOGLIETTO });
  expect(solofoglietto.testo, `manca ${FOGLIETTO}, non l'AppImage: il feedback non deve dire che il download risponde 404`)
    .not.toMatch(new RegExp(`${APPIMAGE.replace('.', '\\.')}[^\\n]*404`));
  expect(solofoglietto.testo, 'con il solo foglietto mancante l\'aggiornamento automatico funziona: non va dato per rotto')
    .not.toMatch(/l'aggiornamento automatico legge latest-linux\.yml, che nella release non c'è/);
  expect(solofoglietto.testo, 'il file che manca davvero deve restare scritto').toContain(FOGLIETTO);

  // Quando invece si ferma prima, nella release non c'è niente: lì il 404 e
  // l'aggiornamento muto sono la verità e vanno detti.
  const tutto = componi({ passo: 'build' });
  expect(tutto.testo, 'se il pacchetto non è mai salito il 404 va detto').toContain(APPIMAGE);
});

// L'allarme chiede di «ripubblicare i file su QUELLA STESSA release» e avverte
// che rilanciare la pubblicazione non basta. Se nessuno può farlo, il feedback
// che si apre non è lavorabile: nessuno di noi ha un Mac o un Linux su cui
// costruire a mano, e il lavoro che verifica la build Linux non pubblica.
test('chi prende il feedback ha una strada per rimettere i file su una release già pubblicata', () => {
  const testo = componi({ passo: 'controllo', mancanti: APPIMAGE }).testo;
  const chiedeDiRipubblicare = /ripubblica/i.test(testo);

  // I nomi delle voci che si possono scegliere avviando a mano un lavoro:
  // sono l'unico modo di dire «rimetti i file per Linux sulla v0.2.229».
  const vociAMano = [];
  for (const f of fs.readdirSync(path.join(RADICE, '.github', 'workflows'))) {
    if (!/\.ya?ml$/.test(f)) continue;
    const y = leggi(path.join('.github', 'workflows', f));
    if (!/^\s*workflow_dispatch:/m.test(y)) continue;
    const zona = y.slice(y.search(/^\s*workflow_dispatch:/m), y.search(/^jobs:/m) >= 0 ? y.search(/^jobs:/m) : y.length);
    for (const m of zona.matchAll(/^ {6}([a-z_][\w]*):$/gm)) vociAMano.push(m[1]);
  }

  const siPuoRipubblicare = vociAMano.some((v) => /ripubblic|riallega|versione|tag|piattaforma/i.test(v));

  expect(chiedeDiRipubblicare && !siPuoRipubblicare,
    `il feedback chiede di rimettere i file su quella stessa release, ma non c'è nessun modo di farlo: avviando a mano si può scegliere solo ${vociAMano.join(', ') || '(niente)'}, e nessuno di noi ha un Mac o un Linux su cui costruirli a mano`).toBe(false);
});
