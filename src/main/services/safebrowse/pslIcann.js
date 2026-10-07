// Le regole della sezione ICANN della Public Suffix List (publicsuffix.org) con più di un'etichetta, in ASCII
// (punycode): ogni riga è un dominio di primo livello seguito dalle regole sotto di lui, `*` jolly e `!` eccezione
// (`jp chiyoda.tokyo *.kawasaki !city.kawasaki`). Dati, non logica: li legge solo safebrowse/psl.js. Si rigenera intera.

'use strict';

module.exports = `
ac com edu gov mil net org
ae ac co gov mil net org sch
aero airline airport accident-investigation accident-prevention aerobatic aeroclub aerodrome agents air-surveillance
aero air-traffic-control aircraft airtraffic ambulance association author ballooning broker caa cargo catering
aero certification championship charter civilaviation club conference consultant consulting control council crew
aero design dgca educator emergency engine engineer entertainment equipment exchange express federation flight freight
aero fuel gliding government groundhandling group hanggliding homebuilt insurance journal journalist leasing logistics
aero magazine maintenance marketplace media microlight modelling navigation parachuting paragliding
aero passenger-association pilot press production recreation repbody res research rotorcraft safety scientist services
aero show skydiving software student taxi trader trading trainer union workinggroup works
af com edu gov net org
ag co com net nom org
ai com net off org
al com edu gov mil net org
am co com commune net org
ao co ed edu gov gv it og org pb
ar bet com coop edu gob gov int mil musica mutual net org seg senasa tur
arpa e164 home in-addr ip6 iris uri urn
as gov
at ac sth.ac co gv or
au asn com edu gov id net org conf oz act nsw nt qld sa tas vic wa act.edu catholic.edu nsw.edu nt.edu qld.edu sa.edu
au tas.edu vic.edu wa.edu qld.gov sa.gov tas.gov vic.gov wa.gov
aw com
az biz co com edu gov info int mil name net org pp pro
ba com edu gov mil net org
bb biz co com edu gov info net org store tv
bd ac ai co com edu gov id info it mil net org sch tv
be ac
bf gov
bg 0.0.0.0 0.0.0.1 0.0.0.2 0.0.0.3 0.0.0.4 0.0.0.5 0.0.0.6 0.0.0.7 0.0.0.8 0.0.0.9 a b c d e f g h i j k l m n o p q r
bg s t u v w x y z
bh com edu gov net org
bi co com edu or org
bj africa agro architectes assur avocats co com eco econo edu info loisirs money net org ote restaurant resto tourism
bj univ
bm com edu gov net org
bn com edu gov net org
bo com edu gob int mil net org tv web academia agro arte blog bolivia ciencia cooperativa democracia deporte ecologia
bo economia empresa ia indigena industria info medicina movimiento musica natural nombre noticias patria plurinacional
bo politica profesional pueblo revista salud tecnologia tksat transporte wiki
br 9guacu abc adm adv agr aju am anani aparecida api app arq art ato b barueri belem bet bhz bib bio blog bmd boavista
br bsb campinagrande campinas caxias cim cng cnt com contagem coop coz cri cuiaba curitiba def des det dev ecn eco edu
br emp enf eng esp etc eti far feira flog floripa fm fnd fortal fot foz fst g12 geo ggf goiania gov ac.gov al.gov
br am.gov ap.gov ba.gov ce.gov df.gov es.gov go.gov ma.gov mg.gov ms.gov mt.gov pa.gov pb.gov pe.gov pi.gov pr.gov
br rj.gov rn.gov ro.gov rr.gov rs.gov sc.gov se.gov sp.gov to.gov gru ia imb ind inf jab jampa jdf joinville jor jus
br leg leilao lel log londrina macapa maceio manaus maringa mat med mil morena mp mus natal net niteroi *.nom not ntr
br odo ong org osasco palmas poa ppg pro psc psi pvh qsl radio rec recife rep ribeirao rio riobranco riopreto salvador
br sampa santamaria santoandre saobernardo saogonca seg sjc slg slz social sorocaba srv taxi tc tec teo the tmp trd
br tur tv udi vet vix vlog wiki xyz zlg
bs com edu gov net org
bt com edu gov net org
bw ac co gov net org
by gov mil com of
bz co com edu gov net org
ca ab bc mb nb nf nl ns nt nu on pe qc sk yk gc
cd gov
ci ac xn--aroport-bya asso co com ed edu go gouv int net or org
ck * !www
cl co gob gov mil
cm co com gov net
cn ac com edu gov mil net org xn--55qx5d xn--od0alg xn--io0a7i ah bj cq fj gd gs gx gz ha hb he hi hk hl hn jl js jx
cn ln mo nm nx qh sc sd sh sn sx tj tw xj xz yn zj
co com edu gov mil net nom org
cr ac co ed fi go or sa
cu com edu gob inf nat net org
cv com edu id int net nome org publ
cw com edu net org
cx gov
cy ac biz com ekloges gov ltd mil net org press pro tm
cz gov
dm co com edu gov net org
do art com edu gob gov mil net org sld web
dz art asso com edu gov net org pol soc tm
ec abg adm agron arqt art bar chef com cont cpa cue dent dgn disco doc edu eng esm fin fot gal gob gov gye ibr info
ec k12 lat loj med mil mktg mon net ntr odont org pro prof psic psiq pub rio rrpp sal tech tul tur uio vet xxx
ee aip com edu fie gov lib med org pri riik
eg ac com edu eun gov info me mil name net org sci sport tv
er *
es com edu gob nom org
et biz com edu gov info name net org
fi aland
fj ac biz com edu gov id info mil name net org pro
fk *
fm com edu net org
fr asso com gouv nom prd tm avoues cci greta huissier-justice
gd edu gov
ge com cyb edu gov llc net online org pvt school tnx
gg co net org
gh biz com edu gov mil net org
gi com edu gov ltd mod org
gl co com edu net org
gn ac com edu gov net org
gp asso com edu mobi net org
gr com edu gov net org
gt com edu gob ind mil net org
gu com edu gov guam info net org web
gy co com edu gov net org
hk com edu gov idv net org xn--ciqpn xn--gmqw5a xn--55qx5d xn--mxtq1m xn--lcvr32d xn--wcvs22d xn--gmq050i xn--uc0atv
hk xn--uc0ay4a xn--od0alg xn--zf0avx xn--mk0axi xn--tn0ag xn--od0aq3b xn--io0a7i
hn com edu gob mil net org
hr com from iz name
ht adult art asso com coop edu firm gouv info med net org perso pol pro rel shop
hu 0.0.7.208 agrar bolt casino city co erotica erotika film forum games hotel info ingatlan jogasz konyvelo lakas
hu media news org priv reklam sex shop sport suli szex tm tozsde utazas video
id ac ai biz co desa go kop mil my net or ponpes sch web xn--9tfky
ie gov
il ac co gov idf k12 muni net org
xn--4dbrk0ce xn--4dbgdty6c xn--5dbhl8d xn--8dbq2a xn--hebda8b
im ac co ltd.co plc.co com net org tt tv
in 5g 6g ac aero ai alumni am bank bihar biz business ca cn co com coop cs delhi dr edu er fin firm gen gov gujarat
in ind info int internet io me mil net nic org pg post pro res school travel tv ub uk up us
int eu
io co com edu gov mil net nom org
iq com edu gov mil net org
ir ac co gov id net org sch xn--mgba3a4f16a xn--mgba3a4fra
it edu gov abr abruzzo aosta-valley aostavalley bas basilicata cal calabria cam campania emilia-romagna emiliaromagna
it emr friuli-v-giulia friuli-ve-giulia friuli-vegiulia friuli-venezia-giulia friuli-veneziagiulia friuli-vgiulia
it friuliv-giulia friulive-giulia friulivegiulia friulivenezia-giulia friuliveneziagiulia friulivgiulia fvg laz lazio
it lig liguria lom lombardia lombardy lucania mar marche mol molise piedmont piemonte pmn pug puglia sar sardegna
it sardinia sic sicilia sicily taa tos toscana trentin-sud-tirol xn--trentin-sd-tirol-rzb trentin-sudtirol
it xn--trentin-sdtirol-7vb trentin-sued-tirol trentin-suedtirol trentino-a-adige trentino-aadige trentino-alto-adige
it trentino-altoadige trentino-s-tirol trentino-stirol trentino-sud-tirol xn--trentino-sd-tirol-c3b trentino-sudtirol
it xn--trentino-sdtirol-szb trentino-sued-tirol trentino-suedtirol trentinoa-adige trentinoaadige trentinoalto-adige
it trentinoaltoadige trentinos-tirol trentinostirol trentinosud-tirol xn--trentinosd-tirol-rzb xn--trentinosdtirol-7vb
it trentinosued-tirol trentinosuedtirol trentinsud-tirol xn--trentinsd-tirol-6vb trentinsudtirol
it xn--trentinsdtirol-nsb trentinsued-tirol trentinsuedtirol tuscany umb umbria val-d-aosta val-daosta vald-aosta
it valle-aosta valle-d-aosta valle-daosta valleaosta valled-aosta valledaosta vallee-aoste xn--valle-aoste-ebb
it vallee-d-aoste xn--valle-d-aoste-ehb valleeaoste xn--valleaoste-e7a valleedaoste xn--valledaoste-ebb vao vda ven
it veneto ag agrigento al alessandria alto-adige altoadige an ancona andria-barletta-trani andria-trani-barletta
it andriabarlettatrani andriatranibarletta ao aosta aoste ap aq ar arezzo ascoli-piceno ascolipiceno asti at av
it avellino ba balsan balsan-sudtirol xn--balsan-sdtirol-nsb balsan-suedtirol bari barletta-trani-andria
it barlettatraniandria belluno benevento bergamo bg bi biella bl bn bo bologna bolzano bolzano-altoadige bozen
it bozen-sudtirol xn--bozen-sdtirol-2ob bozen-suedtirol br brescia brindisi bs bt bulsan bulsan-sudtirol
it xn--bulsan-sdtirol-nsb bulsan-suedtirol bz ca cagliari caltanissetta campidano-medio campidanomedio campobasso
it carbonia-iglesias carboniaiglesias carrara-massa carraramassa caserta catania catanzaro cb ce cesena-forli
it xn--cesena-forl-mcb cesenaforli xn--cesenaforl-i8a ch chieti ci cl cn co como cosenza cr cremona crotone cs ct
it cuneo cz dell-ogliastra dellogliastra en enna fc fe fermo ferrara fg fi firenze florence fm foggia forli-cesena
it xn--forl-cesena-fcb forlicesena xn--forlcesena-c8a fr frosinone ge genoa genova go gorizia gr grosseto
it iglesias-carbonia iglesiascarbonia im imperia is isernia kr la-spezia laquila laspezia latina lc le lecce lecco li
it livorno lo lodi lt lu lucca macerata mantova massa-carrara massacarrara matera mb mc me medio-campidano
it mediocampidano messina mi milan milano mn mo modena monza monza-brianza monza-e-della-brianza monzabrianza
it monzaebrianza monzaedellabrianza ms mt na naples napoli no novara nu nuoro og ogliastra olbia-tempio olbiatempio or
it oristano ot pa padova padua palermo parma pavia pc pd pe perugia pesaro-urbino pesarourbino pescara pg pi piacenza
it pisa pistoia pn po pordenone potenza pr prato pt pu pv pz ra ragusa ravenna rc re reggio-calabria reggio-emilia
it reggiocalabria reggioemilia rg ri rieti rimini rm rn ro roma rome rovigo sa salerno sassari savona si siena
it siracusa so sondrio sp sr ss su sud-sardegna sudsardegna xn--sdtirol-n2a suedtirol sv ta taranto te tempio-olbia
it tempioolbia teramo terni tn to torino tp tr trani-andria-barletta trani-barletta-andria traniandriabarletta
it tranibarlettaandria trapani trentino trento treviso trieste ts turin tv ud udine urbino-pesaro urbinopesaro va
it varese vb vc ve venezia venice verbania verbano-cusio-ossola vercelli verona vi vibo-valentia vibovalentia vicenza
it viterbo vr vs vt vv
je co net org
jm *
jo agri ai com edu eng fm gov mil net org per phd sch tv
jp ac ad co ed go gr lg ne or aichi akita aomori chiba ehime fukui fukuoka fukushima gifu gunma hiroshima hokkaido
jp hyogo ibaraki ishikawa iwate kagawa kagoshima kanagawa kochi kumamoto kyoto mie miyagi miyazaki nagano nagasaki
jp nara niigata oita okayama okinawa osaka saga saitama shiga shimane shizuoka tochigi tokushima tokyo tottori toyama
jp wakayama yamagata yamaguchi yamanashi xn--ehqz56n xn--1lqs03n xn--qqqt11m xn--f6qx53a xn--djrs72d6uy xn--mkru45i
jp xn--0trq7p7nn xn--5js045d xn--kbrq7o xn--pssu33l xn--ntsq17g xn--uisz3g xn--6btw5a xn--1ctwo xn--6orx2r xn--rht61e
jp xn--rht27z xn--nit225k xn--rht3d xn--djty4k xn--klty5x xn--kltx9a xn--kltp7d xn--c3s14m xn--vgu402c xn--efvn9s
jp xn--1lqs71d xn--4pvxs xn--uuwu58a xn--zbx025d xn--8pvr4u xn--5rtp49c xn--ntso0iqx3a xn--elqq16h xn--4it168d
jp xn--klt787d xn--rny31h xn--7t0a264c xn--uist22h xn--8ltr62k xn--2m4a15e xn--32vp30h xn--4it797k xn--5rtq34k
jp xn--k7yn95e xn--tor131o xn--d5qv7z876c *.kawasaki !city.kawasaki *.kitakyushu !city.kitakyushu *.kobe !city.kobe
jp *.nagoya !city.nagoya *.sapporo !city.sapporo *.sendai !city.sendai *.yokohama !city.yokohama aisai.aichi ama.aichi
jp anjo.aichi asuke.aichi chiryu.aichi chita.aichi fuso.aichi gamagori.aichi handa.aichi hazu.aichi hekinan.aichi
jp higashiura.aichi ichinomiya.aichi inazawa.aichi inuyama.aichi isshiki.aichi iwakura.aichi kanie.aichi kariya.aichi
jp kasugai.aichi kira.aichi kiyosu.aichi komaki.aichi konan.aichi kota.aichi mihama.aichi miyoshi.aichi nishio.aichi
jp nisshin.aichi obu.aichi oguchi.aichi oharu.aichi okazaki.aichi owariasahi.aichi seto.aichi shikatsu.aichi
jp shinshiro.aichi shitara.aichi tahara.aichi takahama.aichi tobishima.aichi toei.aichi togo.aichi tokai.aichi
jp tokoname.aichi toyoake.aichi toyohashi.aichi toyokawa.aichi toyone.aichi toyota.aichi tsushima.aichi yatomi.aichi
jp akita.akita daisen.akita fujisato.akita gojome.akita hachirogata.akita happou.akita higashinaruse.akita honjo.akita
jp honjyo.akita ikawa.akita kamikoani.akita kamioka.akita katagami.akita kazuno.akita kitaakita.akita kosaka.akita
jp kyowa.akita misato.akita mitane.akita moriyoshi.akita nikaho.akita noshiro.akita odate.akita oga.akita ogata.akita
jp semboku.akita yokote.akita yurihonjo.akita aomori.aomori gonohe.aomori hachinohe.aomori hashikami.aomori
jp hiranai.aomori hirosaki.aomori itayanagi.aomori kuroishi.aomori misawa.aomori mutsu.aomori nakadomari.aomori
jp noheji.aomori oirase.aomori owani.aomori rokunohe.aomori sannohe.aomori shichinohe.aomori shingo.aomori
jp takko.aomori towada.aomori tsugaru.aomori tsuruta.aomori abiko.chiba asahi.chiba chonan.chiba chosei.chiba
jp choshi.chiba chuo.chiba funabashi.chiba futtsu.chiba hanamigawa.chiba ichihara.chiba ichikawa.chiba
jp ichinomiya.chiba inzai.chiba isumi.chiba kamagaya.chiba kamogawa.chiba kashiwa.chiba katori.chiba katsuura.chiba
jp kimitsu.chiba kisarazu.chiba kozaki.chiba kujukuri.chiba kyonan.chiba matsudo.chiba midori.chiba mihama.chiba
jp minamiboso.chiba mobara.chiba mutsuzawa.chiba nagara.chiba nagareyama.chiba narashino.chiba narita.chiba noda.chiba
jp oamishirasato.chiba omigawa.chiba onjuku.chiba otaki.chiba sakae.chiba sakura.chiba shimofusa.chiba shirako.chiba
jp shiroi.chiba shisui.chiba sodegaura.chiba sosa.chiba tako.chiba tateyama.chiba togane.chiba tohnosho.chiba
jp tomisato.chiba urayasu.chiba yachimata.chiba yachiyo.chiba yokaichiba.chiba yokoshibahikari.chiba yotsukaido.chiba
jp ainan.ehime honai.ehime ikata.ehime imabari.ehime iyo.ehime kamijima.ehime kihoku.ehime kumakogen.ehime
jp masaki.ehime matsuno.ehime matsuyama.ehime namikata.ehime niihama.ehime ozu.ehime saijo.ehime seiyo.ehime
jp shikokuchuo.ehime tobe.ehime toon.ehime uchiko.ehime uwajima.ehime yawatahama.ehime echizen.fukui eiheiji.fukui
jp fukui.fukui ikeda.fukui katsuyama.fukui mihama.fukui minamiechizen.fukui obama.fukui ohi.fukui ono.fukui
jp sabae.fukui sakai.fukui takahama.fukui tsuruga.fukui wakasa.fukui ashiya.fukuoka buzen.fukuoka chikugo.fukuoka
jp chikuho.fukuoka chikujo.fukuoka chikushino.fukuoka chikuzen.fukuoka chuo.fukuoka dazaifu.fukuoka fukuchi.fukuoka
jp hakata.fukuoka higashi.fukuoka hirokawa.fukuoka hisayama.fukuoka iizuka.fukuoka inatsuki.fukuoka kaho.fukuoka
jp kasuga.fukuoka kasuya.fukuoka kawara.fukuoka keisen.fukuoka koga.fukuoka kurate.fukuoka kurogi.fukuoka
jp kurume.fukuoka minami.fukuoka miyako.fukuoka miyama.fukuoka miyawaka.fukuoka mizumaki.fukuoka munakata.fukuoka
jp nakagawa.fukuoka nakama.fukuoka nishi.fukuoka nogata.fukuoka ogori.fukuoka okagaki.fukuoka okawa.fukuoka
jp oki.fukuoka omuta.fukuoka onga.fukuoka onojo.fukuoka oto.fukuoka saigawa.fukuoka sasaguri.fukuoka shingu.fukuoka
jp shinyoshitomi.fukuoka shonai.fukuoka soeda.fukuoka sue.fukuoka tachiarai.fukuoka tagawa.fukuoka takata.fukuoka
jp toho.fukuoka toyotsu.fukuoka tsuiki.fukuoka ukiha.fukuoka umi.fukuoka usui.fukuoka yamada.fukuoka yame.fukuoka
jp yanagawa.fukuoka yukuhashi.fukuoka aizubange.fukushima aizumisato.fukushima aizuwakamatsu.fukushima
jp asakawa.fukushima bandai.fukushima date.fukushima fukushima.fukushima furudono.fukushima futaba.fukushima
jp hanawa.fukushima higashi.fukushima hirata.fukushima hirono.fukushima iitate.fukushima inawashiro.fukushima
jp ishikawa.fukushima iwaki.fukushima izumizaki.fukushima kagamiishi.fukushima kaneyama.fukushima kawamata.fukushima
jp kitakata.fukushima kitashiobara.fukushima koori.fukushima koriyama.fukushima kunimi.fukushima miharu.fukushima
jp mishima.fukushima namie.fukushima nango.fukushima nishiaizu.fukushima nishigo.fukushima okuma.fukushima
jp omotego.fukushima ono.fukushima otama.fukushima samegawa.fukushima shimogo.fukushima shirakawa.fukushima
jp showa.fukushima soma.fukushima sukagawa.fukushima taishin.fukushima tamakawa.fukushima tanagura.fukushima
jp tenei.fukushima yabuki.fukushima yamato.fukushima yamatsuri.fukushima yanaizu.fukushima yugawa.fukushima
jp anpachi.gifu ena.gifu gifu.gifu ginan.gifu godo.gifu gujo.gifu hashima.gifu hichiso.gifu hida.gifu
jp higashishirakawa.gifu ibigawa.gifu ikeda.gifu kakamigahara.gifu kani.gifu kasahara.gifu kasamatsu.gifu kawaue.gifu
jp kitagata.gifu mino.gifu minokamo.gifu mitake.gifu mizunami.gifu motosu.gifu nakatsugawa.gifu ogaki.gifu
jp sakahogi.gifu seki.gifu sekigahara.gifu shirakawa.gifu tajimi.gifu takayama.gifu tarui.gifu toki.gifu tomika.gifu
jp wanouchi.gifu yamagata.gifu yaotsu.gifu yoro.gifu annaka.gunma chiyoda.gunma fujioka.gunma higashiagatsuma.gunma
jp isesaki.gunma itakura.gunma kanna.gunma kanra.gunma katashina.gunma kawaba.gunma kiryu.gunma kusatsu.gunma
jp maebashi.gunma meiwa.gunma midori.gunma minakami.gunma naganohara.gunma nakanojo.gunma nanmoku.gunma numata.gunma
jp oizumi.gunma ora.gunma ota.gunma shibukawa.gunma shimonita.gunma shinto.gunma showa.gunma takasaki.gunma
jp takayama.gunma tamamura.gunma tatebayashi.gunma tomioka.gunma tsukiyono.gunma tsumagoi.gunma ueno.gunma
jp yoshioka.gunma asaminami.hiroshima daiwa.hiroshima etajima.hiroshima fuchu.hiroshima fukuyama.hiroshima
jp hatsukaichi.hiroshima higashihiroshima.hiroshima hongo.hiroshima jinsekikogen.hiroshima kaita.hiroshima
jp kui.hiroshima kumano.hiroshima kure.hiroshima mihara.hiroshima miyoshi.hiroshima naka.hiroshima onomichi.hiroshima
jp osakikamijima.hiroshima otake.hiroshima saka.hiroshima sera.hiroshima seranishi.hiroshima shinichi.hiroshima
jp shobara.hiroshima takehara.hiroshima abashiri.hokkaido abira.hokkaido aibetsu.hokkaido akabira.hokkaido
jp akkeshi.hokkaido asahikawa.hokkaido ashibetsu.hokkaido ashoro.hokkaido assabu.hokkaido atsuma.hokkaido
jp bibai.hokkaido biei.hokkaido bifuka.hokkaido bihoro.hokkaido biratori.hokkaido chippubetsu.hokkaido
jp chitose.hokkaido date.hokkaido ebetsu.hokkaido embetsu.hokkaido eniwa.hokkaido erimo.hokkaido esan.hokkaido
jp esashi.hokkaido fukagawa.hokkaido fukushima.hokkaido furano.hokkaido furubira.hokkaido haboro.hokkaido
jp hakodate.hokkaido hamatonbetsu.hokkaido hidaka.hokkaido higashikagura.hokkaido higashikawa.hokkaido hiroo.hokkaido
jp hokuryu.hokkaido hokuto.hokkaido honbetsu.hokkaido horokanai.hokkaido horonobe.hokkaido ikeda.hokkaido
jp imakane.hokkaido ishikari.hokkaido iwamizawa.hokkaido iwanai.hokkaido kamifurano.hokkaido kamikawa.hokkaido
jp kamishihoro.hokkaido kamisunagawa.hokkaido kamoenai.hokkaido kayabe.hokkaido kembuchi.hokkaido kikonai.hokkaido
jp kimobetsu.hokkaido kitahiroshima.hokkaido kitami.hokkaido kiyosato.hokkaido koshimizu.hokkaido kunneppu.hokkaido
jp kuriyama.hokkaido kuromatsunai.hokkaido kushiro.hokkaido kutchan.hokkaido kyowa.hokkaido mashike.hokkaido
jp matsumae.hokkaido mikasa.hokkaido minamifurano.hokkaido mombetsu.hokkaido moseushi.hokkaido mukawa.hokkaido
jp muroran.hokkaido naie.hokkaido nakagawa.hokkaido nakasatsunai.hokkaido nakatombetsu.hokkaido nanae.hokkaido
jp nanporo.hokkaido nayoro.hokkaido nemuro.hokkaido niikappu.hokkaido niki.hokkaido nishiokoppe.hokkaido
jp noboribetsu.hokkaido numata.hokkaido obihiro.hokkaido obira.hokkaido oketo.hokkaido okoppe.hokkaido otaru.hokkaido
jp otobe.hokkaido otofuke.hokkaido otoineppu.hokkaido oumu.hokkaido ozora.hokkaido pippu.hokkaido rankoshi.hokkaido
jp rebun.hokkaido rikubetsu.hokkaido rishiri.hokkaido rishirifuji.hokkaido saroma.hokkaido sarufutsu.hokkaido
jp shakotan.hokkaido shari.hokkaido shibecha.hokkaido shibetsu.hokkaido shikabe.hokkaido shikaoi.hokkaido
jp shimamaki.hokkaido shimizu.hokkaido shimokawa.hokkaido shinshinotsu.hokkaido shintoku.hokkaido shiranuka.hokkaido
jp shiraoi.hokkaido shiriuchi.hokkaido sobetsu.hokkaido sunagawa.hokkaido taiki.hokkaido takasu.hokkaido
jp takikawa.hokkaido takinoue.hokkaido teshikaga.hokkaido tobetsu.hokkaido tohma.hokkaido tomakomai.hokkaido
jp tomari.hokkaido toya.hokkaido toyako.hokkaido toyotomi.hokkaido toyoura.hokkaido tsubetsu.hokkaido
jp tsukigata.hokkaido urakawa.hokkaido urausu.hokkaido uryu.hokkaido utashinai.hokkaido wakkanai.hokkaido
jp wassamu.hokkaido yakumo.hokkaido yoichi.hokkaido aioi.hyogo akashi.hyogo ako.hyogo amagasaki.hyogo aogaki.hyogo
jp asago.hyogo ashiya.hyogo awaji.hyogo fukusaki.hyogo goshiki.hyogo harima.hyogo himeji.hyogo ichikawa.hyogo
jp inagawa.hyogo itami.hyogo kakogawa.hyogo kamigori.hyogo kamikawa.hyogo kasai.hyogo kasuga.hyogo kawanishi.hyogo
jp miki.hyogo minamiawaji.hyogo nishinomiya.hyogo nishiwaki.hyogo ono.hyogo sanda.hyogo sannan.hyogo sasayama.hyogo
jp sayo.hyogo shingu.hyogo shinonsen.hyogo shiso.hyogo sumoto.hyogo taishi.hyogo taka.hyogo takarazuka.hyogo
jp takasago.hyogo takino.hyogo tamba.hyogo tatsuno.hyogo toyooka.hyogo yabu.hyogo yashiro.hyogo yoka.hyogo
jp yokawa.hyogo ami.ibaraki asahi.ibaraki bando.ibaraki chikusei.ibaraki daigo.ibaraki fujishiro.ibaraki
jp hitachi.ibaraki hitachinaka.ibaraki hitachiomiya.ibaraki hitachiota.ibaraki ibaraki.ibaraki ina.ibaraki
jp inashiki.ibaraki itako.ibaraki iwama.ibaraki joso.ibaraki kamisu.ibaraki kasama.ibaraki kashima.ibaraki
jp kasumigaura.ibaraki koga.ibaraki miho.ibaraki mito.ibaraki moriya.ibaraki naka.ibaraki namegata.ibaraki
jp oarai.ibaraki ogawa.ibaraki omitama.ibaraki ryugasaki.ibaraki sakai.ibaraki sakuragawa.ibaraki shimodate.ibaraki
jp shimotsuma.ibaraki shirosato.ibaraki sowa.ibaraki suifu.ibaraki takahagi.ibaraki tamatsukuri.ibaraki tokai.ibaraki
jp tomobe.ibaraki tone.ibaraki toride.ibaraki tsuchiura.ibaraki tsukuba.ibaraki uchihara.ibaraki ushiku.ibaraki
jp yachiyo.ibaraki yamagata.ibaraki yawara.ibaraki yuki.ibaraki anamizu.ishikawa hakui.ishikawa hakusan.ishikawa
jp kaga.ishikawa kahoku.ishikawa kanazawa.ishikawa kawakita.ishikawa komatsu.ishikawa nakanoto.ishikawa nanao.ishikawa
jp nomi.ishikawa nonoichi.ishikawa noto.ishikawa shika.ishikawa suzu.ishikawa tsubata.ishikawa tsurugi.ishikawa
jp uchinada.ishikawa wajima.ishikawa fudai.iwate fujisawa.iwate hanamaki.iwate hiraizumi.iwate hirono.iwate
jp ichinohe.iwate ichinoseki.iwate iwaizumi.iwate iwate.iwate joboji.iwate kamaishi.iwate kanegasaki.iwate
jp karumai.iwate kawai.iwate kitakami.iwate kuji.iwate kunohe.iwate kuzumaki.iwate miyako.iwate mizusawa.iwate
jp morioka.iwate ninohe.iwate noda.iwate ofunato.iwate oshu.iwate otsuchi.iwate rikuzentakata.iwate shiwa.iwate
jp shizukuishi.iwate sumita.iwate tanohata.iwate tono.iwate yahaba.iwate yamada.iwate ayagawa.kagawa
jp higashikagawa.kagawa kanonji.kagawa kotohira.kagawa manno.kagawa marugame.kagawa mitoyo.kagawa naoshima.kagawa
jp sanuki.kagawa tadotsu.kagawa takamatsu.kagawa tonosho.kagawa uchinomi.kagawa utazu.kagawa zentsuji.kagawa
jp akune.kagoshima amami.kagoshima hioki.kagoshima isa.kagoshima isen.kagoshima izumi.kagoshima kagoshima.kagoshima
jp kanoya.kagoshima kawanabe.kagoshima kinko.kagoshima kouyama.kagoshima makurazaki.kagoshima matsumoto.kagoshima
jp minamitane.kagoshima nakatane.kagoshima nishinoomote.kagoshima satsumasendai.kagoshima soo.kagoshima
jp tarumizu.kagoshima yusui.kagoshima aikawa.kanagawa atsugi.kanagawa ayase.kanagawa chigasaki.kanagawa ebina.kanagawa
jp fujisawa.kanagawa hadano.kanagawa hakone.kanagawa hiratsuka.kanagawa isehara.kanagawa kaisei.kanagawa
jp kamakura.kanagawa kiyokawa.kanagawa matsuda.kanagawa minamiashigara.kanagawa miura.kanagawa nakai.kanagawa
jp ninomiya.kanagawa odawara.kanagawa oi.kanagawa oiso.kanagawa sagamihara.kanagawa samukawa.kanagawa tsukui.kanagawa
jp yamakita.kanagawa yamato.kanagawa yokosuka.kanagawa yugawara.kanagawa zama.kanagawa zushi.kanagawa aki.kochi
jp geisei.kochi hidaka.kochi higashitsuno.kochi ino.kochi kagami.kochi kami.kochi kitagawa.kochi kochi.kochi
jp mihara.kochi motoyama.kochi muroto.kochi nahari.kochi nakamura.kochi nankoku.kochi nishitosa.kochi niyodogawa.kochi
jp ochi.kochi okawa.kochi otoyo.kochi otsuki.kochi sakawa.kochi sukumo.kochi susaki.kochi tosa.kochi tosashimizu.kochi
jp toyo.kochi tsuno.kochi umaji.kochi yasuda.kochi yusuhara.kochi amakusa.kumamoto arao.kumamoto aso.kumamoto
jp choyo.kumamoto gyokuto.kumamoto kamiamakusa.kumamoto kikuchi.kumamoto kumamoto.kumamoto mashiki.kumamoto
jp mifune.kumamoto minamata.kumamoto minamioguni.kumamoto nagasu.kumamoto nishihara.kumamoto oguni.kumamoto
jp ozu.kumamoto sumoto.kumamoto takamori.kumamoto uki.kumamoto uto.kumamoto yamaga.kumamoto yamato.kumamoto
jp yatsushiro.kumamoto ayabe.kyoto fukuchiyama.kyoto higashiyama.kyoto ide.kyoto ine.kyoto joyo.kyoto kameoka.kyoto
jp kamo.kyoto kita.kyoto kizu.kyoto kumiyama.kyoto kyotamba.kyoto kyotanabe.kyoto kyotango.kyoto maizuru.kyoto
jp minami.kyoto minamiyamashiro.kyoto miyazu.kyoto muko.kyoto nagaokakyo.kyoto nakagyo.kyoto nantan.kyoto
jp oyamazaki.kyoto sakyo.kyoto seika.kyoto tanabe.kyoto uji.kyoto ujitawara.kyoto wazuka.kyoto yamashina.kyoto
jp yawata.kyoto asahi.mie inabe.mie ise.mie kameyama.mie kawagoe.mie kiho.mie kisosaki.mie kiwa.mie komono.mie
jp kumano.mie kuwana.mie matsusaka.mie meiwa.mie mihama.mie minamiise.mie misugi.mie miyama.mie nabari.mie shima.mie
jp suzuka.mie tado.mie taiki.mie taki.mie tamaki.mie toba.mie tsu.mie udono.mie ureshino.mie watarai.mie yokkaichi.mie
jp furukawa.miyagi higashimatsushima.miyagi ishinomaki.miyagi iwanuma.miyagi kakuda.miyagi kami.miyagi kawasaki.miyagi
jp marumori.miyagi matsushima.miyagi minamisanriku.miyagi misato.miyagi murata.miyagi natori.miyagi ogawara.miyagi
jp ohira.miyagi onagawa.miyagi osaki.miyagi rifu.miyagi semine.miyagi shibata.miyagi shichikashuku.miyagi
jp shikama.miyagi shiogama.miyagi shiroishi.miyagi tagajo.miyagi taiwa.miyagi tome.miyagi tomiya.miyagi wakuya.miyagi
jp watari.miyagi yamamoto.miyagi zao.miyagi aya.miyazaki ebino.miyazaki gokase.miyazaki hyuga.miyazaki
jp kadogawa.miyazaki kawaminami.miyazaki kijo.miyazaki kitagawa.miyazaki kitakata.miyazaki kitaura.miyazaki
jp kobayashi.miyazaki kunitomi.miyazaki kushima.miyazaki mimata.miyazaki miyakonojo.miyazaki miyazaki.miyazaki
jp morotsuka.miyazaki nichinan.miyazaki nishimera.miyazaki nobeoka.miyazaki saito.miyazaki shiiba.miyazaki
jp shintomi.miyazaki takaharu.miyazaki takanabe.miyazaki takazaki.miyazaki tsuno.miyazaki achi.nagano agematsu.nagano
jp anan.nagano aoki.nagano asahi.nagano azumino.nagano chikuhoku.nagano chikuma.nagano chino.nagano fujimi.nagano
jp hakuba.nagano hara.nagano hiraya.nagano iida.nagano iijima.nagano iiyama.nagano iizuna.nagano ikeda.nagano
jp ikusaka.nagano ina.nagano karuizawa.nagano kawakami.nagano kiso.nagano kisofukushima.nagano kitaaiki.nagano
jp komagane.nagano komoro.nagano matsukawa.nagano matsumoto.nagano miasa.nagano minamiaiki.nagano minamimaki.nagano
jp minamiminowa.nagano minowa.nagano miyada.nagano miyota.nagano mochizuki.nagano nagano.nagano nagawa.nagano
jp nagiso.nagano nakagawa.nagano nakano.nagano nozawaonsen.nagano obuse.nagano ogawa.nagano okaya.nagano omachi.nagano
jp omi.nagano ookuwa.nagano ooshika.nagano otaki.nagano otari.nagano sakae.nagano sakaki.nagano saku.nagano
jp sakuho.nagano shimosuwa.nagano shinanomachi.nagano shiojiri.nagano suwa.nagano suzaka.nagano takagi.nagano
jp takamori.nagano takayama.nagano tateshina.nagano tatsuno.nagano togakushi.nagano togura.nagano tomi.nagano
jp ueda.nagano wada.nagano yamagata.nagano yamanouchi.nagano yasaka.nagano yasuoka.nagano chijiwa.nagasaki
jp futsu.nagasaki goto.nagasaki hasami.nagasaki hirado.nagasaki iki.nagasaki isahaya.nagasaki kawatana.nagasaki
jp kuchinotsu.nagasaki matsuura.nagasaki nagasaki.nagasaki obama.nagasaki omura.nagasaki oseto.nagasaki
jp saikai.nagasaki sasebo.nagasaki seihi.nagasaki shimabara.nagasaki shinkamigoto.nagasaki togitsu.nagasaki
jp tsushima.nagasaki unzen.nagasaki ando.nara gose.nara heguri.nara higashiyoshino.nara ikaruga.nara ikoma.nara
jp kamikitayama.nara kanmaki.nara kashiba.nara kashihara.nara katsuragi.nara kawai.nara kawakami.nara kawanishi.nara
jp koryo.nara kurotaki.nara mitsue.nara miyake.nara nara.nara nosegawa.nara oji.nara ouda.nara oyodo.nara sakurai.nara
jp sango.nara shimoichi.nara shimokitayama.nara shinjo.nara soni.nara takatori.nara tawaramoto.nara tenkawa.nara
jp tenri.nara uda.nara yamatokoriyama.nara yamatotakada.nara yamazoe.nara yoshino.nara aga.niigata agano.niigata
jp gosen.niigata itoigawa.niigata izumozaki.niigata joetsu.niigata kamo.niigata kariwa.niigata kashiwazaki.niigata
jp minamiuonuma.niigata mitsuke.niigata muika.niigata murakami.niigata myoko.niigata nagaoka.niigata niigata.niigata
jp ojiya.niigata omi.niigata sado.niigata sanjo.niigata seiro.niigata seirou.niigata sekikawa.niigata shibata.niigata
jp tagami.niigata tainai.niigata tochio.niigata tokamachi.niigata tsubame.niigata tsunan.niigata uonuma.niigata
jp yahiko.niigata yoita.niigata yuzawa.niigata beppu.oita bungoono.oita bungotakada.oita hasama.oita hiji.oita
jp himeshima.oita hita.oita kamitsue.oita kokonoe.oita kuju.oita kunisaki.oita kusu.oita oita.oita saiki.oita
jp taketa.oita tsukumi.oita usa.oita usuki.oita yufu.oita akaiwa.okayama asakuchi.okayama bizen.okayama
jp hayashima.okayama ibara.okayama kagamino.okayama kasaoka.okayama kibichuo.okayama kumenan.okayama kurashiki.okayama
jp maniwa.okayama misaki.okayama nagi.okayama niimi.okayama nishiawakura.okayama okayama.okayama satosho.okayama
jp setouchi.okayama shinjo.okayama shoo.okayama soja.okayama takahashi.okayama tamano.okayama tsuyama.okayama
jp wake.okayama yakage.okayama aguni.okinawa ginowan.okinawa ginoza.okinawa gushikami.okinawa haebaru.okinawa
jp higashi.okinawa hirara.okinawa iheya.okinawa ishigaki.okinawa ishikawa.okinawa itoman.okinawa izena.okinawa
jp kadena.okinawa kin.okinawa kitadaito.okinawa kitanakagusuku.okinawa kumejima.okinawa kunigami.okinawa
jp minamidaito.okinawa motobu.okinawa nago.okinawa naha.okinawa nakagusuku.okinawa nakijin.okinawa nanjo.okinawa
jp nishihara.okinawa ogimi.okinawa okinawa.okinawa onna.okinawa shimoji.okinawa taketomi.okinawa tarama.okinawa
jp tokashiki.okinawa tomigusuku.okinawa tonaki.okinawa urasoe.okinawa uruma.okinawa yaese.okinawa yomitan.okinawa
jp yonabaru.okinawa yonaguni.okinawa zamami.okinawa abeno.osaka chihayaakasaka.osaka chuo.osaka daito.osaka
jp fujiidera.osaka habikino.osaka hannan.osaka higashiosaka.osaka higashisumiyoshi.osaka higashiyodogawa.osaka
jp hirakata.osaka ibaraki.osaka ikeda.osaka izumi.osaka izumiotsu.osaka izumisano.osaka kadoma.osaka kaizuka.osaka
jp kanan.osaka kashiwara.osaka katano.osaka kawachinagano.osaka kishiwada.osaka kita.osaka kumatori.osaka
jp matsubara.osaka minato.osaka minoh.osaka misaki.osaka moriguchi.osaka neyagawa.osaka nishi.osaka nose.osaka
jp osakasayama.osaka sakai.osaka sayama.osaka sennan.osaka settsu.osaka shijonawate.osaka shimamoto.osaka suita.osaka
jp tadaoka.osaka taishi.osaka tajiri.osaka takaishi.osaka takatsuki.osaka tondabayashi.osaka toyonaka.osaka
jp toyono.osaka yao.osaka ariake.saga arita.saga fukudomi.saga genkai.saga hamatama.saga hizen.saga imari.saga
jp kamimine.saga kanzaki.saga karatsu.saga kashima.saga kitagata.saga kitahata.saga kiyama.saga kouhoku.saga
jp kyuragi.saga nishiarita.saga ogi.saga omachi.saga ouchi.saga saga.saga shiroishi.saga taku.saga tara.saga tosu.saga
jp yoshinogari.saga arakawa.saitama asaka.saitama chichibu.saitama fujimi.saitama fujimino.saitama fukaya.saitama
jp hanno.saitama hanyu.saitama hasuda.saitama hatogaya.saitama hatoyama.saitama hidaka.saitama higashichichibu.saitama
jp higashimatsuyama.saitama honjo.saitama ina.saitama iruma.saitama iwatsuki.saitama kamiizumi.saitama
jp kamikawa.saitama kamisato.saitama kasukabe.saitama kawagoe.saitama kawaguchi.saitama kawajima.saitama kazo.saitama
jp kitamoto.saitama koshigaya.saitama kounosu.saitama kuki.saitama kumagaya.saitama matsubushi.saitama minano.saitama
jp misato.saitama miyashiro.saitama miyoshi.saitama moroyama.saitama nagatoro.saitama namegawa.saitama niiza.saitama
jp ogano.saitama ogawa.saitama ogose.saitama okegawa.saitama omiya.saitama otaki.saitama ranzan.saitama
jp ryokami.saitama saitama.saitama sakado.saitama satte.saitama sayama.saitama shiki.saitama shiraoka.saitama
jp soka.saitama sugito.saitama toda.saitama tokigawa.saitama tokorozawa.saitama tsurugashima.saitama urawa.saitama
jp warabi.saitama yashio.saitama yokoze.saitama yono.saitama yorii.saitama yoshida.saitama yoshikawa.saitama
jp yoshimi.saitama aisho.shiga gamo.shiga higashiomi.shiga hikone.shiga koka.shiga konan.shiga kosei.shiga koto.shiga
jp kusatsu.shiga maibara.shiga moriyama.shiga nagahama.shiga nishiazai.shiga notogawa.shiga omihachiman.shiga
jp otsu.shiga ritto.shiga ryuoh.shiga takashima.shiga takatsuki.shiga torahime.shiga toyosato.shiga yasu.shiga
jp akagi.shimane ama.shimane gotsu.shimane hamada.shimane higashiizumo.shimane hikawa.shimane hikimi.shimane
jp izumo.shimane kakinoki.shimane masuda.shimane matsue.shimane misato.shimane nishinoshima.shimane ohda.shimane
jp okinoshima.shimane okuizumo.shimane shimane.shimane tamayu.shimane tsuwano.shimane unnan.shimane yakumo.shimane
jp yasugi.shimane yatsuka.shimane arai.shizuoka atami.shizuoka fuji.shizuoka fujieda.shizuoka fujikawa.shizuoka
jp fujinomiya.shizuoka fukuroi.shizuoka gotemba.shizuoka haibara.shizuoka hamamatsu.shizuoka higashiizu.shizuoka
jp ito.shizuoka iwata.shizuoka izu.shizuoka izunokuni.shizuoka kakegawa.shizuoka kannami.shizuoka kawanehon.shizuoka
jp kawazu.shizuoka kikugawa.shizuoka kosai.shizuoka makinohara.shizuoka matsuzaki.shizuoka minamiizu.shizuoka
jp mishima.shizuoka morimachi.shizuoka nishiizu.shizuoka numazu.shizuoka omaezaki.shizuoka shimada.shizuoka
jp shimizu.shizuoka shimoda.shizuoka shizuoka.shizuoka susono.shizuoka yaizu.shizuoka yoshida.shizuoka
jp ashikaga.tochigi bato.tochigi haga.tochigi ichikai.tochigi iwafune.tochigi kaminokawa.tochigi kanuma.tochigi
jp karasuyama.tochigi kuroiso.tochigi mashiko.tochigi mibu.tochigi moka.tochigi motegi.tochigi nasu.tochigi
jp nasushiobara.tochigi nikko.tochigi nishikata.tochigi nogi.tochigi ohira.tochigi ohtawara.tochigi oyama.tochigi
jp sakura.tochigi sano.tochigi shimotsuke.tochigi shioya.tochigi takanezawa.tochigi tochigi.tochigi tsuga.tochigi
jp ujiie.tochigi utsunomiya.tochigi yaita.tochigi aizumi.tokushima anan.tokushima ichiba.tokushima itano.tokushima
jp kainan.tokushima komatsushima.tokushima matsushige.tokushima mima.tokushima minami.tokushima miyoshi.tokushima
jp mugi.tokushima nakagawa.tokushima naruto.tokushima sanagochi.tokushima shishikui.tokushima tokushima.tokushima
jp wajiki.tokushima adachi.tokyo akiruno.tokyo akishima.tokyo aogashima.tokyo arakawa.tokyo bunkyo.tokyo chiyoda.tokyo
jp chofu.tokyo chuo.tokyo edogawa.tokyo fuchu.tokyo fussa.tokyo hachijo.tokyo hachioji.tokyo hamura.tokyo
jp higashikurume.tokyo higashimurayama.tokyo higashiyamato.tokyo hino.tokyo hinode.tokyo hinohara.tokyo inagi.tokyo
jp itabashi.tokyo katsushika.tokyo kita.tokyo kiyose.tokyo kodaira.tokyo koganei.tokyo kokubunji.tokyo komae.tokyo
jp koto.tokyo kouzushima.tokyo kunitachi.tokyo machida.tokyo meguro.tokyo minato.tokyo mitaka.tokyo mizuho.tokyo
jp musashimurayama.tokyo musashino.tokyo nakano.tokyo nerima.tokyo ogasawara.tokyo okutama.tokyo ome.tokyo
jp oshima.tokyo ota.tokyo setagaya.tokyo shibuya.tokyo shinagawa.tokyo shinjuku.tokyo suginami.tokyo sumida.tokyo
jp tachikawa.tokyo taito.tokyo tama.tokyo toshima.tokyo chizu.tottori hino.tottori kawahara.tottori koge.tottori
jp kotoura.tottori misasa.tottori nanbu.tottori nichinan.tottori sakaiminato.tottori tottori.tottori wakasa.tottori
jp yazu.tottori yonago.tottori asahi.toyama fuchu.toyama fukumitsu.toyama funahashi.toyama himi.toyama imizu.toyama
jp inami.toyama johana.toyama kamiichi.toyama kurobe.toyama nakaniikawa.toyama namerikawa.toyama nanto.toyama
jp nyuzen.toyama oyabe.toyama taira.toyama takaoka.toyama tateyama.toyama toga.toyama tonami.toyama toyama.toyama
jp unazuki.toyama uozu.toyama yamada.toyama arida.wakayama aridagawa.wakayama gobo.wakayama hashimoto.wakayama
jp hidaka.wakayama hirogawa.wakayama inami.wakayama iwade.wakayama kainan.wakayama kamitonda.wakayama
jp katsuragi.wakayama kimino.wakayama kinokawa.wakayama kitayama.wakayama koya.wakayama koza.wakayama
jp kozagawa.wakayama kudoyama.wakayama kushimoto.wakayama mihama.wakayama misato.wakayama nachikatsuura.wakayama
jp shingu.wakayama shirahama.wakayama taiji.wakayama tanabe.wakayama wakayama.wakayama yuasa.wakayama yura.wakayama
jp asahi.yamagata funagata.yamagata higashine.yamagata iide.yamagata kahoku.yamagata kaminoyama.yamagata
jp kaneyama.yamagata kawanishi.yamagata mamurogawa.yamagata mikawa.yamagata murayama.yamagata nagai.yamagata
jp nakayama.yamagata nanyo.yamagata nishikawa.yamagata obanazawa.yamagata oe.yamagata oguni.yamagata ohkura.yamagata
jp oishida.yamagata sagae.yamagata sakata.yamagata sakegawa.yamagata shinjo.yamagata shirataka.yamagata
jp shonai.yamagata takahata.yamagata tendo.yamagata tozawa.yamagata tsuruoka.yamagata yamagata.yamagata
jp yamanobe.yamagata yonezawa.yamagata yuza.yamagata abu.yamaguchi hagi.yamaguchi hikari.yamaguchi hofu.yamaguchi
jp iwakuni.yamaguchi kudamatsu.yamaguchi mitou.yamaguchi nagato.yamaguchi oshima.yamaguchi shimonoseki.yamaguchi
jp shunan.yamaguchi tabuse.yamaguchi tokuyama.yamaguchi toyota.yamaguchi ube.yamaguchi yuu.yamaguchi chuo.yamanashi
jp doshi.yamanashi fuefuki.yamanashi fujikawa.yamanashi fujikawaguchiko.yamanashi fujiyoshida.yamanashi
jp hayakawa.yamanashi hokuto.yamanashi ichikawamisato.yamanashi kai.yamanashi kofu.yamanashi koshu.yamanashi
jp kosuge.yamanashi minami-alps.yamanashi minobu.yamanashi nakamichi.yamanashi nanbu.yamanashi narusawa.yamanashi
jp nirasaki.yamanashi nishikatsura.yamanashi oshino.yamanashi otsuki.yamanashi showa.yamanashi tabayama.yamanashi
jp tsuru.yamanashi uenohara.yamanashi yamanakako.yamanashi yamanashi.yamanashi
ke ac co go info me mobi ne or sc
kg com edu gov mil net org
kh com edu gov net org
ki biz com edu gov info net org
km ass com edu gov mil nom org prd tm asso coop gouv medecin notaires pharmaciens presse veterinaire
kn edu gov net org
kp com edu gov org rep tra
kr ac ai co es go hs io it kg me mil ms ne or pe re sc busan chungbuk chungnam daegu daejeon gangwon gwangju gyeongbuk
kr gyeonggi gyeongnam incheon jeju jeonbuk jeonnam seoul ulsan
kw com edu emb gov ind net org
ky com edu net org
kz com edu gov mil net org
la com edu gov info int net org per
lb com edu gov net org
lc co com edu gov net org
lk ac assn com edu gov grp hotel int ltd net ngo org sch soc web
lr com edu gov net org
ls ac biz co edu gov info net org sc
lt gov
lv asn com conf edu gov id mil net org
ly com edu gov id med net org plc sch
ma ac co gov net org press
mc asso tm
me ac co edu gov its net org priv
mg co com edu gov mil nom org prd
mk com edu gov inf name net org
ml ac art asso com edu gouv gov info inst net org pr presse
mm *
mn edu gov org
mo com edu gov net org
mr gov
ms com edu gov net org
mt com edu net org
mu ac co com gov net or org
mv aero biz com coop edu gov info int mil museum name net org pro
mw ac biz co com coop edu gov int net org
mx com edu gob net org
my biz com edu gov mil name net org
mz ac adv co edu gov mil net org
na alt co com gov net org
nc asso nom
nf arts com firm info net other per rec store web
ng com edu gov i mil mobi name net org sch
ni ac biz co com edu gob in info int mil net nom org web
no fhs folkebibl fylkesbibl gielda herad idrett kommune museum priv suohkan tjielte uenorge vgs dep mil stat aa ah bu
no fm hl hm jan-mayen mr nl nt of ol oslo rl sf st svalbard tm tr va vf gs.aa gs.ah gs.bu gs.fm gs.hl gs.hm
no gs.jan-mayen gs.mr gs.nl gs.nt gs.of gs.ol gs.oslo gs.rl gs.sf gs.st gs.svalbard gs.tm gs.tr gs.va gs.vf akrehamn
no xn--krehamn-dxa algard xn--lgrd-poac arna bronnoysund xn--brnnysund-m8ac brumunddal bryne drobak xn--drbak-wua
no egersund fetsund floro xn--flor-jra fredrikstad hokksund honefoss xn--hnefoss-q1a jessheim jorpeland
no xn--jrpeland-54a kirkenes kopervik krokstadelva langevag xn--langevg-jxa leirvik mjondalen xn--mjndalen-64a
no mo-i-rana mosjoen xn--mosjen-eya nesoddtangen orkanger osoyro xn--osyro-wua raholt xn--rholt-mra sandnessjoen
no xn--sandnessjen-ogb skedsmokorset slattum spjelkavik stathelle stavern stjordalshalsen xn--stjrdalshalsen-sqb
no tananger tranby vossevangen aarborte aejrie afjord xn--fjord-lra agdenes nes.akershus aknoluokta
no xn--koluokta-7ya57h al xn--l-1fa alaheadju xn--laheadju-7ya alesund xn--lesund-hua alstahaug alta xn--lt-liac
no alvdal amli xn--mli-tla amot xn--mot-tla andasuolo andebu andoy xn--andy-ira ardal xn--rdal-poa aremark arendal
no xn--s-1fa aseral xn--seral-lra asker askim askoy xn--asky-ira askvoll asnes xn--snes-poa audnedal aukra aure
no aurland aurskog-holand xn--aurskog-hland-jnb austevoll austrheim averoy xn--avery-yua badaddja xn--bdddj-mrabd
no xn--brum-voa bahcavuotna xn--bhcavuotna-s4a bahccavuotna xn--bhccavuotna-k7a baidar xn--bidr-5nac bajddar
no xn--bjddar-pta balat xn--blt-elab balestrand ballangen balsfjord bamble bardu barum batsfjord xn--btsfjord-9za
no bearalvahki xn--bearalvhki-y4a beardu beiarn berg bergen berlevag xn--berlevg-jxa bievat xn--bievt-0qa bindal
no birkenes bjerkreim bjugn bodo xn--bod-2na bokn bomlo xn--bmlo-gra bremanger bronnoy xn--brnny-wuac budejju
no nes.buskerud bygland bykle cahcesuolo xn--hcesuolo-7ya35b davvenjarga xn--davvenjrga-y4a davvesiida deatnu
no dielddanuorri divtasvuodna divttasvuotna donna xn--dnna-gra dovre drammen drangedal dyroy xn--dyry-ira eid eidfjord
no eidsberg eidskog eidsvoll eigersund elverum enebakk engerdal etne etnedal evenassi xn--eveni-0qa01ga evenes
no evje-og-hornnes farsund fauske fedje fet finnoy xn--finny-yua fitjar fjaler fjell fla xn--fl-zia flakstad flatanger
no flekkefjord flesberg flora folldal forde xn--frde-gra forsand fosnes xn--frna-woa frana frogn froland frosta froya
no xn--frya-hra fuoisku fuossko fusa fyresdal gaivuotna xn--givuotna-8ya galsa xn--gls-elac gamvik gangaviika
no xn--ggaviika-8ya47h gaular gausdal giehtavuoatna gildeskal xn--gildeskl-g0a giske gjemnes gjerdrum gjerstad gjesdal
no gjovik xn--gjvik-wua gloppen gol gran grane granvin gratangen grimstad grong grue gulen guovdageaidnu ha xn--h-2fa
no habmer xn--hbmer-xqa hadsel xn--hgebostad-g3a hagebostad halden halsa hamar hamaroy xn--hamary-fya hammarfeasta
no xn--hmmrfeasta-s4ac hammerfest hapmir xn--hpmir-xqa haram hareid harstad hasvik hattfjelldal haugesund os.hedmark
no valer.hedmark xn--vler-qoa.hedmark hemne hemnes hemsedal hitra hjartdal hjelmeland hobol xn--hobl-ira hof hol hole
no holmestrand holtalen xn--holtlen-hxa os.hordaland hornindal horten hoyanger xn--hyanger-q1a hoylandet
no xn--hylandet-54a hurdal hurum hvaler hyllestad ibestad inderoy xn--indery-fya iveland ivgu jevnaker jolster
no xn--jlster-bya jondal kafjord xn--kfjord-iua karasjohka xn--krjohka-hwab49j karasjok karlsoy xn--karlsy-fya karmoy
no xn--karmy-yua kautokeino klabu xn--klbu-woa klepp kongsberg kongsvinger kraanghke xn--kranghke-b0a kragero
no xn--krager-gya kristiansand kristiansund krodsherad xn--krdsherad-m8a xn--kvfjord-nxa xn--kvnangen-k0a kvafjord
no kvalsund kvam kvanangen kvinesdal kvinnherad kviteseid kvitsoy xn--kvitsy-fya laakesvuemie xn--lrdal-sra lahppi
no xn--lhppi-xqa lardal larvik lavagis lavangen leangaviika xn--leagaviika-52b lebesby leikanger leirfjord leka
no leksvik lenvik lerdal lesja levanger lier lierne lillehammer lillesand lindas xn--linds-pra lindesnes loabat
no xn--loabt-0qa lodingen xn--ldingen-q1a lom loppa lorenskog xn--lrenskog-54a loten xn--lten-gra lund lunner luroy
no xn--lury-ira luster lyngdal lyngen malatvuopmi xn--mlatvuopmi-s4a malselv xn--mlselv-iua malvik mandal marker
no marnardal masfjorden masoy xn--msy-ula0h matta-varjjat xn--mtta-vrjjat-k7af meland meldal melhus meloy xn--mely-ira
no meraker xn--merker-kua midsund midtre-gauldal moareke xn--moreke-jua modalen modum molde heroy.more-og-romsdal
no sande.more-og-romsdal xn--hery-ira.xn--mre-og-romsdal-qqb sande.xn--mre-og-romsdal-qqb moskenes moss muosat
no xn--muost-0qa naamesjevuemie xn--nmesjevuemie-tcba xn--nry-yla5g namdalseid namsos namsskogan nannestad naroy
no narviika narvik naustdal navuotna xn--nvuotna-hwa nedre-eiker nesna nesodden nesseby nesset nissedal nittedal
no nord-aurdal nord-fron nord-odal norddal nordkapp bo.nordland xn--b-5ga.nordland heroy.nordland
no xn--hery-ira.nordland nordre-land nordreisa nore-og-uvdal notodden notteroy xn--nttery-byae odda oksnes
no xn--ksnes-uua omasvuotna oppdal oppegard xn--oppegrd-ixa orkdal orland xn--rland-uua orskog xn--rskog-uua orsta
no xn--rsta-fra osen osteroy xn--ostery-fya valer.ostfold xn--vler-qoa.xn--stfold-9xa ostre-toten xn--stre-toten-zcb
no overhalla ovre-eiker xn--vre-eiker-k8a oyer xn--yer-zna oygarden xn--ygarden-p1a oystre-slidre xn--ystre-slidre-ujb
no porsanger porsangu xn--porsgu-sta26f porsgrunn rade xn--rde-ula radoy xn--rady-ira xn--rlingen-mxa rahkkeravju
no xn--rhkkervju-01af raisa xn--risa-5na rakkestad ralingen rana randaberg rauma re rendalen rennebu rennesoy
no xn--rennesy-v1a rindal ringebu ringerike ringsaker risor xn--risr-ira rissa roan rodoy xn--rdy-0nab rollag romsa
no romskog xn--rmskog-bya roros xn--rros-gra rost xn--rst-0na royken xn--ryken-vua royrvik xn--ryrvik-bya ruovat rygge
no salangen salat xn--slat-5na xn--slt-elab saltdal samnanger sandefjord sandnes sandoy xn--sandy-yua sarpsborg sauda
no sauherad sel selbu selje seljord siellak sigdal siljan sirdal skanit xn--sknit-yqa skanland xn--sknland-fxa skaun
no skedsmo ski skien skierva xn--skierv-uta skiptvet skjak xn--skjk-soa skjervoy xn--skjervy-v1a skodje smola
no xn--smla-hra snaase xn--snase-nra snasa xn--snsa-roa snillfjord snoasa sogndal sogne xn--sgne-gra sokndal sola
no solund somna xn--smna-gra sondre-land xn--sndre-land-0cb songdalen sor-aurdal xn--sr-aurdal-l8a sor-fron
no xn--sr-fron-q1a sor-odal xn--sr-odal-q1a sor-varanger xn--sr-varanger-ggb sorfold xn--srfold-bya sorreisa
no xn--srreisa-q1a sortland sorum xn--srum-gra spydeberg stange stavanger steigen steinkjer stjordal xn--stjrdal-s1a
no stokke stor-elvdal stord stordal storfjord strand stranda stryn sula suldal sund sunndal surnadal sveio svelvik
no sykkylven tana bo.telemark xn--b-5ga.telemark time tingvoll tinn tjeldsund tjome xn--tjme-hra tokke tolga tonsberg
no xn--tnsberg-q1a torsken xn--trna-woa trana tranoy xn--trany-yua troandin trogstad xn--trgstad-r1a tromsa tromso
no xn--troms-zua trondheim trysil tvedestrand tydal tynset tysfjord tysnes xn--tysvr-vra tysvar ullensaker ullensvang
no ulstein ulvik unjarga xn--unjrga-rta utsira vaapste vadso xn--vads-jra xn--vry-yla5g vaga xn--vg-yiab vagan
no xn--vgan-qoa vagsoy xn--vgsy-qoa0j vaksdal valle vang vanylven vardo xn--vard-jra varggat xn--vrggt-xqad varoy
no vefsn vega vegarshei xn--vegrshei-c0a vennesla verdal verran vestby sande.vestfold vestnes vestre-slidre
no vestre-toten vestvagoy xn--vestvgy-ixa6o vevelstad vik vikna vindafjord voagat volda voss
np *
nr biz com edu gov info net org
nz ac co cri geek gen govt health iwi kiwi maori xn--mori-qsa mil net org parliament school
om co com edu gov med museum net org pro
pa abo ac com edu gob ing med net nom org sld
pe com edu gob mil net nom org
pf com edu org
pg *
ph com edu gov i mil net ngo org
pk ac biz com edu fam gkp gob gog gok gop gos gov net org web
pl com net org agro aid atm auto biz edu gmina gsm info mail media miasta mil nieruchomosci nom pc powiat priv
pl realestate rel sex shop sklep sos szkola targi tm tourism travel turystyka gov ap.gov griw.gov ic.gov is.gov
pl kmpsp.gov konsulat.gov kppsp.gov kwp.gov kwpsp.gov mup.gov mw.gov oia.gov oirm.gov oke.gov oow.gov oschr.gov
pl oum.gov pa.gov pinb.gov piw.gov po.gov pr.gov psp.gov psse.gov pup.gov rzgw.gov sa.gov sdn.gov sko.gov so.gov
pl sr.gov starostwo.gov ug.gov ugim.gov um.gov umig.gov upow.gov uppo.gov us.gov uw.gov uzs.gov wif.gov wiih.gov
pl winb.gov wios.gov witd.gov wiw.gov wkz.gov wsa.gov wskr.gov wsse.gov wuoz.gov wzmiuw.gov zp.gov zpisdn.gov augustow
pl babia-gora bedzin beskidy bialowieza bialystok bielawa bieszczady boleslawiec bydgoszcz bytom cieszyn czeladz czest
pl dlugoleka elblag elk glogow gniezno gorlice grajewo ilawa jaworzno jelenia-gora jgora kalisz karpacz kartuzy
pl kaszuby katowice kazimierz-dolny kepno ketrzyn klodzko kobierzyce kolobrzeg konin konskowola kutno lapy lebork
pl legnica lezajsk limanowa lomza lowicz lubin lukow malbork malopolska mazowsze mazury mielec mielno mragowo naklo
pl nowaruda nysa olawa olecko olkusz olsztyn opoczno opole ostroda ostroleka ostrowiec ostrowwlkp pila pisz podhale
pl podlasie polkowice pomorskie pomorze prochowice pruszkow przeworsk pulawy radom rawa-maz rybnik rzeszow sanok sejny
pl skoczow slask slupsk sosnowiec stalowa-wola starachowice stargard suwalki swidnica swiebodzin swinoujscie szczecin
pl szczytno tarnobrzeg tgory turek tychy ustka walbrzych warmia warszawa waw wegrow wielun wlocl wloclawek wodzislaw
pl wolomin wroclaw zachpomor zagan zarow zgora zgorzelec
pn co edu gov net org
pr ac biz com edu est gov info isla name net org pro prof
pro aaa aca acct avocat bar cpa eng jur law med recht
ps com edu gov net org plo sec
pt com edu gov int net nome org publ
pw gov
py com coop edu gov mil net org
qa com edu gov mil name net org sch
re asso com
ro arts com firm info nom nt org rec store tm www
rs ac co edu gov in org
rw ac co coop gov mil net org
sa com edu gov med net org pub sch
sb com edu gov net org
sc com edu gov net org
sd com edu gov info med net org tv
se a ac b bd brand c d e f fh fhsk fhv g h i k komforb kommunalforbund komvux l lanbib m n naturbruksgymn o org p
se parti pp press r s t tm u w x y z
sg com edu gov net org
sh com gov mil net org
sk org
sl com edu gov net org
sn art com edu gouv org univ
so com edu gov me net org
ss biz co com edu gov me net org sch
st co com consulado edu embaixada mil net org principe saotome store
sv com edu gob org red
sx gov
sy com edu gov mil net org
sz ac co org
th ac co go in mi net or
tj biz co com edu go gov int mil name net nic org test web
tl gov
tm co com edu gov mil net nom org
tn com ens fin gov ind info intl mincom nat net org perso tourism
to com edu gov mil net org
tr av bbs bel biz com dr edu gen gov info k12 kep mil name net org pol tel tsk tv web nc gov.nc
tt biz co com edu gov info mil name net org pro
tw club com ebiz edu game gov idv mil net org
tz ac co go hotel info me mil mobi ne or sc tv
ua com edu gov in net org cherkassy cherkasy chernigov chernihiv chernivtsi chernovtsy ck cn cr crimea cv dn
ua dnepropetrovsk dnipropetrovsk donetsk dp if ivano-frankivsk kh kharkiv kharkov kherson khmelnitskiy khmelnytskyi
ua kiev kirovograd km kr kropyvnytskyi krym ks kv kyiv lg lt lugansk luhansk lutsk lv lviv mk mykolaiv nikolaev od
ua odesa odessa pl poltava rivne rovno rv sb sebastopol sevastopol sm sumy te ternopil uz uzhgorod uzhhorod vinnica
ua vinnytsia vn volyn yalta zakarpattia zaporizhzhe zaporizhzhia zhitomir zhytomyr zp zt
ug ac co com edu go gov mil ne or org sc us
uk ac co gov ltd me net nhs org plc police *.sch
us dni isa nsn ak al ar as az ca co ct dc de fl ga gu hi ia id il in ks ky la ma md me mi mn mo ms mt nc nd ne nh nj
us nm nv ny oh ok or pa pr ri sc sd tn tx ut va vi vt wa wi wv wy k12.ak k12.al k12.ar k12.as k12.az k12.ca k12.co
us k12.ct k12.dc k12.fl k12.ga k12.gu k12.ia k12.id k12.il k12.in k12.ks k12.ky k12.la k12.ma k12.md k12.me k12.mi
us k12.mn k12.mo k12.ms k12.mt k12.nc k12.ne k12.nh k12.nj k12.nm k12.nv k12.ny k12.oh k12.ok k12.or k12.pa k12.pr
us k12.sc k12.tn k12.tx k12.ut k12.va k12.vi k12.vt k12.wa k12.wi cc.ak lib.ak cc.al lib.al cc.ar lib.ar cc.as lib.as
us cc.az lib.az cc.ca lib.ca cc.co lib.co cc.ct lib.ct cc.dc lib.dc cc.de cc.fl lib.fl cc.ga lib.ga cc.gu lib.gu cc.hi
us lib.hi cc.ia lib.ia cc.id lib.id cc.il lib.il cc.in lib.in cc.ks lib.ks cc.ky lib.ky cc.la lib.la cc.ma lib.ma
us cc.md lib.md cc.me lib.me cc.mi lib.mi cc.mn lib.mn cc.mo lib.mo cc.ms cc.mt lib.mt cc.nc lib.nc cc.ne lib.ne cc.nh
us lib.nh cc.nj lib.nj cc.nm lib.nm cc.nv lib.nv cc.ny lib.ny cc.oh lib.oh cc.ok lib.ok cc.or lib.or cc.pa lib.pa
us cc.pr lib.pr cc.ri lib.ri cc.sc lib.sc cc.sd lib.sd cc.tn lib.tn cc.tx lib.tx cc.ut lib.ut cc.va lib.va cc.vi
us lib.vi cc.vt lib.vt cc.wa lib.wa cc.wi lib.wi cc.wv cc.wy k12.wy lib.wy chtr.k12.ma paroch.k12.ma pvt.k12.ma
us ann-arbor.mi cog.mi dst.mi eaton.mi gen.mi mus.mi tec.mi washtenaw.mi
uy com edu gub mil net org
uz co com net org
vc com edu gov mil net org
ve arts bib co com e12 edu emprende firm gob gov ia info int mil net nom org rar rec store tec web
vg edu
vi co com k12 net org
vn ac ai biz com edu gov health id info int io name net org pro angiang bacgiang backan baclieu bacninh baria-vungtau
vn bentre binhdinh binhduong binhphuoc binhthuan camau cantho caobang daklak daknong danang dienbien dongnai dongthap
vn gialai hagiang haiduong haiphong hanam hanoi hatinh haugiang hoabinh hue hungyen khanhhoa kiengiang kontum laichau
vn lamdong langson laocai longan namdinh nghean ninhbinh ninhthuan phutho phuyen quangbinh quangnam quangngai
vn quangninh quangtri soctrang sonla tayninh thaibinh thainguyen thanhhoa thanhphohochiminh thuathienhue tiengiang
vn travinh tuyenquang vinhlong vinhphuc yenbai
vu com edu net org
ws com edu gov net org
xn--j6w193g xn--gmqw5a xn--55qx5d xn--mxtq1m xn--wcvs22d xn--uc0atv xn--od0alg
xn--90a3ac xn--80au xn--90azh xn--d1at xn--c1avg xn--o1ac xn--o1ach
xn--o3cw4h xn--o3cyx2a xn--12co0c3b4eva xn--m3ch0j3a xn--h3cuzk1di xn--12c1fe0br xn--12cfi8ixb8l
ye com edu gov mil net org
za ac agric alt co edu gov grondar law mil net ngo nic nis nom org school tm web
zm ac biz co com edu gov info mil net org sch
zw ac co gov mil org
`;
