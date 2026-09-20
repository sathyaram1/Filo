// Verifica #551 — giro 3. Lo stesso danno della segnalazione, un passo più in
// là: non il NOME del file, il suo CONTENUTO.
//
// Il lettore di documenti decodifica un file di testo come UTF-8, e se trova
// troppi caratteri persi ripiega sulla tabella di Windows. Fra le due non c'è
// la codifica a due byte, che su Windows è ovunque: Windows PowerShell 5.1
// scrive così ogni file prodotto con «>» (cioè i file che Filo stesso crea col
// terminale quando salva l'esito di un comando), e il Blocco note la offre
// come «Unicode». Quel file torna al modello come una fila di caratteri nulli
// intervallati da lettere, con «ÿþ» in testa: Filo risponde sul nulla, e
// all'utente sembra che il suo file non si possa leggere.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const HOME = 'filo://dashboard/dashboard.html';

const leggiDocumento = (page, percorso) =>
  page.evaluate((p) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_RUN_ACTION,
      action: { type: 'LEGGI_DOCUMENTO', percorso: p },
    }, (r) => resolve(r));
  }), percorso);

test('un file di testo scritto a due byte si legge per quello che c’è scritto', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-551-utf16-');
  try {
    const testo = 'Attività di marzo — resoconto\nCittà: Torino\nTotale: 1.234,56\n';
    // Quello che esce da «comando > uscita.txt» in Windows PowerShell 5.1.
    writeFileSync(
      join(base, 'uscita.txt'),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(testo, 'utf16le')]),
    );
    const page = await openTab(HOME);

    const r = await leggiDocumento(page, join(base, 'uscita.txt'));
    expect(r?.output?.ok, `il file non si è aperto: ${JSON.stringify(r?.output?.detail || '')}`).toBe(true);
    const letto = String(r?.output?.text || '');
    expect(letto, `Filo legge una fila di caratteri nulli: ${JSON.stringify(letto.slice(0, 40))}`)
      .toContain('Attività di marzo');
    expect(letto).toContain('1.234,56');
    expect(letto.includes('\u0000'), 'nel testo restano i byte nulli della codifica a due byte').toBe(false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
