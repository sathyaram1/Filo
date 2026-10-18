// Reporter di `node --test` per il lanciatore degli unit a gruppi: una riga JSON per test concluso, su file, per
// sommare i gruppi in un riepilogo solo. Non scrive su stdout (quello resta al reporter di chi guarda).
// Sentinella: tests/unit/unitRunner.test.mjs.

export default async function* riepilogoUnit(source) {
  for await (const ev of source) {
    if (ev.type !== 'test:pass' && ev.type !== 'test:fail') continue;
    const d = ev.data || {};
    yield JSON.stringify({
      esito: ev.type === 'test:pass' ? 'pass' : 'fail',
      nome: d.name, file: d.file, riga: d.line,
      suite: d.details?.type === 'suite',
      causa: d.details?.error?.failureType || null,
      skip: !!d.skip, todo: !!d.todo,
    }) + '\n';
  }
}
