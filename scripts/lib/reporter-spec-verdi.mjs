// Reporter di Playwright del controllo di fine lavoro: segna verde uno spec appena tutti i suoi test hanno l'esito
// atteso, così un comando ucciso al tetto (anche senza preavviso) non perde quelli già passati (#2113).
// File, chiave e radice dei nomi arrivano da FILO_SPEC_VERDI_FILE, _CHIAVE e _RADICE; senza file e chiave, niente.

import { relative, sep } from 'node:path';
import { segnaSpecVerdi, togliSpecVerdi } from './spec-verdi.mjs';

export default class SpecVerdi {
  onBegin(_config, suite) {
    this.file = process.env.FILO_SPEC_VERDI_FILE || '';
    this.chiave = process.env.FILO_SPEC_VERDI_CHIAVE || '';
    this.segnati = [];
    this.rotto = false;
    // config.rootDir è la cartella dei test, non quella da cui gli spec prendono il nome: si parte dal lancio.
    this.radice = process.env.FILO_SPEC_VERDI_RADICE || process.cwd();
    this.mancano = new Map();
    for (const t of suite.allTests()) {
      const s = this.nome(t);
      if (!this.mancano.has(s)) this.mancano.set(s, new Set());
      this.mancano.get(s).add(t.id);
    }
  }

  nome(t) {
    return relative(this.radice, t.location.file).split(sep).join('/').replace(/\.spec\.mjs$/, '');
  }

  // Un tentativo rosso con un retry davanti lascia il test fra i mancanti: lo toglie solo il tentativo che riesce.
  onTestEnd(test, result) {
    if (!this.file || !this.chiave) return;
    const s = this.nome(test);
    const mancano = this.mancano.get(s);
    if (!mancano) return;
    if (result.status === test.expectedStatus || result.status === 'skipped') mancano.delete(test.id);
    if (mancano.size) return;
    this.mancano.delete(s);
    segnaSpecVerdi(this.file, this.chiave, [s]);
  }

  printsToStdio() { return false; }
}
