// La consegna con la prova accanto (#2505): tabella dei nove criteri, elementi nuovi di un lavoro sull'interfaccia,
// classe di rischio e il suo minimo dai percorsi. La stessa regola la usa il server (bake del modulo).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../src/shared/consegna.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const C = globalThis.SN_CONSEGNA;

const tabella = () => C.CRITERI.map((k) => ({ criterio: k.n, esito: 'fatto', prova: `tests/unit/caso${k.n}.test.mjs, caso «uno»` }));
const buona = (extra = {}) => ({ criteri: tabella(), classe: { valore: 'nascosto', motivo: 'Cambia la logica del canale, non i dati.' }, ...extra });
const elemento = (extra = {}) => ({ elemento: 'Riquadro Consegna', perche: 'Senza, la classe non si vede.', clic: 'apre le righe',
  destro: 'menu del riquadro', trascina: 'non serve: è un riquadro fisso', hover: 'non serve: il testo è già lì', ...extra });

test('i nove criteri del modulo sono quelli di _criteri-verifica.md, nello stesso ordine', () => {
  const md = readFileSync(resolve(ROOT, 'routines/roles/_criteri-verifica.md'), 'utf8');
  const nomi = [...md.matchAll(/^\d+\.\s+\*\*(.+?)\.?\*\*/gm)].map((m) => m[1]);
  assert.deepEqual(nomi, C.CRITERI.map((k) => k.nome));
});

test('una consegna intera passa; senza tabella, o con una riga senza prova, il rifiuto dice quale riga', () => {
  assert.deepEqual(C.validaConsegna(buona()), []);
  assert.match(C.validaConsegna({ classe: buona().classe }).join('\n'), /manca la tabella dei criteri/);
  const senzaProva = buona();
  senzaProva.criteri[2] = { criterio: 3, esito: 'fatto' };
  assert.deepEqual(C.validaConsegna(senzaProva), ['criterio 3 («Stress»): manca la prova («prova»: il nome di un test, una schermata, un elenco)']);
  const senzaRiga = buona();
  senzaRiga.criteri = senzaRiga.criteri.filter((x) => x.criterio !== 7);
  assert.deepEqual(C.validaConsegna(senzaRiga), ['criterio 7 («Pattern»): manca la riga']);
});

test('«l\'ho guardato» non è una prova; un criterio che non si applica vuole il motivo, non la prova', () => {
  const vaga = buona();
  vaga.criteri[4] = { criterio: 5, esito: 'fatto', prova: "L'ho guardato." };
  assert.match(C.validaConsegna(vaga)[0], /^criterio 5 \(«Aspetto»\): «L'ho guardato\.» non è una prova/);
  const na = buona();
  na.criteri[4] = { criterio: 5, esito: 'non si applica' };
  assert.match(C.validaConsegna(na)[0], /criterio 5 .*col motivo/);
  na.criteri[4].motivo = 'Nessuna interfaccia toccata: solo il canale.';
  assert.deepEqual(C.validaConsegna(na), []);
  const esito = buona();
  esito.criteri[0].esito = 'ok';
  assert.match(C.validaConsegna(esito)[0], /criterio 1 .*l'esito è «ok»/);
});

test('un lavoro sull\'interfaccia senza l\'elenco degli elementi nuovi è rifiutato; con l\'elenco o un «nessuno» motivato passa', () => {
  const ui = C.lavoroDiInterfaccia(['src/pages/manage/manage.js', 'tests/manage.spec.mjs', 'scripts/conta-prove.mjs']);
  assert.deepEqual(ui, ['src/pages/manage/manage.js']);
  assert.match(C.validaConsegna(buona(), { interfaccia: ui })[0], /lavoro sull'interfaccia \(tocca src\/pages\/manage\/manage\.js\): manca l'elenco/);
  assert.deepEqual(C.validaConsegna(buona({ elementi: [elemento()] }), { interfaccia: ui }), []);
  assert.match(C.validaConsegna(buona({ elementi: [elemento({ hover: '' })] }), { interfaccia: ui })[0], /elemento 1 \(«Riquadro Consegna»\): manca cosa fa hover/);
  assert.match(C.validaConsegna(buona({ elementi: [] }), { interfaccia: ui })[0], /nessunElemento/);
  assert.deepEqual(C.validaConsegna(buona({ elementi: [], nessunElemento: 'Cambia solo il colore di un bordo esistente.' }), { interfaccia: ui }), []);
  assert.deepEqual(C.validaConsegna(buona()), [], 'fuori dall\'interfaccia l\'elenco non serve');
});

test('la classe dichiarata vuole uno dei tre valori e una riga di motivo', () => {
  assert.match(C.validaConsegna(buona({ classe: { valore: 2, motivo: 'qualcosa di lungo' } }))[0], /non vale/);
  assert.match(C.validaConsegna(buona({ classe: { valore: 'visibile' } }))[0], /riga di motivo/);
  assert.match(C.validaConsegna(buona({ classe: undefined })).join('\n'), /manca la classe di rischio/);
});

test('il minimo: un ramo che tocca il formato dei dati salvati esce irreparabile; un ritocco a uno spec di sicurezza no', () => {
  const dati = C.minimoDaiPercorsi({ app: ['src/shared/storage.js', 'src/pages/home/home.js'] });
  assert.equal(dati.classe, 'irreparabile');
  assert.deepEqual(dati.zone.map((z) => z.chiave), ['dati']);
  assert.deepEqual(C.classeFinale('visibile', dati.classe), { classe: 'irreparabile', decisaDa: 'minimo' });
  const prova = C.minimoDaiPercorsi({ app: ['tests/unit/urlExfil.test.mjs', 'tests/sicurezza.spec.mjs'], server: ['functions/test/fiducia-ramo.test.js'] });
  assert.deepEqual(prova, { classe: '', zone: [] });
  assert.deepEqual(C.classeFinale('visibile', prova.classe), { classe: 'visibile', decisaDa: 'chi lavora' });
  const server = C.minimoDaiPercorsi({ server: ['functions/src/routine/mergeGate.js'] });
  assert.deepEqual(server.zone, [{ chiave: 'fusione', nome: 'chi può fondere o è fidato', percorsi: ['server: functions/src/routine/mergeGate.js'] }]);
  assert.deepEqual(C.classeFinale('irreparabile', ''), { classe: 'irreparabile', decisaDa: 'chi lavora' });
});

test('ogni zona riconosce almeno un file che esiste nel repo', async () => {
  const { execFileSync } = await import('node:child_process');
  const file = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const z of C.ZONE) {
    assert.ok(file.some((p) => z.app.some((re) => re.test(p))) || z.server.length, `la zona ${z.chiave} non riconosce nessun file dell'app`);
  }
});
