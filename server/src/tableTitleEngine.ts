/**
 * TabSpec table-title engine trained on Goldline Consumer + Retailer AP mappings.
 *
 * Pipeline (highest priority first):
 *  1. Ground-truth corpus match (189 question→title pairs from reference APs)
 *  2. Validated uppercase heading aliases (Gender, TOM, Aided awareness, …)
 *  3. Archetype composer (RAKE + templates — portable)
 *  4. Linguistic pattern rules (Goldline-trained regex)
 *  5. Keyword fallback
 */

import corpusData from './data/titleTrainingCorpus.json';
import { composeTableTitle } from './titleComposer';

export type StudyType = 'consumer' | 'retailer';

export interface TableTitleInput {
  id?: string;
  heading?: string;
  text: string;
  study?: StudyType;
}

interface CorpusEntry {
  id: string;
  expected: string;
  heading: string;
  text: string;
  study: StudyType;
}

type PatternRule = {
  re: RegExp;
  title: string | ((m: RegExpMatchArray, text: string, id?: string) => string);
};

const CORPUS: CorpusEntry[] = (corpusData as CorpusEntry[]).map((e) => ({
  ...e,
  study: e.study ?? 'consumer',
}));

const JUNK_HEADING_RE =
  /^(RANDOMIZE|SHOW|DISPLAY|ASK|PIPE|SN:|POST\s*CODE|OPTION|READ\s*OUT|CONTINUE|MULTIPLE|SCREEN|NOTE)/i;

const PIPE_RE = /<[^>]+>/g;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'your', 'you', 'are', 'have',
  'been', 'would', 'could', 'please', 'select', 'tell', 'most', 'when', 'what', 'how',
  'which', 'following', 'such', 'like', 'about', 'into', 'over', 'than', 'them', 'their',
  'any', 'all', 'also', 'did', 'does', 'will', 'can', 'may', 'not', 'our', 'were', 'was',
]);

/** Screening / section headings → title when heading matches question topic */
const HEADING_ALIASES: Record<string, string> = {
  city: 'City',
  gender: 'Gender',
  age: 'Age',
  'cwe education': 'CWE education',
  'mr participation': 'MR participation',
  'occupation check': 'Occupation check',
  tom: 'TOM brands',
  'spontaneous awareness': 'Spont Brands',
};

const HEADING_TEXT_RULES: { heading: RegExp; text: RegExp; title: string }[] = [
  { heading: /aided awareness/i, text: /heard of/i, title: 'Brands heard of' },
  { heading: /aided awareness/i, text: /ever purchased/i, title: 'Brands purchased ever' },
  { heading: /respondent profiling/i, text: /marital status/i, title: 'Marital status' },
  { heading: /respondent profiling/i, text: /family status/i, title: 'Family status' },
  { heading: /respondent profiling/i, text: /how many people/i, title: 'Number of people in household' },
];

const QUESTION_PATTERNS: PatternRule[] = [
  // Instruction-only / derived fields
  { re: /post code below the nccs/i, title: 'NCCS classification' },

  // Recruitment
  { re: /which city are you currently based in|please select your center/i, title: 'City' },
  { re: /please select your gender/i, title: 'Gender' },
  { re: /what is your age in completed years/i, title: 'Age' },
  { re: /employed in any of the following occupations/i, title: 'Occupation check' },
  { re: /market research surveys/i, title: 'MR participation' },
  { re: /highest level of education of the chief wage earner/i, title: 'CWE education' },
  { re: /best describes your current occupation/i, title: 'Current occupation' },
  { re: /best describes your role in this jewellery store/i, title: 'Role in store' },
  { re: /monthly household income/i, title: 'Monthly household income' },
  { re: /which of these items do you have at home/i, title: 'Household items' },
  { re: /agricultural land/i, title: 'Agricultural Land ownership' },
  { re: /role in the decision-making process for purchasing/i, title: 'Role in decision making' },
  { re: /precious metal products have you personally purchased/i, title: 'Precious metal purchased' },
  { re: /weight\/denomination of the gold coin or bar/i, title: 'Gold denomination' },
  { re: /weight\/denomination of the silver coin or bar/i, title: 'Silver denomination' },
  { re: /best describes your store/i, title: 'Store type' },
  { re: /years has your store\/business been operational/i, title: 'Years operational in business' },
  { re: /product categories does your store currently stock/i, title: 'Product categories in store stock' },
  { re: /primary person responsible for making key business decisions/i, title: 'Primary decision maker' },
  { re: /main point of contact when brand representatives visit/i, title: 'Brand representative contact' },

  // Consumer purchase behaviour
  { re: /occasions have you purchased gold\/silver coins or bars/i, title: 'Occasions of purchase' },
  { re: /from where did you purchase your most recent gold\/silver/i, title: 'Purchase channel' },
  { re: /why did you choose this.*purchase channels/i, title: (_m, _t, id) => (id === 'C4' ? 'Reason for online channel' : 'Reason for offline channel') },
  { re: /satisfied were you with your purchase experience|rate your purchase experience/i, title: 'Satisfaction with purchase' },
  { re: /sources influence your gold\/silver purchase decisions/i, title: 'Influence sources' },
  { re: /key buying factors that influence your decision while purchasing/i, title: 'Buying factors' },
  { re: /role of gold\/silver in your life/i, title: 'Role of gold/silver' },
  { re: /purity standards are you aware of gold/i, title: 'Gold purity awareness' },
  { re: /purity standards are you aware of for both silver/i, title: 'Silver purity awareness' },
  { re: /gold carat type do you usually prefer/i, title: 'Preferred gold carat type' },
  { re: /how important is purity while purchasing/i, title: 'Importance of purity' },
  { re: /denomination\/weight of gold do you purchase most often/i, title: 'Gold denomination frequently purchased' },
  { re: /denomination\/weight of silver do you purchase most often/i, title: 'Silver denomination frequently purchased' },
  { re: /spend on a single gold purchase/i, title: 'Gold spend' },
  { re: /spend on a single silver purchase/i, title: 'Silver spend' },
  { re: /certifications or quality marks for gold\/silver/i, title: 'Certifications awareness' },
  { re: /heard of the london bullion market association/i, title: 'Awareness of LBMA' },
  { re: /lbma sets international standards/i, title: 'Influence of LBMA' },
  { re: /ethical sourcing matter to you/i, title: 'Ethical sourcing importance' },
  { re: /how important is aesthetic appeal\/design/i, title: 'Importance of design' },
  { re: /designs or motifs do you prefer/i, title: 'Preferred coin designs' },
  { re: /which design styles do you prefer/i, title: 'Design styles' },
  { re: /occasions would you consider purchasing personalised/i, title: 'Occasions for personalization' },
  { re: /premium over a standard coin would you be willing/i, title: 'Premium willingness to pay' },
  { re: /how important is secure packaging and brand seal/i, title: 'Importance of packaging' },
  { re: /how frequently do you purchase gold\/silver products/i, title: 'Purchase frequency' },
  { re: /why you choose silver over gold/i, title: 'Reason for silver' },
  { re: /silver format do you prefer most/i, title: 'Preferred silver format' },
  { re: /where do you usually store your gold\/silver/i, title: 'Storage place' },

  // Retailer purchase behaviour
  { re: /demand for (gold|silver)[\s\S]*?compared to (\d+)\s*months ago/i, title: (m) => `${capitalize(m[1])} demand now vs ${m[2]} months ago` },
  { re: /(gold|silver) coin\/bar denominations sell the most/i, title: (m) => `${capitalize(m[1])} denominations sold most` },
  { re: /occasions or periods does demand.*peak/i, title: 'Peak occasions for demand' },
  { re: /reasons customers buy (gold|silver)/i, title: (m) => `Reasons customers buy ${m[1].toLowerCase()}` },
  { re: /proportion of customers who buy (gold|silver)/i, title: (m) => `Proportion asking for a specific ${m[1].toLowerCase()} brand` },
  { re: /factors influence customer choice while purchasing (gold|silver)/i, title: (m) => `${capitalize(m[1])} purchase drivers` },
  { re: /how influential is retailer recommendation/i, title: 'Retailer influence in customer purchase decisions' },
  { re: /satisfied are you with the margins offered by (.+?) on/i, title: (m) => `${trimBrand(m[1])} margin satisfaction` },
  { re: /place stock orders for (.+?) products/i, title: (m) => `Ordering method for ${trimBrand(m[1])} products` },
  { re: /support do you currently receive from (.+?)\??$/i, title: (m) => `Support received from ${trimBrand(m[1])}` },
  { re: /support would you expect from (.+?) to help increase sales/i, title: (m) => `Support expected from ${trimBrand(m[1])} to increase sale` },

  // Digital gold (consumer)
  { re: /aware that you can buy gold digitally/i, title: 'Awareness of digital gold' },
  { re: /consider purchasing digital gold in near future/i, title: 'Consideration for digital gold' },
  { re: /reasons you considered or would consider while purchasing digital gold/i, title: 'Reasons for digital gold' },
  { re: /platforms have you used for purchasing digital gold/i, title: 'Platforms used' },
  { re: /platforms have you considered or would consider while purchasing digital gold/i, title: 'Platforms considered' },
  { re: /how familiar are you with how digital gold works/i, title: 'Familiarity with digital gold' },
  { re: /statements best describe your opinion about digital gold/i, title: 'Opinions on digital gold' },
  { re: /more likely to choose digital gold instead of physical gold/i, title: 'Triggers for digital gold over physical gold' },
  { re: /digital gold purchase, why did you choose digital gold/i, title: 'Reasons for choosing digital gold' },
  { re: /most recent digital gold purchase, why did you choose/i, title: 'Reasons for choosing digital gold' },

  // Government / policy (consumer)
  { re: /government announcement, advisory or news related to gold/i, title: 'Govt announcement awareness' },
  { re: /government announcement or policy update related to gold influence your purchase/i, title: 'Influence of govt announcement on purchase' },
  { re: /opinion about government advisories related to gold/i, title: 'Opinion on govt advisories' },
  { re: /alternative investment options have you considered/i, title: 'Alternate investment options' },
  { re: /influenced your decision to purchase gold in the last 12 months/i, title: 'Deciding factors' },
  { re: /geopolitical event or government policy change related to gold/i, title: 'Reaction to govt policy change/geopolitical event' },

  // Brand — consumer
  { re: /brands come to your mind when you think of gold\/silver/i, title: 'TOM brands' },
  { re: /other brands come to your mind when you think of gold\/silver/i, title: 'Spont Brands' },
  { re: /brands of gold\/silver coins or bars have you ever heard of/i, title: 'Brands heard of' },
  { re: /brands have you ever purchased/i, title: 'Brands purchased ever' },
  { re: /brands do you use\/purchase most often/i, title: 'Brands used/purchased most often' },
  { re: /would you consider buying gold\/silver coins or bars from/i, title: 'Brands considered buying' },
  { re: /purchased gold or silver coins\/bars from in the last 12 months/i, title: 'Brands purchased in the last 12 months' },
  { re: /brand do you most prefer for purchasing gold\/silver/i, title: 'Brands most preferred for purchasing' },
  { re: /likely are you to recommend your recently purchased brand/i, title: 'Likeliness of recommending recent purchase' },
  { re: /main reasons you would consider the following brands/i, title: 'Main reasons for considering following brands' },
  { re: /reason for purchasing the specific brand that you most recently bought/i, title: 'Reason for purchasing the specific brand' },
  { re: /why have you not considered purchasing from/i, title: 'Why not MMTC PAMP' },
  { re: /considered.*during your purchase journey but did not finally purchase/i, title: 'Why not final purchase from MMTC PAMP even though considered' },
  { re: /aware of mmtc-pamp but have never purchased/i, title: 'Aware but not purchased MMTC PAMP' },
  { re: /influenced your brand choice/i, title: 'Influence of brand choice' },
  { re: /what the brand represents to you/i, title: 'What does MMTC PAMP represent' },
  { re: /quality of pamp gold products compare to other brands/i, title: 'Quality of PAMP products compared to others' },
  { re: /mmtc-pamp combination as a single brand represent/i, title: 'MMTC PAMP single brand combination' },
  { re: /statements do you associate with each brand of gold\/silver/i, title: 'Statements associated with' },

  // Brand — retailer
  { re: /brands do your customers most commonly ask for by name/i, title: 'Brands asked by customers' },
  { re: /brands sell the fastest in your store/i, title: 'Fastest Selling brands' },
  { re: /brands do you personally prefer recommending to customers/i, title: 'Brands recommended to customers' },
  { re: /sell faster than others/i, title: 'Why brands sell faster' },
  { re: /main reason why people ask for these/i, title: 'Reason for brand preference' },
  { re: /customers bring their existing gold or silver items/i, title: 'Exchange frequency' },
  { re: /existing gold\/silver items do customers most commonly bring/i, title: 'Items for exchange' },
  { re: /customers come to buy bullion, what do they usually ask for first/i, title: 'First ask in bullion purchase' },
  { re: /statements do you associate with each brand of gold\/silver coins or bars/i, title: 'Brand association statements' },

  // MMTC-PAMP — retailer
  { re: /aware are your customers of the range of products offered by/i, title: 'Awareness of MMTC-PAMP range' },
  { re: /internationally recognised precious metals brand reputation/i, title: 'Importance of brand reputation' },
  { re: /customers ask for mmtc, do they usually mean/i, title: 'MMTC vs MMTC-PAMP understanding' },
  { re: /why do customers prefer purchasing mmtc-pamp products/i, title: 'Reasons for MMTC-PAMP preference' },
  { re: /why might customers hesitate to purchase mmtc-pamp/i, title: 'Reasons for hesitation' },
  { re: /customers switch from mmtc-pamp to another brand/i, title: 'Reasons to switch brand' },
  { re: /aware are customers of lbma certification/i, title: 'LBMA awareness among customers' },
  { re: /customers ask about any of the following when buying bullion/i, title: 'Certification queries' },
  { re: /genuinely aware of certification, or do they mainly rely on retailer trust/i, title: 'Certification awareness vs trust' },
  { re: /explain to customers the difference between 999\.9, 995, and 999/i, title: 'Explain purity levels' },
  { re: /purity levels do customers most commonly buy for gold/i, title: 'Gold purity preference' },
  { re: /purity levels do customers most commonly buy for silver/i, title: 'Silver purity preference' },
  { re: /how important is buyback in the customer/i, title: 'Buyback importance' },
  { re: /easy or difficult is it to resell mmtc-pamp/i, title: 'Ease of resale of MMTC-PAMP products' },
  { re: /do you also have an online offering/i, title: 'Online offering' },
  { re: /younger consumers are becoming more interested in branded gold\/silver/i, title: 'Youth interest in branded products' },
  { re: /drive future growth in branded gold\/silver/i, title: 'Future growth drivers' },
  { re: /influencers or digital content creators influence customers gold\/silver purchase/i, title: 'Influencer impact on purchase decisions' },
  { re: /types of celebrities or influencers are most influential in shaping customers perception/i, title: 'Influencer types most influential in shaping perception' },
  { re: /ways do celebrities or influencers impact your perception of gold\/silver/i, title: 'Influencer impact types' },
  { re: /challenges do you face while selling gold\/silver coins or bars/i, title: 'Selling challenges' },
  { re: /consumers request customisation/i, title: 'Customization demand' },
  { re: /occasions do consumers most commonly request customised gold\/silver/i, title: 'Customization occasions' },
  { re: /consumers are shifting to digital gold/i, title: 'digital gold shift reasons' },
  { re: /top players in digital gold or online bullion/i, title: 'Top players in digital gold' },

  // Buyback block
  { re: /guaranteed buyback promise from the brand/i, title: 'Importance of guaranteed buyback promise' },
  { re: /sell back or exchange gold\/silver coins or bars/i, title: 'Tried to sell back/exchange gold/silver coins' },
  { re: /which channel did you sell to/i, title: 'Channel used to sell' },
  { re: /challenges did you face during the buyback/i, title: 'Challenges faced during buyback' },

  // Media habits
  { re: /activities do you do regularly/i, title: 'Regular activities' },
  { re: /how often do you interact with different media/i, title: 'Frequency of interaction with different media' },
  { re: /devices frequently used for\s+social media usage/i, title: 'Devices frequently used for social media usage' },
  { re: /types of application you have in your smartphone/i, title: 'Types of applications in smartphone' },
  { re: /ott platform you watch regularly/i, title: 'OTT platforms seen regularly' },
  { re: /platform subscriptions do you currently have/i, title: 'Current subscriptions' },
  { re: /kind of content do you watch on the ott platforms/i, title: 'Kind of content seen on OTT platforms' },
  { re: /social networking platforms are you active on/i, title: 'Social networking platforms' },
  { re: /type of content do you enjoy the most/i, title: 'Content enjoyed most' },
  { re: /platforms and activities do you indulge in on online\/digital media/i, title: 'Activities done on digital media' },
  { re: /influencers\/content creators do you regularly follow/i, title: 'Influencers regularly followed' },

  // Demographics tail
  { re: /living in the same locality in your city/i, title: 'Years in the locality' },
  { re: /type of house you live in/i, title: 'Type of house' },
  { re: /size of your house/i, title: 'Size of house' },

  // Generic archetypes (lowest pattern priority)
  { re: /how important is (.+?)(?:\?|$| while)/i, title: (m) => `Importance of ${cleanPhrase(m[1])}` },
  { re: /how aware are (?:your )?customers of (.+?)(?:\?|$)/i, title: (m) => `Awareness of ${cleanPhrase(m[1])}` },
  { re: /how satisfied are you with (.+?)(?:\?|$)/i, title: (m) => `Satisfaction with ${cleanPhrase(m[1])}` },
  { re: /what are the (?:main )?reasons (.+?)(?:\?|$)/i, title: (m) => `Reasons for ${cleanPhrase(m[1])}` },
  { re: /which of the following best describes (?:your )?(.+?)\??$/i, title: (m) => toTitlePhrase(cleanPhrase(m[1])) },
];

// Pre-index corpus for fast lookup
const corpusByIdNorm = new Map<string, string>();
const corpusTokenized = CORPUS.map((entry) => ({
  id: entry.id,
  study: entry.study,
  expected: entry.expected,
  tokens: tokenize(entry.text),
  norm: normalizeForMatch(entry.text),
}));

for (const entry of CORPUS) {
  corpusByIdNorm.set(`${entry.study}|${entry.id}|${normalizeForMatch(entry.text)}`, entry.expected);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function trimBrand(s: string): string {
  return s.replace(/[?.]+$/, '').trim();
}

function cleanPhrase(s: string): string {
  return s.replace(PIPE_RE, '').replace(/\s+/g, ' ').replace(/[?.:;,\s]+$/, '').trim();
}

function toTitlePhrase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      if (/^[A-Z]{2,}(-[A-Z]+)?$/.test(w) || /^[A-Z][a-z]+-[A-Z]+/.test(w)) return w;
      return i === 0 ? capitalize(w) : w.toLowerCase();
    })
    .join(' ');
}

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(PIPE_RE, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(single|multiple|record|ranking|grid)\s+coding\b/gi, ' ')
    .replace(/please select and rank[^.]*$/i, ' ')
    .replace(/[^a-z0-9\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): Set<string> {
  return new Set(
    normalizeForMatch(text)
      .split(' ')
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

function findCorpusMatch(id: string | undefined, text: string, study?: StudyType): string | null {
  const norm = normalizeForMatch(text);
  if (!norm) return null;

  const studies: (StudyType | undefined)[] = study ? [study, undefined] : [undefined];

  for (const s of studies) {
    if (id && s) {
      const exact = corpusByIdNorm.get(`${s}|${id}|${norm}`);
      if (exact) return exact;
    }
  }

  const queryTokens = tokenize(text);
  let best = { score: 0, title: '', idMatch: false, studyMatch: false };

  for (const entry of corpusTokenized) {
    if (study && entry.study !== study) continue;

    const score = jaccard(queryTokens, entry.tokens);
    const idMatch = !!id && entry.id === id;
    const boosted = idMatch ? Math.min(1, score + 0.08) : score;
    if (
      boosted > best.score ||
      (boosted === best.score && idMatch && !best.idMatch)
    ) {
      best = { score: boosted, title: entry.expected, idMatch, studyMatch: true };
    }
  }

  if (best.score >= 0.95) return best.title;
  if (best.score >= 0.88 && id && study) return best.title;
  if (best.score >= 0.78 && best.idMatch && study) return best.title;

  if (study) {
    return findCorpusMatch(id, text, undefined);
  }

  // Unknown study: only accept near-exact text reuse (avoid wrong cross-study titles)
  if (!study && best.score >= 0.98) return best.title;

  return null;
}

function headingMatchesQuestion(heading: string, questionText: string): boolean {
  const h = heading.toLowerCase();
  const q = questionText.toLowerCase();
  if (h.includes('education') && !q.includes('education')) return false;
  if (h.includes('gender') && !q.includes('gender')) return false;
  if (h.includes('age') && !q.includes('age')) return false;
  if (h.includes('city') && !q.includes('city') && !q.includes('center')) return false;
  return true;
}

function titleFromHeading(heading: string, text: string): string | null {
  const h = heading.trim();
  if (!h || JUNK_HEADING_RE.test(h)) return null;

  for (const rule of HEADING_TEXT_RULES) {
    if (rule.heading.test(h) && rule.text.test(text)) return rule.title;
  }

  const alias = HEADING_ALIASES[h.toLowerCase()];
  if (alias && headingMatchesQuestion(h, text)) return alias;

  if (h === h.toUpperCase() && h.split(/\s+/).length <= 5 && headingMatchesQuestion(h, text)) {
    return toTitlePhrase(h.toLowerCase());
  }

  return null;
}

function titleFromPatterns(text: string, id?: string): string | null {
  const normalized = text.replace(PIPE_RE, ' ').replace(/\s+/g, ' ').trim();
  for (const rule of QUESTION_PATTERNS) {
    const m = normalized.match(rule.re);
    if (m) {
      const title = typeof rule.title === 'function' ? rule.title(m, normalized, id) : rule.title;
      if (title) return title;
    }
  }
  return null;
}

function keywordFallback(text: string): string {
  let t = text.replace(PIPE_RE, ' ').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const words = t.split(' ').filter(Boolean);
  return toTitlePhrase(words.slice(0, 15).join(' '));
}

/** Infer consumer vs retailer study from uploaded filename. */
export function inferStudyType(filename: string): StudyType {
  return filename.toLowerCase().includes('retailer') ? 'retailer' : 'consumer';
}

/**
 * Generate a TabSpec table title from question metadata.
 */
export function generateTableTitle(input: TableTitleInput): string {
  const { id, heading = '', text, study } = input;
  const qText = (text || '').trim();

  if (!qText && heading) {
    const fromHeading = titleFromHeading(heading, qText);
    return fromHeading ?? toTitlePhrase(heading.toLowerCase());
  }

  const fromCorpus = findCorpusMatch(id, qText, study);
  if (fromCorpus) return fromCorpus;

  if (heading) {
    const fromHeading = titleFromHeading(heading, qText);
    if (fromHeading) return fromHeading;
  }

  const fromComposer = composeTableTitle(qText);
  if (fromComposer) return fromComposer;

  const fromPattern = titleFromPatterns(qText, id);
  if (fromPattern) return fromPattern;

  return keywordFallback(qText || heading);
}

/** @deprecated Use generateTableTitle */
export function cleanTableTitle(text: string): string {
  return generateTableTitle({ text });
}
