// Testimone della rete per le prove (#2067): dal primo istante del main di Electron scrive in FILO_TEST_REGISTRO_RETE ogni
// richiesta HTTP che parte davvero (fetch di Node e moduli http/https), sotto qualunque fetch avvolto dall'app.
// Si carica con NODE_OPTIONS=--require (aiutoRete.mjs); la query non si scrive, porta la chiave API.

'use strict';

const file = process.env.FILO_TEST_REGISTRO_RETE;
if (file) {
  const fs = require('node:fs');
  const dc = require('node:diagnostics_channel');
  const scrivi = (url) => { try { fs.appendFileSync(file, String(url).split('?')[0] + '\n'); } catch (_) {} };
  dc.subscribe('undici:request:create', ({ request }) => scrivi(`${request.origin}${request.path}`));
  dc.subscribe('http.client.request.start', ({ request }) => scrivi(`${request.protocol}//${request.host}${request.path}`));
}
