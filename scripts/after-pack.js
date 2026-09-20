// Il passo che gira subito dopo che un pacchetto è stato impacchettato, per
// ogni sistema. Qui non c'è logica: c'è lo smistamento.
//
// electron-builder accetta UN solo `afterPack`, e i sistemi che hanno qualcosa
// da fare lì adesso sono due: il Mac, che senza una firma locale non si apre
// sui chip Apple, e Linux, dove senza un lanciatore il doppio clic non apre
// niente. Ognuno sta nel suo file, col suo racconto: mischiarli renderebbe
// entrambi più difficili da leggere.
//
// Ogni passo controlla da sé su che sistema è e si tira indietro se non è il
// suo, quindi si possono chiamare tutti in fila.

const mac = require('./after-pack-mac');
const linux = require('./after-pack-linux');

exports.default = async function afterPack(context) {
  await mac.default(context);
  await linux.default(context);
};
