// #892.4 — un comando che non si chiude (apostrofo, `if` senza `fi`) nella shell persistente della home: finisce con
// l'errore di sintassi sotto di lui, e il comando dopo gira da solo, non come seguito del testo aperto.
// Spawna /bin/sh e bash veri: ci sono su qualunque Linux e Mac. Su Windows la shell POSIX è WSL, fuori da qui.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { createSession } = require(join(ROOT, 'src', 'main', 'services', 'shell.js'));

const TETTO_MS = 15_000;
const TMP = cartellaTemporanea('filo-riga-aperta-');
process.on('exit', () => { try { togliCartella(TMP); } catch (_) {} });

function esegui(sessione, comando) {
  return new Promise((risolvi, rifiuta) => {
    let out = '';
    let err = '';
    const stop = setTimeout(() => rifiuta(new Error(`«${comando}» è rimasto in corso`)), TETTO_MS);
    sessione.exec(comando, {
      onData: ({ chunk, stream }) => { if (stream === 'stderr') err += chunk; else out += chunk; },
      onExit: (e) => { clearTimeout(stop); risolvi({ out, err, ...e }); },
      onError: ({ message }) => { clearTimeout(stop); rifiuta(new Error(message)); },
    });
  });
}

for (const shell of ['sh', 'bash']) {
  test(`${shell}: un apostrofo aperto chiude il suo comando, e quello dopo parte da solo`, { skip: process.platform === 'win32' && 'su Windows la shell POSIX è WSL' }, async () => {
    const s = createSession({ shell, cwd: TMP });
    try {
      const aperto = await esegui(s, "echo 'non chiuso");
      assert.notEqual(aperto.code, 0, 'una riga che non si chiude non è riuscita');
      assert.match(aperto.err, /quot|EOF|matching/i, `l'errore di sintassi sta sotto il comando che l'ha dato: ${JSON.stringify(aperto)}`);
      assert.doesNotMatch(aperto.out, /FILO_/, 'i marcatori della sessione non arrivano a chi guarda');

      const dopo = await esegui(s, 'echo dopo');
      assert.equal(dopo.out, 'dopo\n', `il comando dopo è finito dentro il testo aperto: ${JSON.stringify(dopo)}`);
      assert.equal(dopo.err, '', `l'errore del comando prima non è suo: ${JSON.stringify(dopo)}`);
      assert.equal(dopo.code, 0);

      const blocco = await esegui(s, 'if true; then echo a');
      assert.notEqual(blocco.code, 0);
      assert.equal((await esegui(s, 'echo ancora')).out, 'ancora\n');
    } finally { s.kill(); }
  });

  test(`${shell}: fra apici il comando resta quello di un terminale vero`, { skip: process.platform === 'win32' && 'su Windows la shell POSIX è WSL' }, async () => {
    const s = createSession({ shell, cwd: TMP });
    try {
      assert.equal((await esegui(s, "X=5; cd .. && echo \"it's $X\"")).out, "it's 5\n");
      const resto = await esegui(s, 'echo "$X"; pwd');
      assert.equal(resto.out, `5\n${dirname(TMP)}\n`, 'variabili e cartella restano fra un comando e l\'altro');
      assert.equal((await esegui(s, "printf '%s\\n' 'a'\"'\"'b'")).out, "a'b\n");
      assert.equal((await esegui(s, 'cat <<FINE\nriga uno\nriga due\nFINE')).out, 'riga uno\nriga due\n');
      assert.equal((await esegui(s, 'false')).code, 1);
      const uscita = await esegui(s, 'exit 3');
      assert.equal(uscita.chiusa, true);
      assert.equal(uscita.uscita, 3);
    } finally { s.kill(); }
  });

  // Verifica #1683 — bash legge lo stdin un byte per volta: un comando che chiede si prendeva le righe dei marcatori al
  // posto della risposta, e il terminale restava in corso. La risposta scritta sotto l'uscita deve arrivare a lui.
  test(`${shell}: un comando che chiede riceve la risposta scritta dopo, e finisce`, { skip: process.platform === 'win32' && 'su Windows la shell POSIX è WSL' }, async () => {
    const s = createSession({ shell, cwd: TMP });
    const rispondi = (comando, risposta) => {
      const p = esegui(s, comando);
      setTimeout(() => s.write(risposta), 300);
      return p;
    };
    try {
      const letto = await rispondi('read x; echo "letto=$x"', 'ciao\n');
      assert.equal(letto.out, 'letto=ciao\n');
      writeFileSync(join(TMP, 'bozza.txt'), 'nuovo');
      writeFileSync(join(TMP, 'lettera.txt'), 'vecchio');
      const copia = await rispondi('cp -i bozza.txt lettera.txt', 'y\n');
      assert.equal(copia.code, 0, JSON.stringify(copia));
      assert.equal(readFileSync(join(TMP, 'lettera.txt'), 'utf8'), 'nuovo', 'il sì è arrivato alla domanda');
      assert.equal((await esegui(s, 'echo dopo')).out, 'dopo\n');
    } finally { s.kill(); }
  });

  test(`${shell}: lo stderr di un comando resta suo anche chiuso a metà riga`, { skip: process.platform === 'win32' && 'su Windows la shell POSIX è WSL' }, async () => {
    const s = createSession({ shell, cwd: TMP });
    try {
      for (let i = 0; i < 5; i++) {
        const r = await esegui(s, `ls ./non-esiste-${i}; printf 'senza-a-capo-${i}' >&2`);
        assert.match(r.err, new RegExp(`non-esiste-${i}[\\s\\S]*senza-a-capo-${i}$`));
        assert.doesNotMatch(r.err, /FILO_/);
      }
      // Chi chiude lo stderr della shell non la blocca: il comando finisce lo stesso.
      await esegui(s, 'exec 2>/dev/null');
      assert.equal((await esegui(s, 'echo vivo')).out, 'vivo\n');
    } finally { s.kill(); }
  });
}
