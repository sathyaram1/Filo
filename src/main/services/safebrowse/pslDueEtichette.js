// Le regole a due etichette della sezione ICANN della Public Suffix List (publicsuffix.org), solo ASCII: ogni riga è
// un dominio di primo livello seguito da etichette che sotto di lui sono suffissi pubblici (`uk co org` → co.uk e org.uk).
// Dati, non logica: li legge solo safebrowse/psl.js. Si rigenera dalla lista ufficiale (righe ICANN con un punto, senza * né !).

'use strict';

module.exports = `
ac com edu gov mil net org
ae ac co gov mil net org sch
aero accident-investigation accident-prevention aerobatic aeroclub aerodrome agents air-surveillance
aero air-traffic-control aircraft airline airport airtraffic ambulance association author ballooning broker caa
aero cargo catering certification championship charter civilaviation club conference consultant consulting control
aero council crew design dgca educator emergency engine engineer entertainment equipment exchange express federation
aero flight freight fuel gliding government groundhandling group hanggliding homebuilt insurance journal journalist
aero leasing logistics magazine maintenance marketplace media microlight modelling navigation parachuting
aero paragliding passenger-association pilot press production recreation repbody res research rotorcraft safety
aero scientist services show skydiving software student taxi trader trading trainer union workinggroup works
af com edu gov net org
ag co com net nom org
ai com net off org
al com edu gov mil net org
am co com commune net org
ao co ed edu gov gv it og org pb
ar bet com coop edu gob gov int mil musica mutual net org seg senasa tur
arpa e164 home in-addr ip6 iris uri urn
as gov
at ac co gv or
au act asn com conf edu gov id net nsw nt org oz qld sa tas vic wa
aw com
az biz co com edu gov info int mil name net org pp pro
ba com edu gov mil net org
bb biz co com edu gov info net org store tv
bd ac ai co com edu gov id info it mil net org sch tv
be ac
bf gov
bg 0 1 2 3 4 5 6 7 8 9 a b c d e f g h i j k l m n o p q r s t u v w x y z
bh com edu gov net org
bi co com edu or org
bj africa agro architectes assur avocats co com eco econo edu info loisirs money net org ote restaurant resto
bj tourism univ
bm com edu gov net org
bn com edu gov net org
bo academia agro arte blog bolivia ciencia com cooperativa democracia deporte ecologia economia edu empresa gob ia
bo indigena industria info int medicina mil movimiento musica natural net nombre noticias org patria plurinacional
bo politica profesional pueblo revista salud tecnologia tksat transporte tv web wiki
br 9guacu abc adm adv agr aju am anani aparecida api app arq art ato b barueri belem bet bhz bib bio blog bmd
br boavista bsb campinagrande campinas caxias cim cng cnt com contagem coop coz cri cuiaba curitiba def des det dev
br ecn eco edu emp enf eng esp etc eti far feira flog floripa fm fnd fortal fot foz fst g12 geo ggf goiania gov gru
br ia imb ind inf jab jampa jdf joinville jor jus leg leilao lel log londrina macapa maceio manaus maringa mat med
br mil morena mp mus natal net niteroi not ntr odo ong org osasco palmas poa ppg pro psc psi pvh qsl radio rec
br recife rep ribeirao rio riobranco riopreto salvador sampa santamaria santoandre saobernardo saogonca seg sjc slg
br slz social sorocaba srv taxi tc tec teo the tmp trd tur tv udi vet vix vlog wiki xyz zlg
bs com edu gov net org
bt com edu gov net org
bw ac co gov net org
by com gov mil of
bz co com edu gov net org
ca ab bc gc mb nb nf nl ns nt nu on pe qc sk yk
cd gov
ci ac asso co com ed edu go gouv int net or org
cl co gob gov mil
cm co com gov net
cn ac ah bj com cq edu fj gd gov gs gx gz ha hb he hi hk hl hn jl js jx ln mil mo net nm nx org qh sc sd sh sn sx tj
cn tw xj xz yn zj
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
es com edu gob nom org
et biz com edu gov info name net org
fi aland
fj ac biz com edu gov id info mil name net org pro
fm com edu net org
fr asso avoues cci com gouv greta huissier-justice nom prd tm
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
hk com edu gov idv net org
hn com edu gob mil net org
hr com from iz name
ht adult art asso com coop edu firm gouv info med net org perso pol pro rel shop
hu 2000 agrar bolt casino city co erotica erotika film forum games hotel info ingatlan jogasz konyvelo lakas media
hu news org priv reklam sex shop sport suli szex tm tozsde utazas video
id ac ai biz co desa go kop mil my net or ponpes sch web
ie gov
il ac co gov idf k12 muni net org
im ac co com net org tt tv
in 5g 6g ac aero ai alumni am bank bihar biz business ca cn co com coop cs delhi dr edu er fin firm gen gov gujarat
in ind info int internet io me mil net nic org pg post pro res school travel tv ub uk up us
int eu
io co com edu gov mil net nom org
iq com edu gov mil net org
ir ac co gov id net org sch
it abr abruzzo ag agrigento al alessandria alto-adige altoadige an ancona andria-barletta-trani
it andria-trani-barletta andriabarlettatrani andriatranibarletta ao aosta aosta-valley aostavalley aoste ap aq ar
it arezzo ascoli-piceno ascolipiceno asti at av avellino ba balsan balsan-sudtirol balsan-suedtirol bari
it barletta-trani-andria barlettatraniandria bas basilicata belluno benevento bergamo bg bi biella bl bn bo bologna
it bolzano bolzano-altoadige bozen bozen-sudtirol bozen-suedtirol br brescia brindisi bs bt bulsan bulsan-sudtirol
it bulsan-suedtirol bz ca cagliari cal calabria caltanissetta cam campania campidano-medio campidanomedio campobasso
it carbonia-iglesias carboniaiglesias carrara-massa carraramassa caserta catania catanzaro cb ce cesena-forli
it cesenaforli ch chieti ci cl cn co como cosenza cr cremona crotone cs ct cuneo cz dell-ogliastra dellogliastra edu
it emilia-romagna emiliaromagna emr en enna fc fe fermo ferrara fg fi firenze florence fm foggia forli-cesena
it forlicesena fr friuli-v-giulia friuli-ve-giulia friuli-vegiulia friuli-venezia-giulia friuli-veneziagiulia
it friuli-vgiulia friuliv-giulia friulive-giulia friulivegiulia friulivenezia-giulia friuliveneziagiulia
it friulivgiulia frosinone fvg ge genoa genova go gorizia gov gr grosseto iglesias-carbonia iglesiascarbonia im
it imperia is isernia kr la-spezia laquila laspezia latina laz lazio lc le lecce lecco li lig liguria livorno lo
it lodi lom lombardia lombardy lt lu lucania lucca macerata mantova mar marche massa-carrara massacarrara matera mb
it mc me medio-campidano mediocampidano messina mi milan milano mn mo modena mol molise monza monza-brianza
it monza-e-della-brianza monzabrianza monzaebrianza monzaedellabrianza ms mt na naples napoli no novara nu nuoro og
it ogliastra olbia-tempio olbiatempio or oristano ot pa padova padua palermo parma pavia pc pd pe perugia
it pesaro-urbino pesarourbino pescara pg pi piacenza piedmont piemonte pisa pistoia pmn pn po pordenone potenza pr
it prato pt pu pug puglia pv pz ra ragusa ravenna rc re reggio-calabria reggio-emilia reggiocalabria reggioemilia rg
it ri rieti rimini rm rn ro roma rome rovigo sa salerno sar sardegna sardinia sassari savona si sic sicilia sicily
it siena siracusa so sondrio sp sr ss su sud-sardegna sudsardegna suedtirol sv ta taa taranto te tempio-olbia
it tempioolbia teramo terni tn to torino tos toscana tp tr trani-andria-barletta trani-barletta-andria
it traniandriabarletta tranibarlettaandria trapani trentin-sud-tirol trentin-sudtirol trentin-sued-tirol
it trentin-suedtirol trentino trentino-a-adige trentino-aadige trentino-alto-adige trentino-altoadige
it trentino-s-tirol trentino-stirol trentino-sud-tirol trentino-sudtirol trentino-sued-tirol trentino-suedtirol
it trentinoa-adige trentinoaadige trentinoalto-adige trentinoaltoadige trentinos-tirol trentinostirol
it trentinosud-tirol trentinosued-tirol trentinosuedtirol trentinsud-tirol trentinsudtirol trentinsued-tirol
it trentinsuedtirol trento treviso trieste ts turin tuscany tv ud udine umb umbria urbino-pesaro urbinopesaro va
it val-d-aosta val-daosta vald-aosta valle-aosta valle-d-aosta valle-daosta valleaosta valled-aosta valledaosta
it vallee-aoste vallee-d-aoste valleeaoste valleedaoste vao varese vb vc vda ve ven veneto venezia venice verbania
it verbano-cusio-ossola vercelli verona vi vibo-valentia vibovalentia vicenza viterbo vr vs vt vv
je co net org
jo agri ai com edu eng fm gov mil net org per phd sch tv
jp ac ad aichi akita aomori chiba co ed ehime fukui fukuoka fukushima gifu go gr gunma hiroshima hokkaido hyogo
jp ibaraki ishikawa iwate kagawa kagoshima kanagawa kochi kumamoto kyoto lg mie miyagi miyazaki nagano nagasaki nara
jp ne niigata oita okayama okinawa or osaka saga saitama shiga shimane shizuoka tochigi tokushima tokyo tottori
jp toyama wakayama yamagata yamaguchi yamanashi
ke ac co go info me mobi ne or sc
kg com edu gov mil net org
kh com edu gov net org
ki biz com edu gov info net org
km ass asso com coop edu gouv gov medecin mil nom notaires org pharmaciens prd presse tm veterinaire
kn edu gov net org
kp com edu gov org rep tra
kr ac ai busan chungbuk chungnam co daegu daejeon es gangwon go gwangju gyeongbuk gyeonggi gyeongnam hs incheon io
kr it jeju jeonbuk jeonnam kg me mil ms ne or pe re sc seoul ulsan
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
no aa aarborte aejrie afjord agdenes ah aknoluokta akrehamn al alaheadju alesund algard alstahaug alta alvdal amli
no amot andasuolo andebu andoy ardal aremark arendal arna aseral asker askim askoy askvoll asnes audnedal aukra aure
no aurland aurskog-holand austevoll austrheim averoy badaddja bahcavuotna bahccavuotna baidar bajddar balat
no balestrand ballangen balsfjord bamble bardu barum batsfjord bearalvahki beardu beiarn berg bergen berlevag bievat
no bindal birkenes bjerkreim bjugn bodo bokn bomlo bremanger bronnoy bronnoysund brumunddal bryne bu budejju bygland
no bykle cahcesuolo davvenjarga davvesiida deatnu dep dielddanuorri divtasvuodna divttasvuotna donna dovre drammen
no drangedal drobak dyroy egersund eid eidfjord eidsberg eidskog eidsvoll eigersund elverum enebakk engerdal etne
no etnedal evenassi evenes evje-og-hornnes farsund fauske fedje fet fetsund fhs finnoy fitjar fjaler fjell fla
no flakstad flatanger flekkefjord flesberg flora floro fm folkebibl folldal forde forsand fosnes frana fredrikstad
no frogn froland frosta froya fuoisku fuossko fusa fylkesbibl fyresdal gaivuotna galsa gamvik gangaviika gaular
no gausdal giehtavuoatna gielda gildeskal giske gjemnes gjerdrum gjerstad gjesdal gjovik gloppen gol gran grane
no granvin gratangen grimstad grong grue gulen guovdageaidnu ha habmer hadsel hagebostad halden halsa hamar hamaroy
no hammarfeasta hammerfest hapmir haram hareid harstad hasvik hattfjelldal haugesund hemne hemnes hemsedal herad
no hitra hjartdal hjelmeland hl hm hobol hof hokksund hol hole holmestrand holtalen honefoss hornindal horten
no hoyanger hoylandet hurdal hurum hvaler hyllestad ibestad idrett inderoy iveland ivgu jan-mayen jessheim jevnaker
no jolster jondal jorpeland kafjord karasjohka karasjok karlsoy karmoy kautokeino kirkenes klabu klepp kommune
no kongsberg kongsvinger kopervik kraanghke kragero kristiansand kristiansund krodsherad krokstadelva kvafjord
no kvalsund kvam kvanangen kvinesdal kvinnherad kviteseid kvitsoy laakesvuemie lahppi langevag lardal larvik lavagis
no lavangen leangaviika lebesby leikanger leirfjord leirvik leka leksvik lenvik lerdal lesja levanger lier lierne
no lillehammer lillesand lindas lindesnes loabat lodingen lom loppa lorenskog loten lund lunner luroy luster lyngdal
no lyngen malatvuopmi malselv malvik mandal marker marnardal masfjorden masoy matta-varjjat meland meldal melhus
no meloy meraker midsund midtre-gauldal mil mjondalen mo-i-rana moareke modalen modum molde mosjoen moskenes moss mr
no muosat museum naamesjevuemie namdalseid namsos namsskogan nannestad naroy narviika narvik naustdal navuotna
no nedre-eiker nesna nesodden nesoddtangen nesseby nesset nissedal nittedal nl nord-aurdal nord-fron nord-odal
no norddal nordkapp nordre-land nordreisa nore-og-uvdal notodden notteroy nt odda of oksnes ol omasvuotna oppdal
no oppegard orkanger orkdal orland orskog orsta osen oslo osoyro osteroy ostre-toten overhalla ovre-eiker oyer
no oygarden oystre-slidre porsanger porsangu porsgrunn priv rade radoy rahkkeravju raholt raisa rakkestad ralingen
no rana randaberg rauma re rendalen rennebu rennesoy rindal ringebu ringerike ringsaker risor rissa rl roan rodoy
no rollag romsa romskog roros rost royken royrvik ruovat rygge salangen salat saltdal samnanger sandefjord sandnes
no sandnessjoen sandoy sarpsborg sauda sauherad sel selbu selje seljord sf siellak sigdal siljan sirdal skanit
no skanland skaun skedsmo skedsmokorset ski skien skierva skiptvet skjak skjervoy skodje slattum smola snaase snasa
no snillfjord snoasa sogndal sogne sokndal sola solund somna sondre-land songdalen sor-aurdal sor-fron sor-odal
no sor-varanger sorfold sorreisa sortland sorum spjelkavik spydeberg st stange stat stathelle stavanger stavern
no steigen steinkjer stjordal stjordalshalsen stokke stor-elvdal stord stordal storfjord strand stranda stryn sula
no suldal sund sunndal suohkan surnadal svalbard sveio svelvik sykkylven tana tananger time tingvoll tinn tjeldsund
no tjielte tjome tm tokke tolga tonsberg torsken tr trana tranby tranoy troandin trogstad tromsa tromso trondheim
no trysil tvedestrand tydal tynset tysfjord tysnes tysvar uenorge ullensaker ullensvang ulstein ulvik unjarga utsira
no va vaapste vadso vaga vagan vagsoy vaksdal valle vang vanylven vardo varggat varoy vefsn vega vegarshei vennesla
no verdal verran vestby vestnes vestre-slidre vestre-toten vestvagoy vevelstad vf vgs vik vikna vindafjord voagat
no volda voss vossevangen
nr biz com edu gov info net org
nz ac co cri geek gen govt health iwi kiwi maori mil net org parliament school
om co com edu gov med museum net org pro
pa abo ac com edu gob ing med net nom org sld
pe com edu gob mil net nom org
pf com edu org
ph com edu gov i mil net ngo org
pk ac biz com edu fam gkp gob gog gok gop gos gov net org web
pl agro aid atm augustow auto babia-gora bedzin beskidy bialowieza bialystok bielawa bieszczady biz boleslawiec
pl bydgoszcz bytom cieszyn com czeladz czest dlugoleka edu elblag elk glogow gmina gniezno gorlice gov grajewo gsm
pl ilawa info jaworzno jelenia-gora jgora kalisz karpacz kartuzy kaszuby katowice kazimierz-dolny kepno ketrzyn
pl klodzko kobierzyce kolobrzeg konin konskowola kutno lapy lebork legnica lezajsk limanowa lomza lowicz lubin lukow
pl mail malbork malopolska mazowsze mazury media miasta mielec mielno mil mragowo naklo net nieruchomosci nom
pl nowaruda nysa olawa olecko olkusz olsztyn opoczno opole org ostroda ostroleka ostrowiec ostrowwlkp pc pila pisz
pl podhale podlasie polkowice pomorskie pomorze powiat priv prochowice pruszkow przeworsk pulawy radom rawa-maz
pl realestate rel rybnik rzeszow sanok sejny sex shop sklep skoczow slask slupsk sos sosnowiec stalowa-wola
pl starachowice stargard suwalki swidnica swiebodzin swinoujscie szczecin szczytno szkola targi tarnobrzeg tgory tm
pl tourism travel turek turystyka tychy ustka walbrzych warmia warszawa waw wegrow wielun wlocl wloclawek wodzislaw
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
tr av bbs bel biz com dr edu gen gov info k12 kep mil name nc net org pol tel tsk tv web
tt biz co com edu gov info mil name net org pro
tw club com ebiz edu game gov idv mil net org
tz ac co go hotel info me mil mobi ne or sc tv
ua cherkassy cherkasy chernigov chernihiv chernivtsi chernovtsy ck cn com cr crimea cv dn dnepropetrovsk
ua dnipropetrovsk donetsk dp edu gov if in ivano-frankivsk kh kharkiv kharkov kherson khmelnitskiy khmelnytskyi kiev
ua kirovograd km kr kropyvnytskyi krym ks kv kyiv lg lt lugansk luhansk lutsk lv lviv mk mykolaiv net nikolaev od
ua odesa odessa org pl poltava rivne rovno rv sb sebastopol sevastopol sm sumy te ternopil uz uzhgorod uzhhorod
ua vinnica vinnytsia vn volyn yalta zakarpattia zaporizhzhe zaporizhzhia zhitomir zhytomyr zp zt
ug ac co com edu go gov mil ne or org sc us
uk ac co gov ltd me net nhs org plc police
us ak al ar as az ca co ct dc de dni fl ga gu hi ia id il in isa ks ky la ma md me mi mn mo ms mt nc nd ne nh nj nm
us nsn nv ny oh ok or pa pr ri sc sd tn tx ut va vi vt wa wi wv wy
uy com edu gub mil net org
uz co com net org
vc com edu gov mil net org
ve arts bib co com e12 edu emprende firm gob gov ia info int mil net nom org rar rec store tec web
vg edu
vi co com k12 net org
vn ac ai angiang bacgiang backan baclieu bacninh baria-vungtau bentre binhdinh binhduong binhphuoc binhthuan biz
vn camau cantho caobang com daklak daknong danang dienbien dongnai dongthap edu gialai gov hagiang haiduong haiphong
vn hanam hanoi hatinh haugiang health hoabinh hue hungyen id info int io khanhhoa kiengiang kontum laichau lamdong
vn langson laocai longan namdinh name net nghean ninhbinh ninhthuan org phutho phuyen pro quangbinh quangnam
vn quangngai quangninh quangtri soctrang sonla tayninh thaibinh thainguyen thanhhoa thanhphohochiminh thuathienhue
vn tiengiang travinh tuyenquang vinhlong vinhphuc yenbai
vu com edu net org
ws com edu gov net org
ye com edu gov mil net org
za ac agric alt co edu gov grondar law mil net ngo nic nis nom org school tm web
zm ac biz co com edu gov info mil net org sch
zw ac co gov mil org
`;
