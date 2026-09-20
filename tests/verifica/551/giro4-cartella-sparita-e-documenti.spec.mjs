// Verifica #551 — giro 4.
//
// Tre porte sullo stesso danno della segnalazione: «il file c'è, e Filo
// risponde che non c'è» / «il testo arriva storpiato».
//
//  1. La cartella in cui Filo sta guardando smette di esistere — l'utente la
//     rinomina dal gestore dei file, la stacca con la chiavetta, o la cancella
//     Filo stesso su richiesta. Da lì in poi il terminale dell'assistente non
//     esegue più NIENTE, in quella scheda, per sempre: nemmeno il comando per
//     andarsene. Il terminale che l'utente digita a mano, davanti alla stessa
//     cartella sparita, riparte dalla home e continua a funzionare.
//  2. Il taglio di un documento lungo cade dove capita e può lasciare in fondo
//     mezzo carattere. È la stessa cosa già chiusa per l'output dei comandi nel
//     secondo giro, sull'altra metà della cura.
//  3. Un documento salvato in ANSI (il modo normale di salvare un testo su
//     Windows fino a ieri) perde proprio i segni tipografici della
//     segnalazione: il trattino lungo, l'apostrofo tipografico, il simbolo
//     dell'euro. Gli accenti tornano, quelli no: diventano caratteri
//     invisibili, e il modello risponde su un testo bucato.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const HOME = 'filo://dashboard/dashboard.html';

const eseguiComando = (page, comando) =>
  page.evaluate((c) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'filo_confirm_action',
      action: { type: 'ESEGUI_COMANDO', comando: c },
    }, (r) => resolve(r));
  }), comando);

const leggiDocumento = (page, percorso) =>
  page.evaluate((p) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_RUN_ACTION,
      action: { type: 'LEGGI_DOCUMENTO', percorso: p },
    }, (r) => resolve(r));
  }), percorso);

const accendiTerminale = (page) =>
  page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_confirm_action',
    action: { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' },
  }));

test('se la cartella cambia nome, Filo continua a poter eseguire comandi', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-rinominata-');
  const dopo = `${base}-nuovo-nome`;
  try {
    writeFileSync(join(base, 'bolletta.txt'), 'totale 84,50\n', 'utf8');
    const page = await openTab(HOME);
    await accendiTerminale(page);

    const cd = await eseguiComando(page, `cd '${base}'`);
    expect(cd.executed, 'il cd non è partito').toBe(true);

    // L'utente rinomina la cartella dal gestore dei file mentre chiacchiera con
    // Filo. Nessuno ha fatto niente di strano: la cartella c'è ancora, ha solo
    // un altro nome.
    renameSync(base, dopo);

    const eco = await eseguiComando(page, 'echo ciao');
    expect(
      String(eco.output?.stdout || '') + String(eco.output?.stderr || ''),
      'il terminale dell’assistente non esegue più niente, e il motivo che dà non parla della cartella',
    ).toContain('ciao');
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(dopo, { recursive: true, force: true });
  }
});

test('da una cartella che non c’è più Filo riesce almeno ad andarsene', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-sparita-');
  const altrove = cartellaTemporanea('filo-551-altrove-');
  try {
    writeFileSync(join(altrove, 'contratto.txt'), 'durata 12 mesi\n', 'utf8');
    const page = await openTab(HOME);
    await accendiTerminale(page);

    await eseguiComando(page, `cd '${base}'`);
    rmSync(base, { recursive: true, force: true });

    // La via d'uscita ovvia: andare da un'altra parte. Se nemmeno questa passa,
    // in quella scheda il terminale è finito e l'utente non ha modo di saperlo.
    const via = await eseguiComando(page, `cd '${altrove}' && ls`);
    expect(
      String(via.output?.stdout || ''),
      'nemmeno cambiare cartella funziona più: il terminale resta bloccato sulla cartella sparita',
    ).toContain('contratto.txt');
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(altrove, { recursive: true, force: true });
  }
});

test('il terminale che l’utente digita, sulla stessa cartella sparita, continua', async ({ openTab }) => {
  // La strada gemella: la stessa cartella che sparisce sotto i piedi, ma al
  // terminale che l'utente usa a mano. Qui la cartella inutilizzabile viene
  // riportata alla home e il comando gira lo stesso. È la misura di quanto le
  // due strade divergono.
  const base = cartellaTemporanea('filo-551-sparita-gemella-');
  try {
    const page = await openTab(HOME);
    await accendiTerminale(page);
    rmSync(base, { recursive: true, force: true });

    const out = await page.evaluate((cwd) => new Promise((resolve) => {
      let acc = '';
      let chiuso = false;
      const fine = (d) => {
        if (chiuso) return;
        chiuso = true;
        resolve(acc + (d && d.message ? `\n${d.message}` : ''));
      };
      window.filo.shellExec({
        command: 'echo ciao',
        cwd,
        onData: (d) => { if (d && typeof d.chunk === 'string') acc += d.chunk; },
        onExit: () => fine(),
        onError: fine,
      });
      setTimeout(() => fine(), 15000);
    }), base);

    expect(out, `anche il terminale dell’utente si blocca: ${JSON.stringify(out)}`).toContain('ciao');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('il taglio di un documento lungo non lascia mezzo carattere in fondo', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-taglio-documento-');
  try {
    // Il tetto del testo restituito sta a 16.000 caratteri: mettiamo un'emoji
    // esattamente a cavallo del taglio.
    const file = join(base, 'diario.txt');
    writeFileSync(file, `${'a'.repeat(15_999)}😀 e poi continua ancora a lungo.`, 'utf8');
    const page = await openTab(HOME);

    const r = await leggiDocumento(page, file);
    const testo = String(r?.output?.text || '');
    expect(r?.output?.ok, 'il documento non si è letto').toBe(true);
    const ultimo = testo.charCodeAt(testo.length - 1);
    expect(
      ultimo >= 0xD800 && ultimo <= 0xDBFF,
      'il testo del documento finisce con mezzo carattere, che si mostra come un rombo',
    ).toBe(false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('un documento salvato in ANSI conserva trattino lungo, apostrofo ed euro', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-ansi-');
  try {
    // Come lo salva il Blocco note scegliendo «ANSI», o Excel esportando un CSV:
    // «SPECIFICHE — singolarità dell’offerta: 12 €»
    const bytes = Buffer.from([
      0x53, 0x50, 0x45, 0x43, 0x49, 0x46, 0x49, 0x43, 0x48, 0x45, 0x20, // SPECIFICHE
      0x97, 0x20, // — trattino lungo
      0x73, 0x69, 0x6e, 0x67, 0x6f, 0x6c, 0x61, 0x72, 0x69, 0x74, 0xe0, // singolarità
      0x20, 0x64, 0x65, 0x6c, 0x6c, 0x92, 0x6f, 0x66, 0x66, 0x65, 0x72, 0x74, 0x61, // dell’offerta
      0x3a, 0x20, 0x31, 0x32, 0x20, 0x80, 0x0a, // : 12 €
    ]);
    const file = join(base, 'specifiche.txt');
    writeFileSync(file, bytes);
    const page = await openTab(HOME);

    const r = await leggiDocumento(page, file);
    const testo = String(r?.output?.text || '');
    expect(r?.output?.ok, 'il documento non si è letto').toBe(true);
    expect(testo, 'gli accenti si sono persi').toContain('singolarità');
    expect(testo, 'il trattino lungo è diventato un carattere invisibile').toContain('—');
    expect(testo, 'l’apostrofo tipografico è diventato un carattere invisibile').toContain('’');
    expect(testo, 'il simbolo dell’euro è diventato un carattere invisibile').toContain('€');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
