/**
 * conversation-flow.ts
 * A guided conversation state machine — no Gemini needed.
 *
 * KEY FIX: extractFlowData now scans the CURRENT QUERY too, not just history.
 * guidedFlow now works from message 1 (no minimum history requirement).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FlowData {
  businessType?: string;
  district?: string;
  hasAlcohol?: boolean;
  hasMusic?: boolean;
  universityName?: string;
}

// Machine sentinel: permitFlow returns `${DASHBOARD_READY}<business>|<district>` once
// both are known. smartRouter intercepts it, builds the real workflow + dashboard_state,
// and the frontend auto-opens the Dashboard. Never shown to the user verbatim.
export const DASHBOARD_READY = 'DASHBOARD_READY:';

// Sentinel: studentFlow returns `${STUDENT_SERVICE_READY}<service-label>` when it
// detects a student service keyword in the current query. The frontend intercepts it
// and immediately starts the New/Renewal flow for that service — same as clicking a chip.
export const STUDENT_SERVICE_READY = 'STUDENT_SERVICE_READY:';

// ── Matching helpers ───────────────────────────────────────────────────────────
// Turkish letters aren't part of JS \w, so we build our own word boundaries that
// treat Turkish letters + digits as "inside a word" and everything else as a break.

const TR_WORD = 'a-z0-9çğıöşü';

function normalizeText(s: string): string {
  // NFC-compose first so decomposed input (e.g. "o"+combining-diaeresis from some
  // browsers/keyboards) matches our precomposed aliases ("ö"). Then lowercase, strip
  // the combining dot above that 'İ'.toLowerCase() can emit, and the Arabic tatweel —
  // so matching stays stable regardless of how the user's device encodes Turkish.
  //
  // Arabic normalization: people type the same word with different alef forms
  // (أ/إ/آ/ا), with or without harakat (diacritics), and with ى vs ي. We unify
  // these so "افتح" and "أفتح" match the same pattern. No-op on Latin/Turkish text.
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/̇/g, '')              // combining dot above (İ.toLowerCase())
    .replace(/ـ/g, '')              // Arabic tatweel
    .replace(/[ً-ْ]/g, '')     // Arabic harakat (tashkeel)
    .replace(/[أإآ]/g, 'ا')  // أ/إ/آ → ا (unify alef)
    .replace(/ى/g, 'ي')       // ى → ي (alef maqsura → ya)
    .replace(/ة/g, 'ه');      // ta marbuta → ha (colloquial: "اقامة"→"اقامه")
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if `term` appears in `text` as a standalone token (Turkish-aware boundaries). */
function containsTerm(text: string, term: string): boolean {
  const re = new RegExp(`(?:^|[^${TR_WORD}])${escapeRegExp(term)}(?:$|[^${TR_WORD}])`, 'i');
  return re.test(text);
}

// ── Fuzzy matching (typo tolerance) ──────────────────────────────────────────
// Runs ONLY when exact matching fails, so correct input stays fast & precise and
// only misspellings ("kadkoy", "besiktas", "resturant") fall through to fuzzy.

/**
 * Damerau-Levenshtein distance (optimal string alignment).
 * Counts transpositions as 1 op instead of 2, so "atasheir"↔"atasehir" = 1 not 2.
 */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[m][n];
}

/** Normalized similarity 0..1 (1 = identical). */
function similarity(a: string, b: string): number {
  const ml = Math.max(a.length, b.length);
  return ml === 0 ? 1 : 1 - editDistance(a, b) / ml;
}

/** Split normalized text into word tokens (Turkish-aware). */
function tokenize(text: string): string[] {
  return text.split(new RegExp(`[^${TR_WORD}]+`)).filter(Boolean);
}

/**
 * Best fuzzy match of any token (or adjacent token pair, for multi-word names)
 * in `text` against a lookup list. Returns the value of the closest entry whose
 * similarity clears `threshold`, or null. Length gates keep it from matching
 * unrelated words.
 */
function fuzzyMatch<T>(
  text: string,
  list: T[],
  getTerm: (x: T) => string,
  getValue: (x: T) => string,
  threshold: number,
): string | null {
  const toks = tokenize(text).filter(t => t.length >= 3);
  if (toks.length === 0) return null;
  const candidates = [...toks];
  for (let i = 0; i < toks.length - 1; i++) candidates.push(`${toks[i]} ${toks[i + 1]}`);

  let best: string | null = null;
  let bestScore = 0;
  for (const cand of candidates) {
    for (const item of list) {
      const term = getTerm(item);
      if (term.length < 3) continue;                          // never fuzzy-match very short keywords
      if (Math.abs(term.length - cand.length) > 3) continue;  // length gate prunes obvious mismatches
      const score = similarity(cand, term);
      if (score >= threshold && score > bestScore) {
        bestScore = score;
        best = getValue(item);
      }
    }
  }
  return best;
}

// ── District detection ────────────────────────────────────────────────────────
// Canonical display name → all spelling/neighborhood aliases (lowercased).
// Covers all 39 official Istanbul districts plus well-known neighborhoods that
// map back to their parent municipality (which is what determines the permit office).

const DISTRICT_ALIASES: Array<{ name: string; aliases: string[] }> = [
  { name: 'Adalar',         aliases: ['adalar', 'adalaar', 'adallar', 'büyükada', 'buyukada', 'heybeliada', 'burgazada', 'kınalıada', 'kinaliada', 'princes islands', 'prince islands'] },
  { name: 'Arnavutköy',     aliases: ['arnavutköy', 'arnavutkoy', 'arnavutkoi', 'arnavutköi', 'arnavutkowy', 'arnavutkwy', 'hadımköy', 'hadimkoy', 'taşoluk', 'tasoluk', 'bolluca', 'haraççı', 'haracci'] },
  { name: 'Ataşehir',       aliases: ['ataşehir', 'atasehir', 'atasheir', 'ataşeir', 'atashir', 'atasehr', 'atasheer', 'ataşehri', 'atasehri', 'اتاشهير', 'اتاشيهير', 'içerenköy', 'icerenkoy', 'küçükbakkalköy', 'kucukbakkalkoy', 'batıataşehir', 'batiatasehir', 'barbaros mahallesi', 'ferhatpaşa'] },
  { name: 'Avcılar',        aliases: ['avcılar', 'avcilar', 'avcilar', 'avclar', 'avsilar', 'avcilarr', 'ambarlı', 'ambarli', 'firuzköy', 'firuzkoy', 'denizköşkler', 'denizkoskler', 'tahtakale'] },
  { name: 'Bağcılar',       aliases: ['bağcılar', 'bagcilar', 'bagcilar', 'bagclar', 'bagsilar', 'bacgilar', 'güneşli', 'gunesli', 'mahmutbey', 'kirazlı', 'kirazli', 'demirkapı', 'göztepe mahallesi'] },
  { name: 'Bahçelievler',   aliases: ['bahçelievler', 'bahcelievler', 'bahcelievlar', 'bahçeli evler', 'bahceli evler', 'bahcelevler', 'bahçeevler', 'şirinevler', 'sirinevler', 'yenibosna', 'kocasinan', 'çobançeşme', 'cobancesme'] },
  { name: 'Bakırköy',       aliases: ['bakırköy', 'bakirkoy', 'bakirköy', 'bakirky', 'bakrköy', 'bakirkoi', 'bakirköi', 'bakrikoy', 'باكيركوي', 'باكركوي', 'ataköy', 'atakoy', 'yeşilköy', 'yesilkoy', 'florya', 'yeşilyurt', 'yesilyurt', 'zuhuratbaba', 'şenlikköy', 'senlikkoy', 'osmaniye'] },
  { name: 'Başakşehir',     aliases: ['başakşehir', 'basaksehir', 'basaksheir', 'basak sehir', 'başak şehir', 'basaksehri', 'başakşehri', 'kayaşehir', 'kayasehir', 'başak', 'guvercintepe', 'güvercintepe', 'şamlar', 'samlar'] },
  { name: 'Bayrampaşa',     aliases: ['bayrampaşa', 'bayrampasa', 'bayrampasha', 'bayrampaşa', 'bayrampaşaa', 'bayampasa', 'altıntepsi', 'altintepsi', 'kartaltepe', 'terazidere', 'vatan'] },
  { name: 'Beşiktaş',       aliases: ['beşiktaş', 'besiktas', 'beshiktas', 'beşiktas', 'besiktash', 'beshiktash', 'besiktaş', 'besiiktas', 'بشيكتاش', 'بيشيكتاش', 'بشكتاش', 'levent', 'etiler', 'bebek', 'ortaköy', 'ortakoy', 'kuruçeşme', 'kurucesme', 'akaretler', 'gayrettepe', 'balmumcu', 'nispetiye', 'ulus mahallesi', 'dikilitaş', 'dikilitas', 'abbasağa', 'abbasaga'] },
  { name: 'Beykoz',         aliases: ['beykoz', 'beikoz', 'beykoze', 'kanlıca', 'kanlica', 'kavacık', 'kavacik', 'anadoluhisarı', 'anadoluhisari', 'paşabahçe', 'pasabahce', 'çubuklu', 'cubuklu', 'acarkent'] },
  { name: 'Beylikdüzü',     aliases: ['beylikdüzü', 'beylikduzu', 'beylikdzu', 'beylik duzu', 'beylikdüzü', 'beylikduzü', 'beylikduezue', 'gürpınar', 'gurpinar', 'yakuplu', 'kavaklı mahallesi', 'adnankahveci', 'cumhuriyet mahallesi'] },
  { name: 'Beyoğlu',        aliases: ['beyoğlu', 'beyoglu', 'beyoglo', 'beyolu', 'beyogly', 'beyoğlo', 'beyoğlu', 'بيوغلو', 'بي اوغلو', 'بيأوغلو', 'taksim', 'galata', 'karaköy', 'karakoy', 'cihangir', 'şişhane', 'sishane', 'tarlabaşı', 'tarlabasi', 'tophane', 'kasımpaşa', 'kasimpasa', 'galatasaray', 'çukurcuma', 'cukurcuma', 'istiklal', 'asmalımescit', 'asmalimescit', 'kabataş', 'kabatas', 'dolapdere', 'piyalepaşa', 'piyalepasa'] },
  { name: 'Büyükçekmece',   aliases: ['büyükçekmece', 'buyukcekmece', 'buyuk cekmece', 'buyukcekmeje', 'buyukcekmese', 'kumburgaz', 'celaliye', 'güzelce', 'guzelce', 'mimarsinan mahallesi', 'türkoba', 'turkoba'] },
  { name: 'Çatalca',        aliases: ['çatalca', 'catalca', 'chatalca', 'catalka', 'catlaca', 'çatalka', 'kaleiçi', 'kaleici', 'ferhatpaşa çatalca', 'çanakça', 'canakca'] },
  { name: 'Çekmeköy',       aliases: ['çekmeköy', 'cekmekoy', 'cekmekoi', 'çekmeköi', 'cekmeköy', 'cekmekoy', 'cekmeky', 'taşdelen', 'tasdelen', 'alemdağ', 'alemdag', 'ömerli', 'omerli', 'hamidiye çekmeköy'] },
  { name: 'Esenler',        aliases: ['esenler', 'esenlerr', 'esenlr', 'oruçreis', 'orucreis', 'havaalanı mahallesi', 'menderes mahallesi'] },
  { name: 'Esenyurt',       aliases: ['esenyurt', 'esenyurtt', 'esenyutr', 'esenyrt', 'اسنيورت', 'اسينيورت', 'kıraç', 'kirac', 'saadetdere', 'incirtepe', 'balıkyolu', 'balikyolu', 'yenikent'] },
  { name: 'Eyüpsultan',     aliases: ['eyüpsultan', 'eyupsultan', 'eyipsultan', 'eyup sultan', 'eyüp sultan', 'eyupsoltaan', 'eyupsultn', 'eyupsultaan', 'eyüp', 'eyup', 'alibeyköy', 'alibeykoy', 'göktürk', 'gokturk', 'kemerburgaz', 'rami', 'silahtarağa', 'silahtaraga', 'nişanca', 'nisanca'] },
  { name: 'Fatih',          aliases: ['fatih', 'fatıh', 'fatiih', 'الفاتح', 'فاتح', 'sultanahmet', 'eminönü', 'eminonu', 'aksaray', 'çapa', 'capa', 'balat', 'fener', 'çarşamba', 'carsamba', 'fındıkzade', 'findikzade', 'vefa', 'süleymaniye', 'suleymaniye', 'beyazıt', 'beyazit', 'laleli', 'kumkapı', 'kumkapi', 'samatya', 'yedikule', 'cibali', 'edirnekapı', 'edirnekapi', 'karagümrük', 'karagumruk', 'çemberlitaş', 'cemberlitas', 'sirkeci', 'zeyrek'] },
  { name: 'Gaziosmanpaşa',  aliases: ['gaziosmanpaşa', 'gaziosmanpasa', 'gaziosmanpasha', 'gaziomanpasa', 'gaziosmanpaşaa', 'gop', 'g.o.p', 'küçükköy', 'kucukkoy', 'karayolları', 'karayollari'] },
  { name: 'Güngören',       aliases: ['güngören', 'gungoren', 'gungören', 'güngoren', 'gungoran', 'gungöen', 'gungoern', 'merter', 'tozkoparan', 'güneştepe', 'gunestepe'] },
  { name: 'Kadıköy',        aliases: ['kadıköy', 'kadiköy', 'kadikoy', 'kadkoy', 'kadicoy', 'kadıkoi', 'kadikoi', 'kadıköi', 'kadikoey', 'كاديكوي', 'قاديكوي', 'كادكوي', 'moda', 'suadiye', 'caddebostan', 'bağdat caddesi', 'bagdat caddesi', 'kozyatağı', 'kozyatagi', 'fenerbahçe', 'fenerbahce', 'göztepe', 'goztepe', 'acıbadem', 'acibadem', 'fikirtepe', 'hasanpaşa', 'hasanpasa', 'koşuyolu', 'kosuyolu', 'erenköy', 'erenkoy', 'sahrayıcedit', 'sahrayicedit', 'bostancı', 'bostanci', 'feneryolu', 'osmanağa', 'osmanaga', 'merdivenköy', 'merdivenkoy'] },
  { name: 'Kağıthane',      aliases: ['kağıthane', 'kagithane', 'kagitahne', 'kagithne', 'kagitane', 'kagithann', 'kağıthne', 'kagıthane', 'gültepe', 'gultepe', 'çağlayan', 'caglayan', 'seyrantepe', 'çeliktepe', 'celiktepe', 'nurtepe', 'gürsel', 'gursel'] },
  { name: 'Kartal',         aliases: ['kartal', 'kartaal', 'karatl', 'yakacık', 'yakacik', 'soğanlık', 'soganlik', 'kordonboyu', 'atalar', 'orhantepe', 'uğur mumcu kartal'] },
  { name: 'Küçükçekmece',   aliases: ['küçükçekmece', 'kucukcekmece', 'kucuk cekmece', 'küçük cekmece', 'kucucekmece', 'kucukcekmeje', 'sefaköy', 'sefakoy', 'halkalı', 'halkali', 'kanarya', 'beşyol', 'besyol', 'cennet mahallesi', 'yeşilova', 'yesilova'] },
  { name: 'Maltepe',        aliases: ['maltepe', 'malteppe', 'maltepi', 'küçükyalı', 'kucukyali', 'idealtepe', 'başıbüyük', 'basibuyuk', 'gülsuyu', 'gulsuyu', 'zümrütevler', 'zumrutevler', 'altayçeşme', 'altaycesme', 'fındıklı maltepe'] },
  { name: 'Pendik',         aliases: ['pendik', 'pendiik', 'pendick', 'pandik', 'kaynarca', 'kurtköy', 'kurtkoy', 'güzelyalı', 'guzelyali', 'velibaba', 'sapanbağları', 'sapanbaglari', 'çamçeşme', 'camcesme'] },
  { name: 'Sancaktepe',     aliases: ['sancaktepe', 'sancaktepi', 'sancaktpe', 'sancakteep', 'sarıgazi', 'sarigazi', 'samandıra', 'samandira', 'veysel karani', 'meclis mahallesi'] },
  { name: 'Sarıyer',        aliases: ['sarıyer', 'sariyer', 'saryer', 'sariyr', 'sarıyr', 'sariyerr', 'sariyer', 'maslak', 'tarabya', 'istinye', 'i̇stinye', 'yeniköy', 'yenikoy', 'emirgan', 'baltalimanı', 'baltalimani', 'büyükdere', 'buyukdere', 'bahçeköy', 'bahcekoy', 'zekeriyaköy', 'zekeriyakoy', 'kireçburnu', 'kirecburnu', 'rumelihisarı', 'rumelihisari', 'ayazağa', 'ayazaga', 'reşitpaşa', 'resitpasa', 'kilyos'] },
  { name: 'Silivri',        aliases: ['silivri', 'silivrii', 'silivry', 'siliviri', 'selimpaşa', 'selimpasa', 'gümüşyaka', 'gumusyaka', 'değirmenköy', 'degirmenkoy'] },
  { name: 'Sultanbeyli',    aliases: ['sultanbeyli', 'sultanbeyly', 'sultanbeily', 'sultanbeylli', 'turgutreis sultanbeyli', 'ahmet yesevi', 'battalgazi'] },
  { name: 'Sultangazi',     aliases: ['sultangazi', 'sultangazy', 'sultangazii', 'habibler', 'sultançiftliği', 'sultanciftligi', 'gazi mahallesi', 'cebeci sultangazi'] },
  { name: 'Şile',           aliases: ['şile', 'sile', 'shile', 'şille', 'sille', 'ağva', 'agva', 'kumbaba', 'kabakoz'] },
  { name: 'Şişli',          aliases: ['şişli', 'sisli', 'shishli', 'sishli', 'sisly', 'shisli', 'şisli', 'sişli', 'شيشلي', 'شيشلى', 'mecidiyeköy', 'mecidiyekoy', 'nişantaşı', 'nisantasi', 'fulya', 'bomonti', 'harbiye', 'teşvikiye', 'tesvikiye', 'osmanbey', 'kurtuluş', 'kurtulus', 'feriköy', 'ferikoy', 'halaskargazi', 'pangaltı', 'pangalti', 'gülbağ', 'gulbag'] },
  { name: 'Tuzla',          aliases: ['tuzla', 'tuzlaa', 'tuzlab', 'aydınlı', 'aydinli', 'içmeler', 'icmeler', 'aydıntepe', 'aydintepe', 'şifa mahallesi', 'mimar sinan tuzla'] },
  { name: 'Ümraniye',       aliases: ['ümraniye', 'umraniye', 'umraniy', 'umranie', 'ümraniy', 'umraniye', 'umraniyee', 'amraniye', 'dudullu', 'çakmak ümraniye', 'cakmak umraniye', 'ihlamurkuyu', 'hekimbaşı', 'hekimbasi', 'yamanevler', 'esenşehir', 'esensehir', 'tantavi', 'madenler'] },
  { name: 'Üsküdar',        aliases: ['üsküdar', 'uskudar', 'uskdar', 'uskudr', 'uskudaar', 'oskudar', 'üskudar', 'uskudra', 'üsküdr', 'usküdar', 'اسكودار', 'اسكدار', 'çengelköy', 'cengelkoy', 'kuzguncuk', 'altunizade', 'kısıklı', 'kisikli', 'beylerbeyi', 'çamlıca', 'camlica', 'kandilli', 'salacak', 'selimiye üsküdar', 'küçüksu', 'kucuksu', 'bulgurlu', 'ünalan', 'unalan', 'kuleli'] },
  { name: 'Zeytinburnu',    aliases: ['zeytinburnu', 'zeytinburno', 'zeytinburmu', 'zeytibburnu', 'zeytinborno', 'zeytinbrunu', 'merkezefendi', 'kazlıçeşme', 'kazlicesme', 'seyitnizam', 'veliefendi', 'çırpıcı', 'cirpici', 'beştelsiz', 'bestelsiz', 'sümer mahallesi'] },
];

// Flat list of { alias, name } sorted by alias length DESC so longer / more
// specific names match before short prefixes (e.g. "eyüpsultan" before "eyüp").
const DISTRICT_LOOKUP: Array<{ alias: string; name: string }> = DISTRICT_ALIASES
  .flatMap(d => d.aliases.map(alias => ({ alias: normalizeText(alias), name: d.name })))
  .sort((a, b) => b.alias.length - a.alias.length);

/** Find the first district mentioned in `text` (already normalized). Null if none. */
function findDistrict(text: string): string | null {
  // 1) Exact whole-word match (fast, precise).
  for (const { alias, name } of DISTRICT_LOOKUP) {
    if (containsTerm(text, alias)) return name;
  }
  // 2) Fuzzy fallback — 0.72 catches transpositions and 1-2 char typos.
  return fuzzyMatch(text, DISTRICT_LOOKUP, d => d.alias, d => d.name, 0.72);
}

// ── Business-type detection ─────────────────────────────────────────────────────
// keyword → display-label. Labels are chosen so protocol.detectType() classifies
// them into the right roadmap (food / retail / service). Sorted longest-first at use.

const BUSINESS_TYPE_MAP: Record<string, string> = {
  // ── Food & drink ──
  cafe: 'Cafe & Coffee Shop', café: 'Cafe & Coffee Shop', coffee: 'Cafe & Coffee Shop',
  kafe: 'Cafe & Coffee Shop', kahve: 'Cafe & Coffee Shop', kahvehane: 'Cafe & Coffee Shop',
  coffeeshop: 'Cafe & Coffee Shop', 'coffee shop': 'Cafe & Coffee Shop',
  restaurant: 'Restaurant', restoran: 'Restaurant', lokanta: 'Restaurant', bistro: 'Restaurant',
  diner: 'Restaurant', eatery: 'Restaurant', food: 'Restaurant', 'fast food': 'Restaurant',
  fastfood: 'Restaurant', pizza: 'Pizza Restaurant', pizzeria: 'Pizza Restaurant',
  burger: 'Burger Restaurant', döner: 'Döner / Kebab Restaurant', doner: 'Döner / Kebab Restaurant',
  kebab: 'Döner / Kebab Restaurant', kebap: 'Döner / Kebab Restaurant', steakhouse: 'Restaurant',
  bakery: 'Bakery', fırın: 'Bakery', firin: 'Bakery', ekmek: 'Bakery',
  patisserie: 'Bakery & Patisserie', pastane: 'Bakery & Patisserie', pastry: 'Bakery & Patisserie',
  dessert: 'Bakery & Patisserie', tatlı: 'Bakery & Patisserie', tatli: 'Bakery & Patisserie',
  'ice cream': 'Ice Cream Shop (Food)', dondurma: 'Ice Cream Shop (Food)',
  juice: 'Juice Bar (Food)', smoothie: 'Juice Bar (Food)',
  bar: 'Bar / Pub', pub: 'Bar / Pub', nightclub: 'Bar / Pub', 'night club': 'Bar / Pub',
  butcher: 'Butcher Shop (Food)', kasap: 'Butcher Shop (Food)',
  // ── Retail ──
  retail: 'Retail Store', shop: 'Retail Store', store: 'Retail Store', dükkan: 'Retail Store',
  dukkan: 'Retail Store', mağaza: 'Retail Store', magaza: 'Retail Store', boutique: 'Retail Store',
  butik: 'Retail Store', clothing: 'Clothing Store', clothes: 'Clothing Store', giyim: 'Clothing Store',
  fashion: 'Clothing Store', market: 'Grocery / Market (Retail)', grocery: 'Grocery / Market (Retail)',
  bakkal: 'Grocery / Market (Retail)', supermarket: 'Grocery / Market (Retail)',
  süpermarket: 'Grocery / Market (Retail)', market_: 'Grocery / Market (Retail)',
  electronics: 'Electronics Store (Retail)', elektronik: 'Electronics Store (Retail)',
  phone: 'Phone Shop (Retail)', telefon: 'Phone Shop (Retail)',
  furniture: 'Furniture Store (Retail)', mobilya: 'Furniture Store (Retail)',
  jewelry: 'Jewelry Store (Retail)', jeweller: 'Jewelry Store (Retail)', kuyumcu: 'Jewelry Store (Retail)',
  bookstore: 'Bookstore (Retail)', kitapçı: 'Bookstore (Retail)', kitapevi: 'Bookstore (Retail)',
  florist: 'Florist (Retail)', çiçekçi: 'Florist (Retail)', cicekci: 'Florist (Retail)',
  petshop: 'Pet Shop (Retail)', 'pet shop': 'Pet Shop (Retail)', optician: 'Optician (Retail)',
  gözlükçü: 'Optician (Retail)', wholesale: 'Wholesale Store (Retail)', toptan: 'Wholesale Store (Retail)',
  textile: 'Textile Store (Retail)', tekstil: 'Textile Store (Retail)',
  // ── Service / office ──
  office: 'Office / Consulting', ofis: 'Office / Consulting', consulting: 'Office / Consulting',
  danışmanlık: 'Office / Consulting', agency: 'Office / Consulting', ajans: 'Office / Consulting',
  tech: 'Tech / Software Office', software: 'Tech / Software Office', yazılım: 'Tech / Software Office',
  startup: 'Tech / Software Office', coworking: 'Coworking Office', accounting: 'Accounting Office',
  muhasebe: 'Accounting Office', 'real estate': 'Real Estate Office', emlak: 'Real Estate Office',
  travel: 'Travel Agency (Service)', seyahat: 'Travel Agency (Service)', turizm: 'Travel Agency (Service)',
  barber: 'Barber / Hair Salon', berber: 'Barber / Hair Salon', kuaför: 'Barber / Hair Salon',
  kuafor: 'Barber / Hair Salon', salon: 'Barber / Hair Salon', hairdresser: 'Barber / Hair Salon',
  beauty: 'Beauty Salon (Service)', güzellik: 'Beauty Salon (Service)', spa: 'Spa (Service)',
  nail: 'Nail Salon (Service)', tırnak: 'Nail Salon (Service)',
  tattoo: 'Tattoo Studio (Service)', dövme: 'Tattoo Studio (Service)',
  gym: 'Gym / Fitness', fitness: 'Gym / Fitness', spor: 'Gym / Fitness', crossfit: 'Gym / Fitness',
  pilates: 'Gym / Fitness', yoga: 'Yoga / Fitness Studio',
  laundry: 'Laundry (Service)', 'dry cleaning': 'Laundry (Service)', 'kuru temizleme': 'Laundry (Service)',
  carwash: 'Car Wash (Service)', 'car wash': 'Car Wash (Service)', 'oto yıkama': 'Car Wash (Service)',
  garage: 'Auto Repair (Service)', tamirci: 'Auto Repair (Service)', 'oto tamir': 'Auto Repair (Service)',
  photography: 'Photography Studio (Service)', fotoğraf: 'Photography Studio (Service)',
  studio: 'Studio (Service)', stüdyo: 'Studio (Service)', workshop: 'Workshop (Service)',
  atölye: 'Workshop (Service)', school: 'Education Center (School)', kurs: 'Education Center (School)',
  course: 'Education Center (School)', dershane: 'Education Center (School)',
  daycare: 'Daycare (School)', kreş: 'Daycare (School)', nursery: 'Daycare (School)',
  anaokulu: 'Daycare (School)',
  pharmacy: 'Pharmacy', eczane: 'Pharmacy',
  hotel: 'Hotel', otel: 'Hotel', hostel: 'Hotel', pansiyon: 'Hotel',
  clinic: 'Medical Clinic', klinik: 'Medical Clinic', doctor: 'Medical Clinic', doktor: 'Medical Clinic',
  dental: 'Dental Clinic', dentist: 'Dental Clinic', diş: 'Dental Clinic',
  vet: 'Veterinary Clinic', veteriner: 'Veterinary Clinic',
  // ── Arabic / common shorthand ──
  مقهى: 'Cafe & Coffee Shop', مطعم: 'Restaurant', محل: 'Retail Store', مكتب: 'Office / Consulting',
  صالون: 'Barber / Hair Salon', جيم: 'Gym / Fitness', مخبز: 'Bakery', فندق: 'Hotel',
  صيدلية: 'Pharmacy', عيادة: 'Medical Clinic', متجر: 'Retail Store', مخبزة: 'Bakery',
  // ── Arabic dialectal / transliterated variants ──
  كافيه: 'Cafe & Coffee Shop', كافي: 'Cafe & Coffee Shop', قهوة: 'Cafe & Coffee Shop',
  بيتزا: 'Pizza Restaurant', برجر: 'Burger Restaurant', مطعمي: 'Restaurant',
  بقالة: 'Grocery / Market (Retail)', بقاله: 'Grocery / Market (Retail)',
  ماركت: 'Grocery / Market (Retail)', سوبرماركت: 'Grocery / Market (Retail)',
  'سوبر ماركت': 'Grocery / Market (Retail)', بقالية: 'Grocery / Market (Retail)',
  ملابس: 'Clothing Store', ازياء: 'Clothing Store', بوتيك: 'Retail Store',
  حلويات: 'Bakery & Patisserie', مخبزه: 'Bakery', فرن: 'Bakery',
  حلاق: 'Barber / Hair Salon', 'صالون حلاقة': 'Barber / Hair Salon', كوافير: 'Barber / Hair Salon',
  نادي: 'Gym / Fitness', 'نادي رياضي': 'Gym / Fitness', 'صالة رياضية': 'Gym / Fitness',
  صيدليه: 'Pharmacy', عياده: 'Medical Clinic', مستوصف: 'Medical Clinic',
  مكتبه: 'Bookstore (Retail)', مكتبة: 'Bookstore (Retail)', ورشة: 'Workshop (Service)',
  مغسلة: 'Laundry (Service)', الكتروني: 'Electronics Store (Retail)', الكترونيات: 'Electronics Store (Retail)',
  // ── Common misspellings (typo-tolerant exact matches; fuzzy catches the rest) ──
  caffe: 'Cafe & Coffee Shop', caffee: 'Cafe & Coffee Shop', kaffe: 'Cafe & Coffee Shop',
  cafee: 'Cafe & Coffee Shop', caffey: 'Cafe & Coffee Shop', cofee: 'Cafe & Coffee Shop',
  coffe: 'Cafe & Coffee Shop',
  resturant: 'Restaurant', restourant: 'Restaurant', restarant: 'Restaurant',
  restaraunt: 'Restaurant', restaurent: 'Restaurant', restront: 'Restaurant',
  restoraunt: 'Restaurant', resataurant: 'Restaurant', restuarant: 'Restaurant',
  pizzaria: 'Pizza Restaurant', burgur: 'Burger Restaurant', berger: 'Burger Restaurant',
  bakary: 'Bakery', bakkery: 'Bakery', bakeri: 'Bakery', bakerry: 'Bakery',
  pharmcy: 'Pharmacy', farmacy: 'Pharmacy', pharmecy: 'Pharmacy', pharmasy: 'Pharmacy',
  pharamcy: 'Pharmacy', pharmacie: 'Pharmacy',
  barbar: 'Barber / Hair Salon', barbor: 'Barber / Hair Salon', barbershop: 'Barber / Hair Salon',
  'barber shop': 'Barber / Hair Salon', saloon: 'Barber / Hair Salon', salom: 'Barber / Hair Salon',
  gymm: 'Gym / Fitness', fitnes: 'Gym / Fitness', fitnees: 'Gym / Fitness',
  hotal: 'Hotel', hottel: 'Hotel', hotell: 'Hotel',
  clinik: 'Medical Clinic', clinc: 'Medical Clinic', cliinic: 'Medical Clinic',
  clinique: 'Medical Clinic', klinic: 'Medical Clinic',
  retial: 'Retail Store', retali: 'Retail Store', retaill: 'Retail Store',
  ofice: 'Office / Consulting', offise: 'Office / Consulting', ofiice: 'Office / Consulting',
  offce: 'Office / Consulting',
  markett: 'Grocery / Market (Retail)', markat: 'Grocery / Market (Retail)',
  supermarkat: 'Grocery / Market (Retail)', 'super market': 'Grocery / Market (Retail)',
  resturent: 'Restaurant', dentl: 'Dental Clinic', denatl: 'Dental Clinic',
  jewellery: 'Jewelry Store (Retail)', jewelery: 'Jewelry Store (Retail)',
  furnitur: 'Furniture Store (Retail)', clothin: 'Clothing Store', clothng: 'Clothing Store',
};

// Aliases sorted longest-first so "coffee shop" beats "shop", "real estate" beats nothing partial, etc.
const BUSINESS_LOOKUP: Array<{ keyword: string; label: string }> = Object.entries(BUSINESS_TYPE_MAP)
  .map(([keyword, label]) => ({ keyword: normalizeText(keyword.replace(/_$/, '')), label }))
  .sort((a, b) => b.keyword.length - a.keyword.length);

/** Find the first business type mentioned in `text` (already normalized). Null if none. */
function findBusinessType(text: string): string | null {
  // 1) Exact whole-word match (fast, precise).
  for (const { keyword, label } of BUSINESS_LOOKUP) {
    if (containsTerm(text, keyword)) return label;
  }
  // 2) Fuzzy fallback — 0.75 catches common typos like "resturant", "pharmcy", "bakary".
  return fuzzyMatch(text, BUSINESS_LOOKUP, b => b.keyword, b => b.label, 0.75);
}

// ── Student-service detection ─────────────────────────────────────────────────
// keyword → service label (must match RENEWAL_SERVICES in chat/page.tsx).
// Only runs when assistantType === 'student', so short generic words (visa, dorm)
// don't fire for the other agents.

const STUDENT_SERVICE_MAP: Record<string, string> = {
  // ── İkamet / Student ID ────────────────────────────────────────────────────
  // Standalone 'id' is safe here — this map only runs for assistantType=student.
  'id': 'ID / İkamet',
  'ikamet': 'ID / İkamet',
  'ikamet card': 'ID / İkamet',
  'ikamet izni': 'ID / İkamet',
  'ikamet renewal': 'ID / İkamet',
  'residence permit': 'ID / İkamet',
  'residence card': 'ID / İkamet',
  'oturma izni': 'ID / İkamet',
  'oturma': 'ID / İkamet',
  'kimlik': 'ID / İkamet',
  'student id': 'ID / İkamet',
  'id card': 'ID / İkamet',
  'id renewal': 'ID / İkamet',
  // Action phrases — catches natural language like "i wanna apply to id"
  'apply to id': 'ID / İkamet',
  'apply for id': 'ID / İkamet',
  'get my id': 'ID / İkamet',
  'need my id': 'ID / İkamet',
  'want my id': 'ID / İkamet',
  'get an id': 'ID / İkamet',
  'need an id': 'ID / İkamet',
  'want an id': 'ID / İkamet',
  'apply to ikamet': 'ID / İkamet',
  'apply for ikamet': 'ID / İkamet',
  'get ikamet': 'ID / İkamet',
  'need ikamet': 'ID / İkamet',
  'want ikamet': 'ID / İkamet',
  'apply for residence': 'ID / İkamet',
  'get residence permit': 'ID / İkamet',
  'need residence permit': 'ID / İkamet',
  'apply for kimlik': 'ID / İkamet',
  'get kimlik': 'ID / İkamet',
  'need kimlik': 'ID / İkamet',
  // ── Denklik / equivalency ──────────────────────────────────────────────────
  'denklik': 'Denklik (Equivalency)',
  'denlik': 'Denklik (Equivalency)',
  'equivalency': 'Denklik (Equivalency)',
  'equivalence': 'Denklik (Equivalency)',
  'diploma equivalency': 'Denklik (Equivalency)',
  'diploma recognition': 'Denklik (Equivalency)',
  'diploma equivalent': 'Denklik (Equivalency)',
  'diploma equivalence': 'Denklik (Equivalency)',
  'apply for denklik': 'Denklik (Equivalency)',
  'apply to denklik': 'Denklik (Equivalency)',
  'get denklik': 'Denklik (Equivalency)',
  'need denklik': 'Denklik (Equivalency)',
  'want denklik': 'Denklik (Equivalency)',
  'apply for equivalency': 'Denklik (Equivalency)',
  'get equivalency': 'Denklik (Equivalency)',
  // ── University registration ────────────────────────────────────────────────
  'university registration': 'University Registration',
  'uni registration': 'University Registration',
  'university enrollment': 'University Registration',
  'university enroll': 'University Registration',
  'enroll university': 'University Registration',
  'register university': 'University Registration',
  'university register': 'University Registration',
  'üniversite kaydı': 'University Registration',
  'universite kaydi': 'University Registration',
  'kayit': 'University Registration',
  'kayıt': 'University Registration',
  'enroll': 'University Registration',
  'enrollment': 'University Registration',
  'register at university': 'University Registration',
  'apply to university': 'University Registration',
  'apply for university': 'University Registration',
  // ── Student visa ───────────────────────────────────────────────────────────
  'student visa': 'Student Visa',
  'öğrenci vizesi': 'Student Visa',
  'ogrenci vizesi': 'Student Visa',
  'visa': 'Student Visa',
  'vize': 'Student Visa',
  'apply for visa': 'Student Visa',
  'apply to visa': 'Student Visa',
  'get visa': 'Student Visa',
  'need visa': 'Student Visa',
  'want visa': 'Student Visa',
  'student visa application': 'Student Visa',
  // ── Dormitory & housing ────────────────────────────────────────────────────
  'dormitory': 'Dormitory & Housing',
  'dorm': 'Dormitory & Housing',
  'student dorm': 'Dormitory & Housing',
  'student housing': 'Dormitory & Housing',
  'housing': 'Dormitory & Housing',
  'yurt': 'Dormitory & Housing',
  'kyk': 'Dormitory & Housing',
  'find dorm': 'Dormitory & Housing',
  'find housing': 'Dormitory & Housing',
  'need housing': 'Dormitory & Housing',
  'need dorm': 'Dormitory & Housing',
  'student accommodation': 'Dormitory & Housing',
  // ── IstanbulKart ───────────────────────────────────────────────────────────
  'istanbulkart': 'IstanbulKart',
  'istanbul kart': 'IstanbulKart',
  'transport card': 'IstanbulKart',
  'travel card': 'IstanbulKart',
  'student card': 'IstanbulKart',
  'student transport': 'IstanbulKart',
  'ulaşım kartı': 'IstanbulKart',
  'ulasim karti': 'IstanbulKart',
  'get istanbulkart': 'IstanbulKart',
  'need istanbulkart': 'IstanbulKart',
  // ── Arabic student services — covers both ة (ta marbuta) and ه forms ──────────
  // normalizeText() folds ة→ه so entries here match either spelling users type.
  // Short standalone keywords (اقامه, فيزا, سكن) are safe here because
  // findStudentService() only runs when assistantType === 'student'.
  'اقامه': 'ID / İkamet', 'اقامة': 'ID / İkamet',
  'إقامه': 'ID / İkamet', 'إقامة': 'ID / İkamet',
  'الاقامه': 'ID / İkamet', 'الاقامة': 'ID / İkamet',
  'اقامه طالب': 'ID / İkamet', 'اقامة طالب': 'ID / İkamet',
  'إقامه طالب': 'ID / İkamet', 'إقامة طالب': 'ID / İkamet',
  'تجديد اقامه': 'ID / İkamet', 'تجديد اقامة': 'ID / İkamet',
  'تجديد الاقامه': 'ID / İkamet', 'تجديد الاقامة': 'ID / İkamet',
  'تصريح اقامه': 'ID / İkamet', 'تصريح اقامة': 'ID / İkamet',
  'بطاقة اقامه': 'ID / İkamet', 'بطاقة اقامة': 'ID / İkamet',
  'دنكلك': 'Denklik (Equivalency)', 'دنكليك': 'Denklik (Equivalency)',
  'معادله': 'Denklik (Equivalency)', 'معادلة': 'Denklik (Equivalency)',
  'معادله شهاده': 'Denklik (Equivalency)', 'معادلة شهادة': 'Denklik (Equivalency)',
  'معادلة الشهادة': 'Denklik (Equivalency)', 'معادله الشهاده': 'Denklik (Equivalency)',
  'تسجيل جامعي': 'University Registration',
  'التسجيل الجامعي': 'University Registration',
  'تسجيل في الجامعه': 'University Registration', 'تسجيل في الجامعة': 'University Registration',
  'تسجيل بالجامعه': 'University Registration', 'تسجيل بالجامعة': 'University Registration',
  'قيد جامعي': 'University Registration',
  'فيزا': 'Student Visa', 'فيزا طالب': 'Student Visa',
  'تأشيره': 'Student Visa', 'تأشيرة': 'Student Visa',
  'تاشيره': 'Student Visa', 'تاشيرة': 'Student Visa',
  'تأشيره دراسيه': 'Student Visa', 'تأشيرة دراسية': 'Student Visa',
  'فيزا دراسيه': 'Student Visa', 'فيزا دراسية': 'Student Visa',
  'سكن': 'Dormitory & Housing', 'سكن طلاب': 'Dormitory & Housing',
  'سكن الطلاب': 'Dormitory & Housing', 'سكن جامعي': 'Dormitory & Housing',
  'مبيت': 'Dormitory & Housing', 'يورت': 'Dormitory & Housing',
  'اسطنبول كارت': 'IstanbulKart', 'استانبول كارت': 'IstanbulKart',
  'بطاقة مواصلات': 'IstanbulKart', 'كرت مواصلات': 'IstanbulKart',
  'كارت مواصلات': 'IstanbulKart', 'بطاقة طالب': 'IstanbulKart',
  // Common phonetic/colloquial misspellings of "card" → كوت/كوتش/كارد
  'كوت مواصلات': 'IstanbulKart', 'كوت الطالب': 'IstanbulKart',
  'كوت طالب': 'IstanbulKart', 'كوت اسطنبول': 'IstanbulKart',
  'كارد مواصلات': 'IstanbulKart', 'كارد طالب': 'IstanbulKart',
  'مواصلات': 'IstanbulKart', 'تذكره مواصلات': 'IstanbulKart',
  'بطاقه مواصلات': 'IstanbulKart', 'كرت الطالب': 'IstanbulKart',
  // ── Common misspellings (typo-tolerant exact matches; fuzzy catches the rest) ──
  'ikamett': 'ID / İkamet', 'ikamet izin': 'ID / İkamet', 'ikamat': 'ID / İkamet',
  'ikemet': 'ID / İkamet', 'iqamet': 'ID / İkamet', 'ikamet karti': 'ID / İkamet',
  'kimlik karti': 'ID / İkamet', 'kimilik': 'ID / İkamet', 'residance permit': 'ID / İkamet',
  'residense permit': 'ID / İkamet', 'recidence permit': 'ID / İkamet',
  'denkik': 'Denklik (Equivalency)', 'denkilik': 'Denklik (Equivalency)',
  'denlkik': 'Denklik (Equivalency)', 'denklikk': 'Denklik (Equivalency)',
  'equivalancy': 'Denklik (Equivalency)', 'equvalency': 'Denklik (Equivalency)',
  'equivelancy': 'Denklik (Equivalency)', 'equivelency': 'Denklik (Equivalency)',
  'universty registration': 'University Registration', 'univercity registration': 'University Registration',
  'uni registeration': 'University Registration', 'university registeration': 'University Registration',
  'universty': 'University Registration', 'univercity': 'University Registration',
  'enroled': 'University Registration', 'enrolment': 'University Registration',
  'vissa': 'Student Visa', 'viza': 'Student Visa', 'student vissa': 'Student Visa',
  'studnet visa': 'Student Visa', 'visaa': 'Student Visa',
  'dormitry': 'Dormitory & Housing', 'dormitary': 'Dormitory & Housing',
  'dormetory': 'Dormitory & Housing', 'housng': 'Dormitory & Housing',
  'accomodation': 'Dormitory & Housing', 'acommodation': 'Dormitory & Housing',
  'istanbul card': 'IstanbulKart', 'istanbulcard': 'IstanbulKart', 'istambulkart': 'IstanbulKart',
  'transprt card': 'IstanbulKart',
};

const STUDENT_SERVICE_LOOKUP: Array<{ keyword: string; label: string }> = Object.entries(STUDENT_SERVICE_MAP)
  .map(([keyword, label]) => ({ keyword: normalizeText(keyword), label }))
  .sort((a, b) => b.keyword.length - a.keyword.length);

/** Find a student service from `text` (already normalized). Null if none. */
function findStudentService(text: string): string | null {
  for (const { keyword, label } of STUDENT_SERVICE_LOOKUP) {
    if (containsTerm(text, keyword)) return label;
  }
  // Fuzzy fallback — 0.78 catches typos like "ikamett", "denkik", "univercity".
  return fuzzyMatch(text, STUDENT_SERVICE_LOOKUP, s => s.keyword, s => s.label, 0.78);
}

const UNIVERSITY_HINTS = [
  'boğaziçi','bogazici','bosphorus','istanbul university','istanbul üniversitesi',
  'metu','odtü','odtu','middle east technical','koç','koc','bilkent',
  'sabancı','sabanci','yıldız','yildiz','itu','technical university',
  'altınbaş','altinbas','medipol','marmara','galatasaray','haliç','halic',
  'beykent','bahçeşehir','bahcesehir','bau','özyeğin','ozyegin','doğuş','dogus',
  'nişantaşı','nisantasi','gedik','maltepe university',
];

// ── Business-intent trigger patterns (triggers flow even on first message) ────

const OPEN_BUSINESS_PATTERNS = [
  /\bopen\b|\bstart\b|\blaunch\b|\bset up\b|\bsetup\b/i,
  /\bbusiness\b|\bcompany\b|\bshop\b|\bstore\b|\bpermit\b/i,
  /\bruhsat\b|\biş\b|\bişletme\b|\baçmak\b|\baçmak istiyorum\b/i,
  /\bkafe\b|\brestoran\b|\bberber\b|\bfırın\b/i,
  /\bi want to\b|\bi'd like to\b|\bplanning to\b|\bthinking of\b/i,
  // Arabic (incl. Gulf/Levant/Egyptian dialects). No \b — it doesn't work on
  // Arabic script. Tested against NORMALIZED text (alef unified, harakat stripped).
  /(اريد|ابغ|بدي|بغيت|عايز|عاوز|نفسي|حاب|ودي|نبي|عاوزه|عايزه)/, // want
  /(افتح|فتح|اسوي|اعمل|انشئ|انشا|ابدا|تاسيس|بدء)/,               // open / start
  /(مشروع|نشاط|محل|متجر|تجار|شركه|شركة|عمل تجاري)/,             // business nouns
];

function looksLikeOpeningBusiness(text: string): boolean {
  const t = normalizeText(text);
  return OPEN_BUSINESS_PATTERNS.some(p => p.test(t));
}

// ── Data extraction ──────────────────────────────────────────────────────────
// CRITICAL: only scans the USER's own words (current query first, then the user's
// previous messages). It must NOT scan assistant messages — the bot's prompts list
// example districts/business types ("e.g. Kadıköy, Beşiktaş…") which would otherwise
// be mistaken for the user's actual answer and resolve every reply to the first
// example. The current query always wins so the latest answer overrides earlier ones.

export function extractFlowData(
  query: string,                                        // current user input
  messages: Array<{ role: string; content: string }>,  // full history
  assistantType: string,
): FlowData {
  const data: FlowData = {};

  const currentText = normalizeText(query);
  const userHistory = messages
    .filter(m => m.role === 'user')
    .map(m => normalizeText(m.content));
  // Most-recent-first so the latest user statement takes priority.
  const userTexts = [currentText, ...userHistory.reverse()];

  // ── Business type — current query first, then user history ────────────────────
  for (const text of userTexts) {
    const found = findBusinessType(text);
    if (found) { data.businessType = found; break; }
  }

  // ── District — current query first, then user history ─────────────────────────
  for (const text of userTexts) {
    const found = findDistrict(text);
    if (found) { data.district = found; break; }
  }

  // ── Alcohol preference ───────────────────────────────────────────────────────
  // Fire when the user mentions alcohol OR when the bot already asked about it
  // (so a plain "yes"/"no" answer is captured). The yes/no is read from the user only.
  const userCorpus = userTexts.join('\n');
  const userMentionsAlcohol = /(?:^|[^a-z])(alcohol|tapdk|alkol|liquor|wine|beer|bira|şarap|sarap|bar|pub|كحول)(?:$|[^a-z])/i.test(userCorpus);
  const botAskedAlcohol = messages.some(
    m => m.role === 'assistant' && /alcohol|tapdk|alkol|كحول|şarap|sarap/i.test(normalizeText(m.content)),
  );
  if (userMentionsAlcohol || botAskedAlcohol) {
    // Check the user's most recent answers (current query + last 2 user msgs).
    for (const t of userTexts.slice(0, 3)) {
      if (/(?:^|[^a-z])(yes|yeah|yep|sure|of course|we will|want|serve|evet|olur|نعم)(?:$|[^a-z])/i.test(t)) {
        data.hasAlcohol = true; break;
      }
      if (/(?:^|[^a-z])(no|not|nope|don'?t|won'?t|hayır|hayir|yok|لا)(?:$|[^a-z])/i.test(t)) {
        data.hasAlcohol = false; break;
      }
    }
    // If the user brought up alcohol themselves but gave no explicit yes/no, assume yes.
    if (data.hasAlcohol === undefined && userMentionsAlcohol) data.hasAlcohol = true;
  }

  // ── University (student agent) ────────────────────────────────────────────────
  if (assistantType === 'student') {
    for (const text of userTexts) {
      const hit = UNIVERSITY_HINTS.find(hint => text.includes(hint));
      if (hit) {
        const uniMatch = text.match(
          /(?:at|for|in|to)\s+([\w\s]+(?:university|üniversitesi|uni|itu|metu|bau))/i,
        );
        data.universityName = uniMatch?.[1]?.trim() ?? hit;
        break;
      }
    }
  }

  return data;
}

// ── Language helper ──────────────────────────────────────────────────────────

function pick(en: string, tr: string, ar: string, lang: string): string {
  if (lang === 'tr') return tr;
  if (lang === 'ar') return ar;
  return en;
}

// ── PERMIT FLOW ───────────────────────────────────────────────────────────────

function permitFlow(data: FlowData, lang: string): string | null {

  // Stage 1: No business type yet → ask
  if (!data.businessType) {
    return pick(
      `🏪 Let's get your Istanbul business permit sorted!\n\nWhat **type of business** are you planning to open?\n\n> *e.g., Cafe, Restaurant, Retail shop, Clothing store, Office, Gym, Barber, Bakery, Pharmacy, Hotel, Clinic*`,
      `🏪 İstanbul işletme ruhsatınızı halledelim!\n\nAçmayı planladığınız **işletme türü** nedir?\n\n> *örn. Kafe, Restoran, Mağaza, Ofis, Berber, Fırın, Eczane...*`,
      `🏪 لنرتب تصريح عملك في إسطنبول!\n\nما **نوع النشاط التجاري** الذي تخطط لفتحه؟\n\n> *مثال: مقهى، مطعم، محل تجزئة، مكتب، صالون، مخبز...*`,
      lang,
    );
  }

  // Stage 2: Have business type → ask district
  if (!data.district) {
    return pick(
      `✅ Great choice — **${data.businessType}**!\n\nWhich **district of Istanbul** will you be opening in?\n\n> *e.g., Kadıköy, Beşiktaş, Şişli, Beyoğlu, Bakırköy, Ataşehir, Üsküdar, Fatih...*\n\nThe district determines which municipality handles your permit — and processing times can vary by up to 30 days between them.`,
      `✅ Harika seçim — **${data.businessType}**!\n\nHangi **İstanbul ilçesinde** açacaksınız?\n\n> *örn. Kadıköy, Beşiktaş, Şişli, Beyoğlu, Bakırköy...*`,
      `✅ خيار رائع — **${data.businessType}**!\n\nفي أي **حي من إسطنبول** ستفتح؟\n\n> *مثال: كاديكوي، بشيكتاش، شيشلي، بيوغلو، فاتح...*\n\nالحي يحدد أي بلدية تتعامل معها.`,
      lang,
    );
  }

  // Stage 3: Both business type AND district known → hand off to the dashboard.
  // We return a machine sentinel that smartRouter turns into the real roadmap +
  // dashboard_state, so the frontend can show the summary and auto-open the Dashboard.
  return `${DASHBOARD_READY}${data.businessType}|${data.district}`;
}

// ── STUDENT FLOW ──────────────────────────────────────────────────────────────

function studentFlow(
  data: FlowData,
  lang: string,
  intent: string | null,
  query: string,
  messages: Array<{ role: string; content: string }>,
): string | null {
  // Service detection (ikamet, denklik, visa…) is done in guidedFlow() before
  // this function is called, so we only handle intent-based fallbacks here.

  if ((intent === 'register_uni' || intent === 'university_reg') && !data.universityName) {
    return pick(
      `🎓 Let's get your university registration sorted!\n\nWhich **university** are you registering at?\n\n> *e.g., Boğaziçi, Istanbul University, Marmara, Altınbaş, Medipol, Koç, Sabancı, METU, Beykent...*\n\nOnce I know the university, I'll give you the exact registration steps for that institution.`,
      `🎓 Üniversite kaydını halledelim!\n\nHangi **üniversiteye** kayıt yaptırıyorsunuz?\n\n> *örn. Boğaziçi, İstanbul Üniversitesi, Marmara, Altınbaş, Medipol...*`,
      `🎓 لنرتب تسجيلك الجامعي!\n\nفي أي **جامعة** ستسجل؟\n\n> *مثال: بوغازيتشي، جامعة إسطنبول، مرمرة، ألتينباش، ميديبول...*`,
      lang,
    );
  }
  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────

// Intents that ALWAYS have a better dedicated answer than the guided flow —
// social/billing chit-chat and specific topic questions (cost, documents, etc.).
const SKIP_ALWAYS = new Set([
  'greeting', 'smalltalk', 'farewell', 'thanks', 'identity', 'trust',
  'billing.price', 'billing.subscription', 'support.error', 'support.not_working',
  'cost', 'timeline', 'foreigner', 'documents', 'alcohol', 'music', 'nace', 'tax_id', 'support',
]);

// Generic "how do I start / what are the steps" intents. These should normally
// show the library overview — BUT if the user already named a concrete business
// or district (e.g. "I want to open a resturant"), the guided flow is far more
// useful, so we let it run instead.
const SKIP_UNLESS_CONCRETE = new Set(['how_to_start', 'steps', 'how_it_works']);

/** Returns true when query is a short positive wellbeing reply ("am good", "fine",
 *  "iyiyim", "بخير", "الحمد لله"…) across EN/TR/AR. */
function isPositiveWellbeing(text: string): boolean {
  const t = text.trim();
  // English
  if (/^(am |i'?m |doing |i am |not |pretty |very |doing )?(good|great|fine|alright|okay|ok|not bad|well|awesome|perfect|fantastic|nice|cool|doing well|pretty good|doing great|going well|going great|am good|am fine|am great|am alright)\b/.test(t)) return true;
  // Turkish
  if (/^(çok )?(iyiyim|iyi|güzel|harika|gayet iyi|fena değil|süper|mükemmel|teşekkürler iyiyim)\b/i.test(t)) return true;
  // Arabic (text is already alef-normalized by normalizeText)
  if (/(بخير|تمام|كويس|منيح|زين|الحمد لله|الحمدلله|تمام الحمد لله|بخير الحمد لله|جيد|ممتاز|كل شي تمام|كله تمام)/.test(t)) return true;
  return false;
}

export function guidedFlow(
  query: string,
  messages: Array<{ role: string; content: string }>,
  assistantType: string,
  language: string,
  detectedIntent: string | null,
): string | null {

  // ── Chit-chat follow-up: positive reply after bot asked "What about you?" ────
  // Runs before SKIP_ALWAYS so it intercepts before social-intent short-circuits.
  const lastBotMsg = messages.filter(m => m.role === 'assistant').pop()?.content ?? '';
  const botAskedHowAreYou = /what about you|how about you|and you\?|what'?s going on with you|what is going on with you|going on with you\?|how'?s (life|things|it) with you|how are you doing\?|how is it going\?/i.test(lastBotMsg)
    || /ya siz|siz nasıl|sen nasıl|ya sen|peki ya siz/i.test(lastBotMsg)               // Turkish "and you?"
    || /وانت|و انت|وانتا|وانتي|وأنت|و أنت|وانتم|كيف حالك انت/.test(normalizeText(lastBotMsg)); // Arabic "and you?"
  if (botAskedHowAreYou && isPositiveWellbeing(normalizeText(query))) {
    const serviceAsk: Record<string, { en: string; tr: string; ar: string }> = {
      student: {
        en: `🎓 Glad to hear it! 😊 What can I help you with today?`,
        tr: `🎓 Buna sevindim! 😊 Bugün size nasıl yardımcı olabilirim?`,
        ar: `🎓 يسعدني ذلك! 😊 كيف يمكنني مساعدتك اليوم؟`,
      },
      permit: {
        en: `🏪 Great! What service do you need help with today?`,
        tr: `🏪 Harika! Bugün hangi hizmet konusunda yardıma ihtiyacınız var?`,
        ar: `🏪 رائع! ما الخدمة التي تحتاج المساعدة بها اليوم؟`,
      },
      lawyer: {
        en: `⚖️ Awesome! What can I help you with today?`,
        tr: `⚖️ Mükemmel! Bugün size nasıl yardımcı olabilirim?`,
        ar: `⚖️ ممتاز! كيف يمكنني مساعدتك اليوم؟`,
      },
    };
    const entry = serviceAsk[assistantType] ?? serviceAsk.student;
    return pick(entry.en, entry.tr, entry.ar, language);
  }

  // ── Social guard: wide net catches casual messages that the keyword router ────
  // may miss (e.g. "how you doing", "you good?") — returns null so the keyword
  // library's social answer takes over instead of accidentally triggering a service flow.
  const SOCIAL_GUARD = /^(am\s+(great|good|fine|alright|okay|well|awesome|fantastic|not\s+bad|doing\s+(well|great|good|fine))|i'?m\s+(great|good|fine|alright|okay|well|awesome|fantastic|not\s+bad|doing\s+(well|great|good|fine))|doing\s+(well|great|good|fine|okay)|hi|hey|hello|howdy|hiya|sup|yo|good\s+(morning|afternoon|evening|night|day)|how\s+(are\s+)?(you|u|ya|r\s+u)|how\s+(you|u)\s+doing|how\s+r\s+u|you\s+good|u\s+good|you\s+okay|you\s+alright|you\s+well|what'?s\s+up|whats\s+up|how'?s\s+(it|life|everything)|bye|goodbye|see\s+you|see\s+ya|later|take\s+care|cya|thank|thanks|ty|cheers|appreciate|nice|cool|ok|okay|alright|great|awesome|perfect|no\s+problem|np|sure|got\s+it|sounds\s+good|makes\s+sense)\b/i;
  if (SOCIAL_GUARD.test(query.trim())) return null;

  // Always defer pure social / billing / specific-topic intents to their answers
  if (detectedIntent && SKIP_ALWAYS.has(detectedIntent)) return null;

  // ── STUDENT: detect service BEFORE SKIP_UNLESS_CONCRETE ─────────────────────
  // Runs early so queries like "i wanna apply to id" or "how to get ikamet" — which
  // the keyword router may label 'how_to_start' (in SKIP_UNLESS_CONCRETE) — still
  // reach the service lookup instead of falling through to the generic library.
  if (assistantType === 'student') {
    const svc = findStudentService(normalizeText(query));
    if (svc) return `${STUDENT_SERVICE_READY}${svc}`;
  }

  // Extract data from BOTH current query AND history (typo-tolerant)
  const data = extractFlowData(query, messages, assistantType);
  const hasConcreteData = Boolean(data.businessType || data.district || data.universityName);

  // Generic "how to start" intents defer to the library only when the user hasn't
  // named anything concrete yet — otherwise the guided flow takes over.
  // Exception: permit agent queries that look like opening a business always enter
  // the guided flow so we can ask "what type of business?" instead of letting
  // Gemini invent an answer.
  if (detectedIntent && SKIP_UNLESS_CONCRETE.has(detectedIntent) && !hasConcreteData) {
    if (!(assistantType === 'permit' && looksLikeOpeningBusiness(query))) return null;
  }

  // ── PERMIT AGENT ─────────────────────────────────────────────────────────────
  if (assistantType === 'permit') {
    const historyText = messages.map(m => m.content).join(' ');
    const hasBusinessContext =
      data.businessType != null ||
      data.district != null ||
      looksLikeOpeningBusiness(query) ||          // ← checks CURRENT query
      looksLikeOpeningBusiness(historyText);       // ← checks history

    if (hasBusinessContext) {
      return permitFlow(data, language);
    }
  }

  // ── STUDENT AGENT fallback (intent-based flows, e.g. university name prompt) ─
  if (assistantType === 'student') {
    return studentFlow(data, language, detectedIntent, query, messages);
  }

  return null;
}
