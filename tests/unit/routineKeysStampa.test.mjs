// La parola d'ordine appena nata si copia con la riga: stampata rientrata, i quattro spazi finivano nel segreto
// FILO_BUILD_PASSPHRASE e il server la rifiutava, zittendo ogni allarme della costruzione (#1210).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('la parola d’ordine nuova sta da sola sulla sua riga, senza spazi intorno', async () => {
  const dir = cartellaTemporanea('filo-chiavi-riga-');
  try {
    const finto = join(dir, 'finto.mjs');
    writeFileSync(finto, `globalThis.fetch = async (url, init) => {
  if (!String(url).includes('routineKeys')) return new Response(JSON.stringify({ id_token: 'idt', expires_in: '3600', user_id: 'u' }), { status: 200 });
  const d = JSON.parse(String(init.body)).data;
  return new Response(JSON.stringify({ result: { ok: true, slug: d.slug, scope: d.scope, passphrase: 'parola-finta-123' } }), { status: 200 });
};
`);
    for (const potere of ['build', 'routine']) {
      const r = await new Promise((ok) => {
        execFile(process.execPath, [`--import=${pathToFileURL(finto).href}`, join(ROOT, 'scripts', 'routine-keys.mjs'), 'crea', 'prova', potere, 'x'],
          { env: { ...process.env, FILO_ADMIN_REFRESH_TOKEN: 'finto' } }, (err, so, se) => ok({ code: err ? (err.code ?? 1) : 0, out: so, err: se }));
      });
      assert.equal(r.code, 0, r.err);
      const riga = r.out.split('\n').find((l) => l.includes('parola-finta-123'));
      assert.equal(riga, 'parola-finta-123', `potere ${potere}: la riga da copiare è la parola d'ordine e basta`);
      // L'ambiente fa ombra al segreto omonimo del repo: messa lì, la parola nuova non la leggerebbe nessuno.
      if (potere === 'build') assert.match(r.out, /ambiente «rilascio»/, 'la parola della costruzione va nell\'ambiente «rilascio»');
    }
  } finally { togliCartella(dir); }
});
