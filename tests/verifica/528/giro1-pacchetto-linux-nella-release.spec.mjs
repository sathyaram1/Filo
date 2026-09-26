// Giro 1 di verifica del feedback #528 — «pubblicare Filo-Linux.AppImage».
//
// COSA PROVA
//   Il sintomo dell'utente: un tester su Linux apre la pagina di download e
//   deve trovare un file con un nome FISSO, perché il collegamento del sito è
//   uno solo e non sa che numero di versione sia uscito. Qui si guarda tutta
//   la catena che porta quel file fino alla pubblicazione: la ricetta del
//   pacchetto, il lavoro che lo costruisce, e il controllo che si accorge se
//   alla pubblicazione quel file non è arrivato.
//
//   Non apre Filo: non c'è niente da cliccare. Sta qui, e non fra gli unit
//   test, perché è la memoria di QUESTO giro — chi corregge la rilancia con
//   `npx playwright test tests/verifica/528`.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leggi = (p) => fs.readFileSync(path.join(RADICE, p), 'utf8');

const NOME_FISSO = 'Filo-Linux.AppImage';
const MANIFESTO_AGGIORNAMENTI = 'latest-linux.yml';

test('il pacchetto Linux esce col nome fisso che il sito si aspetta', () => {
  const pkg = JSON.parse(leggi('package.json'));
  const linux = pkg.build && pkg.build.linux;
  expect(linux, 'la ricetta non prevede piu\' un pacchetto Linux').toBeTruthy();

  const bersagli = [].concat(linux.target || []).map((t) => (typeof t === 'string' ? t : t.target));
  expect(bersagli, 'il bersaglio AppImage e\' sparito dalla ricetta').toContain('AppImage');

  // `${ext}` diventa `AppImage`: il nome finale non deve contenere il numero
  // di versione, altrimenti il collegamento fisso del sito punta nel vuoto.
  const nome = String(linux.artifactName || '');
  expect(nome.replace('${ext}', 'AppImage')).toBe(NOME_FISSO);
  expect(nome).not.toMatch(/\$\{version\}/);
});

test('esistono i comandi per costruire e per pubblicare la versione Linux', () => {
  const pkg = JSON.parse(leggi('package.json'));
  expect(pkg.scripts['build:linux'], 'manca il comando che costruisce senza pubblicare').toMatch(/--linux/);
  expect(pkg.scripts['build:linux']).toMatch(/--publish never/);
  expect(pkg.scripts['release:linux'], 'manca il comando che pubblica').toMatch(/--linux/);
  expect(pkg.scripts['release:linux']).toMatch(/--publish always/);
});

test('la pubblicazione automatica ha un lavoro per Linux, sullo stesso modello di quello per Mac', () => {
  const yml = leggi('.github/workflows/release.yml');

  const iniz = yml.indexOf('\n  release-linux:');
  expect(iniz, 'il lavoro per Linux non c\'e\' nella pubblicazione automatica').toBeGreaterThan(-1);
  // Il lavoro arriva fino al prossimo lavoro di pari livello, o alla fine.
  const dopo = yml.slice(iniz + 1);
  const fine = dopo.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  const blocco = fine === -1 ? dopo : dopo.slice(0, fine + 1);

  expect(blocco, 'non gira su una macchina Linux').toMatch(/runs-on:\s*ubuntu-latest/);
  expect(blocco, 'non aspetta la pubblicazione Windows').toMatch(/needs:\s*release/);
  // Se Linux si rompe, la release Windows deve restare valida.
  expect(blocco, 'un guasto su Linux porterebbe giu\' anche la release Windows').toMatch(/continue-on-error:\s*true/);
  // Senza le chiavi incastonate l'app arriva muta.
  expect(blocco, 'le chiavi di default non vengono incastonate: l\'app arriverebbe muta').toMatch(/bake-default-config\.mjs/);
  // Stesso codice pubblicato per Windows, non il tag.
  expect(blocco, 'non costruisce lo stesso commit pubblicato per Windows').toMatch(/needs\.release\.outputs\.sha/);
  expect(blocco, 'non lancia la pubblicazione del pacchetto Linux').toMatch(/release:linux/);
});

test('se il file non arriva nella pubblicazione, il lavoro diventa rosso invece di fingere', () => {
  const yml = leggi('.github/workflows/release.yml');
  const iniz = yml.indexOf('\n  release-linux:');
  const blocco = yml.slice(iniz);

  // Lo strumento di impacchettamento puo' finire verde senza aver allegato
  // niente: l'unica risposta vera e' guardare la pubblicazione.
  expect(blocco, 'nessuno controlla la pubblicazione vera').toMatch(/gh release view/);
  // Dal #733 i nomi dei file non stanno piu' nel workflow: il controllo li
  // chiede allo script dell'allarme, che e' la fonte unica.
  expect(blocco, 'il controllo non chiede l\'elenco dei file attesi').toMatch(/release-platform-alarm\.mjs --attesi Linux/);
  const attesi = leggi('scripts/release-platform-alarm.mjs');
  expect(attesi).toContain(NOME_FISSO);
  // Senza questo, chi scarica resta fermo alla prima versione per sempre.
  expect(attesi, 'il manifesto degli aggiornamenti per Linux non viene preteso').toContain(MANIFESTO_AGGIORNAMENTI);
});

test('c\'e\' un modo di provare la costruzione senza bruciare un numero di versione', () => {
  const p = path.join(RADICE, '.github/workflows/verifica-linux.yml');
  expect(fs.existsSync(p), 'manca il lavoro che prova la build Linux senza pubblicare').toBe(true);
  const yml = fs.readFileSync(p, 'utf8');
  expect(yml, 'questo lavoro non deve pubblicare niente').not.toMatch(/--publish always|release:linux/);
  expect(yml).toMatch(/workflow_dispatch/);
});

test('una sentinella diventa rossa se il pacchetto Linux sparisce dal build', () => {
  const p = path.join(RADICE, 'tests/unit/linuxSupport.test.mjs');
  expect(fs.existsSync(p), 'la sentinella sempre accesa per Linux non esiste').toBe(true);
  const testo = fs.readFileSync(p, 'utf8');
  expect(testo).toContain(NOME_FISSO);
  expect(testo).toContain(MANIFESTO_AGGIORNAMENTI);
});
