// Reporter di Playwright del controllo di fine lavoro: segna verde uno spec appena tutti i suoi test hanno l'esito
// atteso, così un comando ucciso al tetto (anche senza preavviso) non perde quelli già passati (#2113).
// File, chiave e radice dei nomi arrivano da FILO_SPEC_VERDI_FILE, _CHIAVE e _RADICE; senza file e chiave, niente.

import { relative, sep } from 'node:path';
import { segnaSpecVerdi, togliSpecVerdi } from './spec-verdi.mjs';

export default class SpecVerdi {
  onBegin(_config, suite) {
    this.file = process.env.FILO_SPEC_VERDI_FILE || '';
    this.chiave = process.env.FILO_SPEC_VERDI_CHIAVE || '';
    this.segnati = new Set();
    this.rotto = false;
    // config.rootDir è la cartella dei test, non quella da cui gli spec prendono il nome: si parte dal lancio.
    this.radice = process.env.FILO_SPEC_VERDI_RADICE || process.cwd();
    this.esiti = new Map();
    for (const t of suite.allTests()) {
      const s = this.nome(t);
      if (!this.esiti.has(s)) this.esiti.set(s, new Map());
      this.esiti.get(s).set(t.id, false);
    }
  }

  nome(t) {
    return relative(this.radice, t.location.file).split(sep).join('/').replace(/\.spec\.mjs$/, '');
  }

  // Una regola sola: verde finché l'ULTIMO esito di ogni test è quello atteso. Un salto imposto da un errore prima
  // (preparazione caduta, gruppo in fila) ha come atteso «passato» e non conta; un test già passato che torna rosso a
  // un nuovo tentativo del gruppo toglie il segno.
  onTestEnd(test, result) {
    if (!this.file || !this.chiave) return;
    const s = this.nome(test);
    const esiti = this.esiti.get(s);
    if (!esiti) return;
    esiti.set(test.id, result.status === test.expectedStatus);
    const verde = !this.rotto && [...esiti.values()].every(Boolean);
    if (verde && !this.segnati.has(s)) { this.segnati.add(s); segnaSpecVerdi(this.file, this.chiave, [s]); }
    if (!verde && this.segnati.has(s)) { this.segnati.delete(s); togliSpecVerdi(this.file, this.chiave, [s]); }
  }

  // Un errore fuori da un test (chiusura di una fixture di worker, un globalTeardown) fa rosso il lancio senza dire di
  // quale spec: nessuno spec di questo lancio resta verde, sennò il rilancio salterebbe il rosso.
  onError() {
    this.rotto = true;
    if (this.file && this.chiave && this.segnati.size) togliSpecVerdi(this.file, this.chiave, [...this.segnati]);
    this.segnati.clear();
  }

  printsToStdio() { return false; }
}
