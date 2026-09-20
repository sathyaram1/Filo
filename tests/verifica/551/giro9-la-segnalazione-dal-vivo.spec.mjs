// Verifica #551 — giro 9. La lamentela, rifatta con i due file veri della
// segnalazione, e gli input limite sul cammino che l'utente ha percorso.
//
// L'episodio: l'utente chiede a Filo di leggere un file; Filo cerca col
// terminale, si vede tornare «SPECIFICHE SEO E METADATI - singolarita.txt» e
// «SPECIFICHE TIPOGRAFICHE - Singolarit<27>.txt», chiede di leggere il primo e
// si sente rispondere che a quel percorso non c'è nessun file. Le due cure
// devono reggere insieme: il terminale non storpia più i nomi, e il lettore
// perdona comunque una svista sul nome — senza mai aprire il vicino.
//
// Nota di ambiente, dichiarata perché cambia come si leggono questi verdi: la
// storpiatura originale è della console di Windows, e queste prove girano nel
// contenitore Linux delle routine, dove lo stdout è già UTF-8. Qui si tiene
// chiusa la catena che sta in mezzo — sonda della cartella, troncamento, busta
// del contenuto esterno, lettore — e che vale su ogni piattaforma.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const HOME = 'filo://dashboard/dashboard.html';

// I due file della segnalazione, come stanno sul disco.
const SEO = 'SPECIFICHE SEO E METADATI — singolarita.txt';
const TIPO = 'SPECIFICHE TIPOGRAFICHE — Singolarità.txt';

// Gli stessi nomi come il terminale di Windows li consegnava al modello: il
// trattino lungo schiacciato in trattino breve, la «à» diventata un byte che
// in UTF-8 non vuol dire niente.
const SEO_STORPIATO = 'SPECIFICHE SEO E METADATI - singolarita.txt';
const TIPO_STORPIATO = 'SPECIFICHE TIPOGRAFICHE - Singolarit�.txt';

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const accendiTerminale = (page) =>
  page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_confirm_action',
    action: { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' },
  }));

const leggiDocumento = (page, percorso) =>
  page.evaluate((p) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_RUN_ACTION,
      action: { type: 'LEGGI_DOCUMENTO', percorso: p },
    }, (r) => resolve(r));
  }), percorso);

function cartellaDellaSegnalazione(prefisso) {
  const dir = cartellaTemporanea(prefisso);
  writeFileSync(join(dir, SEO), 'TITOLO SEO\nparola chiave: singolarità\n', 'utf8');
  writeFileSync(join(dir, TIPO), 'TITOLO TIPOGRAFICO\ncorpo: 11 punti\n', 'utf8');
  return dir;
}

test('i due file della segnalazione: l’elenco li dice interi e il nome apre il file giusto', async ({ app, openTab }) => {
  const dir = cartellaDellaSegnalazione('filo-551-g9-vivo-');
  try {
    const page = await openTab(HOME);
    await accendiTerminale(page);

    const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando: `ls "${dir}"` });
    expect(r.executed, `il comando non è partito: ${JSON.stringify(r).slice(0, 300)}`).toBe(true);
    const stdout = String(r.output?.stdout || '');
    expect(stdout, 'il nome col trattino lungo non torna intero').toContain(SEO);
    expect(stdout, 'il nome con la «à» non torna intero').toContain(TIPO);
    expect(stdout.includes('�'), 'nell’elenco c’è un carattere perso').toBe(false);

    // E adesso la seconda cura, quella che vale anche quando a sbagliare il
    // nome è l'utente: il nome storpiato apre lo stesso il file GIUSTO, non il
    // vicino, e Filo dice quale ha aperto davvero.
    const letto = await leggiDocumento(page, join(dir, SEO_STORPIATO));
    expect(letto?.executed).toBe(true);
    expect(String(letto.output?.text || ''), 'ha aperto il file sbagliato').toContain('TITOLO SEO');
    expect(letto.output?.name, 'il nome vero non torna a chi legge').toBe(SEO);
    expect(String(letto.output?.requested || ''), 'non dice che il percorso chiesto era un altro').toContain(SEO_STORPIATO);

    // L'altro file, quello con la «à» persa: stessa cartella, nome che somiglia
    // al primo per metà. Deve aprire il suo, mai quello di prima.
    const altro = await leggiDocumento(page, join(dir, TIPO_STORPIATO));
    expect(altro?.executed).toBe(true);
    expect(String(altro.output?.text || ''), 'ha aperto il vicino').toContain('TITOLO TIPOGRAFICO');
    expect(altro.output?.name).toBe(TIPO);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('la cartella storpiata si ritrova, e il nome vero arriva a chi legge', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-g9-cartella-');
  try {
    const sotto = join(base, 'Progetto — Singolarità');
    mkdirSync(sotto);
    writeFileSync(join(sotto, SEO), 'TITOLO SEO\n', 'utf8');

    const page = await openTab(HOME);
    const letto = await leggiDocumento(page, join(base, 'Progetto - Singolarita', SEO_STORPIATO));
    expect(String(letto.output?.text || ''), 'col nome della cartella storpiato non trova più niente').toContain('TITOLO SEO');
    expect(letto.output?.name).toBe(SEO);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('gli input limite del cammino segnalato danno tutti un rifiuto spiegato', async ({ openTab }) => {
  const dir = cartellaDellaSegnalazione('filo-551-g9-limite-');
  try {
    const page = await openTab(HOME);
    const casi = [
      ['percorso vuoto', ''],
      ['soli spazi', '     '],
      ['diecimila caratteri', join(dir, `${'a'.repeat(10000)}.txt`)],
      ['emoji', join(dir, '🙂🙂🙂.txt')],
      ['script', join(dir, '<script>alert(1)</script>.txt')],
      ['virgolette attorno', `"${join(dir, 'non c\'è.txt')}"`],
      ['una cartella', dir],
      ['tutti caratteri persi', join(dir, '���.txt')],
      ['solo l’estensione persa', join(dir, '��.txt')],
    ];
    for (const [nome, percorso] of casi) {
      const r = await leggiDocumento(page, percorso);
      const out = r?.output || {};
      expect(out.ok, `${nome}: Filo dichiara di aver letto qualcosa (${out.name})`).toBe(false);
      expect(String(out.detail || ''), `${nome}: il rifiuto non spiega niente`).not.toBe('');
    }

    // E dopo tutti i rifiuti il cammino buono funziona ancora: nessuno stato
    // sporco rimasto per strada.
    const buono = await leggiDocumento(page, join(dir, SEO_STORPIATO));
    expect(String(buono.output?.text || '')).toContain('TITOLO SEO');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dieci letture di fila, tutte insieme, non fanno inciampare niente', async ({ openTab }) => {
  const dir = cartellaDellaSegnalazione('filo-551-g9-raffica-');
  try {
    const page = await openTab(HOME);
    const percorsi = [];
    for (let i = 0; i < 10; i++) percorsi.push(join(dir, i % 2 ? SEO_STORPIATO : TIPO_STORPIATO));
    const esiti = await page.evaluate((lista) => Promise.all(lista.map((p) => new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: window.SN_MSG.MSG.FILO_RUN_ACTION,
        action: { type: 'LEGGI_DOCUMENTO', percorso: p },
      }, (r) => resolve(r));
    }))), percorsi);
    esiti.forEach((r, i) => {
      const atteso = i % 2 ? 'TITOLO SEO' : 'TITOLO TIPOGRAFICO';
      expect(String(r?.output?.text || ''), `lettura ${i + 1}: ha aperto l’altro file`).toContain(atteso);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
