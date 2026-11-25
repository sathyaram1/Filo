// Il passo che gira subito dopo che un pacchetto è stato impacchettato, per
// ogni sistema. Qui non c'è logica: c'è lo smistamento.
//
// electron-builder accetta UN solo `afterPack`. Su ogni sistema si spegne il
// fusibile che dà privilegi in più alle pagine file:// (lib/fusibili-electron.js);
// poi il Mac, che senza una firma locale non si apre sui chip Apple, e Linux,
// dove senza un lanciatore il doppio clic non apre niente. Ognuno sta nel suo
// file, col suo racconto.
//
// Il fusibile va per primo: la firma del Mac copre il binario già modificato, e
// il lanciatore di Linux sposta l'eseguibile dove il fusibile lo cerca.

const fusibili = require('./lib/fusibili-electron');
const mac = require('./after-pack-mac');
const linux = require('./after-pack-linux');

exports.default = async function afterPack(context) {
  await fusibili.afterPack(context);
  await mac.default(context);
  await linux.default(context);
};
