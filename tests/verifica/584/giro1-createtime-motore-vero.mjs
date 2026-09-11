// Verifica #584 giro 1 — il canale che resta: `createTime`, la marca temporale
// che Firestore mette da sé su ogni documento e restituisce a chiunque legga.
// Si parla REST esattamente come fa SN_PATHS.listByDomain, senza credenziali.
//
// È la PROVA DEL RILIEVO del giro: `createdAt` viene arrotondato all'ora dal
// client proprio perché un orario al secondo è una chiave di join fra domini
// diversi — ma `createTime` torna al lettore al microsecondo, e il client non
// può né scriverlo né sopprimerlo finché la lettura è diretta.
//
// Come sopra, vuole Java e l'emulatore: stessa cartella usa-e-getta del file
// accanto, poi
//   npx firebase emulators:exec --only firestore --project filo-createtime-584 \
//     "node /tmp/emu584/giro1-createtime-motore-vero.mjs"
//
// Esito del giro 1 (2026-09-11): due percorsi su due domini diversi, scritti a
// meno di un secondo l'uno dall'altro, hanno `createdAt` identico e
// arrotondato (2026-09-11T17:00:00Z) e `createTime` distanti 0,967 s — mentre
// un terzo percorso, di ore dopo, dista 2,5 s. Il join regge.
const HOST = 'http://127.0.0.1:8089';
const P = 'filo-createtime-584';
const BASE = `${HOST}/v1/projects/${P}/databases/(default)/documents`;

// scrittura "da utente" (passa dalle regole, nessuna credenziale: è lo stesso
// cammino della sidebar Aiuto)
const ORA = new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString();

async function scrivi(dominio, intent, initialUrl) {
  const body = { fields: {
    initialUrl: { stringValue: initialUrl },
    intent: { stringValue: intent },
    steps: { arrayValue: { values: [] } },
    success: { booleanValue: true },
    createdAt: { timestampValue: ORA },   // <- arrotondato all'ora dal client
  } };
  const r = await fetch(`${BASE}/paths/${dominio}/entries`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`write ${dominio}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function leggi(dominio) {
  const body = { structuredQuery: {
    from: [{ collectionId: 'entries' }],
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    limit: 50,
  } };
  const r = await fetch(`${BASE}/paths/${dominio}:runQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`read ${dominio}: ${r.status} ${await r.text()}`);
  return (await r.json()).filter((x) => x.document).map((x) => x.document);
}

// una sola persona, due domini diversi, nella stessa sessione
await scrivi('banca-esempio.it', 'controllare il saldo', '/conto');
await new Promise((r) => setTimeout(r, 900));
await scrivi('clinica-esempio.it', 'prenotare una visita', '/prenota');
// un'altra persona, ore dopo (simulata: stessa ora arrotondata, ma scritta molto dopo)
await new Promise((r) => setTimeout(r, 2500));
await scrivi('banca-esempio.it', 'pagare un bollettino', '/bollettini');

const banca = await leggi('banca-esempio.it');
const clinica = await leggi('clinica-esempio.it');

console.log('\nQuello che un anonimo con la sola chiave web si porta via, un dominio alla volta:\n');
for (const [nome, docs] of [['banca-esempio.it', banca], ['clinica-esempio.it', clinica]]) {
  for (const d of docs) {
    console.log(`  ${nome.padEnd(22)} intent="${d.fields.intent.stringValue}"`);
    console.log(`  ${''.padEnd(22)} createdAt (dal client, arrotondato) = ${d.fields.createdAt.timestampValue}`);
    console.log(`  ${''.padEnd(22)} createTime (messo da Firestore)     = ${d.createTime}`);
    console.log('');
  }
}

const t = (d) => new Date(d.createTime).getTime();
const coppie = [];
for (const b of banca) for (const c of clinica) coppie.push([b, c, Math.abs(t(b) - t(c))]);
coppie.sort((a, b) => a[2] - b[2]);
console.log('Distanza fra i percorsi dei due domini, secondo createTime:');
for (const [b, c, d] of coppie) {
  console.log(`  "${b.fields.intent.stringValue}" ↔ "${c.fields.intent.stringValue}" : ${(d / 1000).toFixed(3)} s`);
}
const [vicino] = coppie;
console.log(`\nRicucitura: il percorso "${vicino[0].fields.intent.stringValue}" su banca-esempio.it e`);
console.log(`"${vicino[1].fields.intent.stringValue}" su clinica-esempio.it distano ${(vicino[2] / 1000).toFixed(3)} s:`);
console.log('sono della stessa persona, nella stessa sessione. Il clientId non serve più.');
console.log(`(il percorso piu lontano dista ${(coppie[coppie.length - 1][2] / 1000).toFixed(3)} s: si distingue)`);
