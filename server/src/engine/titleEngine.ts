/* Study-agnostic table-title engine.
 * Rule-based, no models. compromise is used only for the noun-phrase fallback.
 * Titles are capped at 6 words. */
import nlp from 'compromise';

// ---------- shared helpers ----------
const ACRONYMS = new Set(['pc', 'ott', 'ai', 'tom', 'cwe', 'nccs', 'amc', 'ro', 'uc', 'os', 'ui', 'suv', 'ac', 'mr']);
const STOP = new Set(['the','a','an','of','to','in','on','for','and','or','your','you','their','our','my','this','that','these','those','is','are','do','does','did','have','has','had','with','about','following','please','kindly','tell','me','us','select','choose','which','what','how','when','where','why','all','any','can','could','would','will','currently','usually','typically','also','from','at','it','be','as','so','if','not','but','they','we','us','i','there','here']);

// Universal market-research screener/demographic aliases (present in ~every study).
// Keyed on content regex -> canonical short title. Portable, not brand-specific.
// Plain-language, jargon-free canonical titles for universal MR screener/demographic items.
/** [topic pattern, optional guard pattern that must also match, canonical title] */
type AliasRule = [RegExp, RegExp | null, string];

const UNIVERSAL_ALIASES: AliasRule[] = [
  [/chief wage earner|\bcwe\b/i, /educat|qualif|studied/i, 'CWE education'],
  [/chief wage earner|\bcwe\b/i, /occupation|work|profession/i, 'CWE occupation'],
  [/(code|select|record)\s+(the\s+|your\s+)?(center|centre)\b/i, null, 'City'],
  [/age in completed years|your age/i, null, 'Age'],
  [/record gender|your gender|capture gender/i, null, 'Gender'],
  [/marital status/i, null, 'Marital status'],
  [/monthly (household )?income|income groups/i, null, 'Monthly household income'],
  [/which of these items|items (do )?you (have|own)/i, null, 'Household items owned'],
  [/which of the following products do you use for cleaning/i, null, 'Products used for cleaning'],
  [/agricultural land/i, null, 'Agricultural land ownership'],
  [/post code below the nccs|record nccs/i, null, 'NCCS classification'],
  [/family status/i, null, 'Family status'],
  [/how many people (there )?in the household/i, null, 'Household size'],
  [/living in the same locality/i, null, 'Years in locality'],
  [/market research (survey|agenc)/i, null, 'MR participation'],
  [/type of house do you|which type of house/i, null, 'Type of house'],
  [/current (education|occupation)/i, /best describes/i, 'Current education or occupation'],
  // recruitment screeners (universal MR)
  [/(you or any|anyone|relatives?).*(work|employed).*(occupation|profession|compan)/i, null, 'Occupation check'],
  [/biggest contribution.*household|running of the household/i, /studied|educat|level/i, 'CWE education'],
  [/statement describes your current occupational status|current occupational status/i, null, 'Occupational status'],
  [/involvement in the purchase|involved.* in the purchase/i, null, 'Purchase involvement'],
  [/who all do the house cleaning|who.*does? the (house )?cleaning/i, null, 'Who does house cleaning'],
];
function universalAlias(text: string): string | null {
  for (const [topic, guard, title] of UNIVERSAL_ALIASES) {
    if (topic.test(text) && (!guard || guard.test(text))) return title;
  }
  return null;
}

const TRAIL_JUNK = /\b(such|possible|etc|below|above|list|given|apply|applies|now|regularly|individually|combined|response|responses|item|items|option|options|following|here|same|top|order|preference|screen|card)\b/gi;

function stripNoise(raw: string): string {
  let t = ' ' + raw + ' ';
  t = t.replace(/<[^>]*>/g, ' ');                       // pipe placeholders <...>
  t = t.replace(/[<>]/g, ' ');                          // stray pipe brackets
  t = t.replace(/\[[^\]]*\]/g, ' ');                    // [SC] [MC] [RANK TOP 5]
  t = t.replace(/\([^)]*\)/g, ' ');                     // parentheticals (coding / notes)
  // instruction tokens anywhere
  t = t.replace(/\b(single|multiple|multi|record|open[\s-]?end(ed)?|ranking|rank|grid|randomize[d]?|numeric|verbatim)\b[\w\s,\/-]*?coding\b/gi, ' ');
  t = t.replace(/\b(single|multiple|multi)\s+coding\b/gi, ' ');
  t = t.replace(/\b(open[\s-]?end(ed)?|record verbatim|to be filled in grid|show screen|show card|read out|readout|interviewer|post code|terminate\b[\w\s]*)/gi, ' ');
  t = t.replace(/\bsn\s*:[\s\S]*$/i, ' ');              // "SN: ..." trailing DP notes
  t = t.replace(/\bask (all|those|if|for|only|past)\b[^.?]*/gi, ' '); // embedded routing in text
  t = t.replace(/-slide\s*\d+/gi, ' ');
  t = t.replace(/\bplease (select|type|answer|share|indicate|move the slider)[\w\s]*$/i, ' ');
  // scale wrapper: drop only the scale definition, keep the actual question ("...how much did you like X")
  t = t.replace(/\bon a scale of\s+\d+\s*(?:to|[-–])\s*\d+\b/gi, ' ');
  t = t.replace(/,?\s*where\s+\d+\s*(?:means?|=|is|indicates?)[\s\S]*$/i, ' '); // "where 1 means ..."
  t = t.replace(/\bdo not ask\b/gi, ' ');
  t = t.replace(/…+|\.\.\.+/g, ' ');                    // ellipsis
  t = t.replace(/_+/g, ' ');                            // blank-fill underscores "____"
  t = t.replace(/^[\s,\-–—]+/, '');                     // leading commas/dashes
  t = t.replace(/\bpick your top\s*\d+\b/gi, ' ');
  t = t.replace(/\bselect (all that apply|up to \d+|your top \d+)\b/gi, ' ');
  t = t.replace(/\btop\s*\d+\b/gi, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  // keep only first sentence / question
  const m = t.split(/[?.]\s/);
  if (m.length > 1 && m[0].split(' ').length >= 3) t = m[0];
  return t.replace(/[?.]+$/, '').trim();
}

// leading conversational openers to peel off
const OPENERS: RegExp[] = [
  // peel "you mentioned ... " only up to the next question word (not greedily to end)
  /^you mentioned\b[\s\S]*?(?=\b(please|what|which|how|why|where|when|give)\b)/i,
  /^(you mentioned[^,.]*[,.]\s*)/i,
  /^(we'?d? (would )?like to (understand|know)[^,.]*[,.]?\s*)/i,
  /^(we usually try[^.]*\.\s*for this[,]?\s*)/i,
  /^(could you (please )?tell me (about|which|what|how|the)?\s*)/i,
  /^(can you (please )?(also )?tell (me|us)( which| what| what brands)?\s*)/i,
  /^(please (look at this (list|card|screen)|tell me|let me know( about)?|choose an option[^.]*)\s*(and tell me)?\s*)/i,
  /^(kindly tell me,?\s*(are you|which|what|how)?\s*)/i,
  /^(look at this card and tell me\s*)/i,
  /^(now i am going to read[^,]*,?\s*)/i,
  /^(interviewer\b[\s:]*)/i,
  /^((please )?(code|select|record)( the)? (center|centre)\b\s*)/i,
  /^(from (the )?list below,?\s*)/i,
  /^((please )?let (me|us) know( about| the)?\s*)/i,
  /^(from the (options|choices) (below|given)[,]?\s*)/i,
  /^(roughly|approximately|on an average,?)\s*/i,
  /^(in your opinion,?\s*)/i,
  /^(thinking about[^,]*,?\s*)/i,
];
function peelOpeners(t: string): string {
  let prev: string;
  do { prev = t; for (const re of OPENERS) t = t.replace(re, '').trim(); } while (t !== prev);
  return t;
}

function words(s: string): string[] { return s.split(/[\s\/]+/).filter(Boolean); }

function titleCase(s: string): string {
  return words(s).map(w => {
    const low = w.toLowerCase().replace(/[^a-z0-9&\/-]/gi,'');
    if (ACRONYMS.has(low)) return low.toUpperCase();
    if (/^[A-Z]{2,}$/.test(w)) return w;                 // keep existing acronym
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

// cut trailing subordinate clauses that add no title value
const CLAUSE_CUT = /\b(like|when|into|for this|as part of|so that|such as|including|in order to|that you|which is|to indicate|to buy|for the same)\b.*$/i;

// keep meaningful head of an object phrase, drop stopwords, cap words
function compressPhrase(phrase: string, cap = 6): string {
  let p = phrase.replace(CLAUSE_CUT, ' ').replace(/[—–-]+\s*$/,' ').replace(/^[—–\-\s]+/,'').replace(/[?.,;:]+$/,'').trim();
  p = p.replace(/\b(a|an|the)\b/gi, ' ').replace(/\s+/g, ' ').trim();   // drop articles anywhere
  let ws = words(p);
  // drop leading + trailing stopwords/pronouns
  while (ws.length && STOP.has(ws[0].toLowerCase())) ws.shift();
  while (ws.length && STOP.has(ws[ws.length-1].toLowerCase())) ws.pop();
  if (ws.length > cap) ws = ws.filter(w => !STOP.has(w.toLowerCase()));
  if (ws.length > cap) ws = ws.slice(0, cap);
  return ws.join(' ');
}

function finalize(s: string, cap = 6): string {
  let t = ' ' + s + ' ';
  t = t.replace(TRAIL_JUNK, ' ').replace(/\s+/g,' ').trim();
  t = compressPhrase(t, cap);
  if (!t) return '';
  return titleCase(t);
}

// ---------- generic frames ----------
/** [pattern on cleaned text, builder that turns the match into a title] */
type FrameRule = [RegExp, (m: RegExpMatchArray) => string];

// Each frame: regex on cleaned lowercase text -> builds title from captured object.
const FRAMES: FrameRule[] = [
  // importance / satisfaction / awareness / familiarity / likelihood
  [/how important (?:is|are)\s+(.+)/i, (m)=>`Importance of ${obj(m[1],'while purchasing|when|to you')}`],
  [/how satisfied are you with\s+(.+)/i, (m)=>`Satisfaction with ${obj(m[1],null,3)}`],
  [/how (?:aware|familiar) are you (?:of|with|about)\s+(.+)/i, (m)=>`Awareness of ${obj(m[1],null,3)}`],
  [/how (?:relevant|close|visible) (?:do you|are)\s+.*?\b(?:is|to|feel)\b\s*(.+)?/i, (m)=>`Perception of ${obj(m[1]||'brand',null,3)}`],
  [/how likely are you to\s+(.+)/i, (m)=>`Likelihood to ${finalize(peelOpeners(m[1]),3)}`],
  [/how (?:much|many)\s+(.+?)\s+do you (?:have|own|use)\b.*/i, (m)=>`Number of ${obj(m[1],null,3)}`],
  [/how many\s+(.+)/i, (m)=>`Number of ${obj(m[1],null,3)}`],
  [/how much (?:did|do) (?:it cost|you (?:pay|spend))\b(.*)/i, ()=>`Amount spent`],
  [/how much did you like\s+(.+)/i, (m)=>`Liking of ${obj(m[1],null,3)}`],
  [/how (?:often|frequently) (?:do|does) (?:you|each)\s+(.+)/i, (m)=>`Frequency of ${finalize(peelOpeners(m[1]),3)}`],
  [/how involved (?:would|are) you\b.*?\b(?:in|for)\s+(.+)/i, (m)=>`Involvement in ${obj(m[1])}`],

  // reasons / why
  [/(?:please )?give (?:me )?(?:the )?reasons? for the same|reasons? for the same/i, ()=>`Reasons for choice`],
  [/(?:please )?give (?:me )?(?:the )?(?:top \d+ )?reasons?\s+(?:for |behind )?(.+)/i, (m)=>`Reasons for ${reasonObj(m[1])}`],
  [/(?:what are|what were|tell me)?\s*the?\s*(?:main |key |top \d+ )?reasons?\s+(?:for |behind |that )?(.+)/i, (m)=>`Reasons for ${reasonObj(m[1])}`],
  [/(?:what|which).*?\breasons?\b\s+(?:that |for |why )?(.+)/i, (m)=>`Reasons for ${reasonObj(m[1])}`],
  [/why (?:do|did|would|have|are|is)\s+(?:you|people|customers)?\s*(.+)/i, (m)=>`Reasons for ${verbObj(m[1])}`],
  [/what (?:would|could|might|will|do|did)?\s*(?:trigger|triggered|makes?|made|motivate[sd]?|prompt(?:ed)?|encourage[sd]?|drive[sd]?|driven|push(?:ed)?)\s+(?:you )?(?:to )?(.+)/i,
    (m)=>`Trigger for ${finalize(peelOpeners(m[1]),4)}`],
  // "what could BRAND have done differently ..." -> improvement areas
  [/what (?:could|can|should|would)\s+(.+?)\s+have done differently\b.*/i, (m)=>`How ${obj(m[1],null,3)} could improve`],
  // deal-breakers
  [/(?:were|was) there any\b.*?\bdeal[\s-]?breakers?\b(.*)/i, ()=>`Deal-breakers`],
  [/\bdeal[\s-]?breakers?\b/i, ()=>`Deal-breakers`],

  // best describes -> object is the topic itself
  [/(?:which|what) of the following best describes\s+(?:your |how you )?(.+)/i, (m)=>obj(m[1])],
  [/(?:which|what) of the following applies to\s+(.+)/i, (m)=>obj(m[1])],

  // preference / usage / ownership
  [/(?:which|what)\s+(.+?)\s+do you (?:currently )?(?:prefer|trust|like)\b.*/i, (m)=>`Preferred ${obj(m[1])}`],
  [/(?:which|what)\s+(.+?)\s+(?:do|did) you (?:\w+\s){0,2}(use|own|buy|purchase|watch|have|follow)\b.*/i,
    (m)=>usageTitle(m[1], m[2])],
  [/(?:which|what).*\b(?:planning|wish|intend|want)\s+to buy\b.*/i, ()=>'Purchase intention'],
  [/willing to participate|are you willing/i, ()=>'Willingness to participate'],
  [/do you (?:personally )?(?:own|have|use)\s+(?:a |an )?(.+)/i, (m)=>`${obj(m[1],null,3)} ownership`],
  // information sources / decision inputs
  [/which\s+(?:all\s+)?sources.*(information|awareness|decide|research)/i, ()=>'Information sources'],
  [/which of the following applies to (?:you|your family)/i, (m)=>'Applicable statements'],
  [/(?:which|what)\s+(.+?)\s+(?:would you|do you) consider\b.*/i, (m)=>`${obj(m[1])} considered`],

  // where / when
  [/(?:from )?where (?:do|did) you\s+(.+)/i, (m)=>`${verbObjNoun(m[1])} location`],
  [/when (?:did|do) you\s+(.+)/i, (m)=>`${verbObjNoun(m[1])} timing`],

  // what X / which X  (generic object questions)
  [/(?:what|which)\s+(?:is|are|was|were)\s+(?:your |the )?(.+)/i, (m)=>obj(m[1])],
  [/(?:what|which)\s+(.+?)\s+(?:do|did|are|would) you\b(.*)/i, (m)=>obj(m[1])],
  [/(?:on )?what\s+(.+?)\s+do you\b.*/i, (m)=>obj(m[1])],
];

// object cleaners --------------------------------------------------
function obj(s: string | undefined, tailPatt?: string | null, cap = 6): string {
  if (!s) return '';
  let t = s;
  if (tailPatt) t = t.replace(new RegExp('\\b(' + tailPatt + ')\\b.*$','i'), '');
  t = t.replace(/\b(do you|are you|to you|for you|you|while purchasing|when you|that you|in this)\b.*$/i,'');
  return finalize(peelOpeners(t), cap);
}
function reasonObj(s: string): string {
  let t = s.replace(/^(for|behind|that|why|to)\s+/i,'');
  t = t.replace(/\b(you|your|customers|people)\b/gi,' ');
  t = t.replace(/\b(most recently|most recent|recently)\s+(purchased|bought)?\b/gi,' '); // drop recency filler
  t = t.replace(/\bmay\b/gi,' ');
  return finalize(t, 3);
}
function verbObj(s: string): string { return finalize(peelOpeners(s), 5); }
function verbObjNoun(s: string): string {
  // "purchase your most frequently used smartphone" -> "smartphone purchase"
  const doc = nlp(peelOpeners(s));
  const verb = doc.verbs().toInfinitive().out('array')[0];
  const noun = doc.nouns().out('array').slice(-1)[0];
  if (verb && noun) return finalize(`${noun} ${verb}`, 4);
  return finalize(s, 4);
}
function usageTitle(objPhrase: string, verb: string): string {
  const o = obj(objPhrase);
  const map: Record<string, string> = { use:'used', own:'owned', buy:'bought', purchase:'purchased', watch:'watched', have:'used', follow:'followed' };
  return finalize(`${o} ${map[verb.toLowerCase()]||verb}`, 5);
}

// Brand-funnel family: questions about brands collapse to the category noun
// ("drain cleaners") unless we keep the ACTION. Fires only for brand questions.
const BRAND_FRAMES: [RegExp, string][] = [
  [/\bany other brand|other brands?\b.*\b(mind|think|recall|consider)\b/i, 'Other brands recalled'],
  [/\b(come to mind|top of mind|think of|recall)\b/i, 'Top of mind brands'],
  [/\b(heard of|aware of|awareness)\b/i, 'Brands heard of'],
  [/\bever (been )?(used|using)\b/i, 'Brands ever used'],
  [/\bever (purchased|bought)\b/i, 'Brands ever purchased'],
  [/\b(currently|current)\b.*\b(used|using|use)\b/i, 'Current brand used'],
  [/\bmost often used|most (frequently )?used|used most\b/i, 'Most used brand'],
  [/\bpreviously used\b/i, 'Previously used brand'],
  [/\bconsider(ed|ing)?\b/i, 'Brands considered'],
  [/\brecommend/i, 'Brands recommended'],
  [/\bprefer/i, 'Preferred brand'],
  [/\bswitch/i, 'Brand switching'],
  [/\bpurchased?\b|\bbought\b|\bbuy\b/i, 'Brands purchased'],
];
function brandTitle(t: string): string | null {
  if (!/\bbrands?\b/i.test(t)) return null;      // only for brand questions
  for (const [re, title] of BRAND_FRAMES) if (re.test(t)) return title;
  return null;
}

function frameTitle(t: string): string | null {
  for (const [re, fn] of FRAMES) {
    const m = t.match(re);
    if (m) { const out = fn(m); if (out && out.trim()) return out.trim(); }
  }
  return null;
}

// Leading interrogative + auxiliary/instruction stem. Peeled so a fallback title starts
// at the semantic core ("What could Motorola have done..." -> "Motorola have done...")
// instead of on question words. Repeated until no leading function-word remains.
const STEM = new Set(['what','which','how','why','where','when','who','whom','whose',
  'do','did','does','are','is','was','were','would','could','should','shall','will','can','may','might',
  'have','has','had','to','you','we','they','i','he','she','it','your','our','their','the','a','an',
  'of','for','about','please','kindly','so','and','then','also','us','me','tell','let','know','from','list','below']);
function peelStem(s: string): string {
  let ws = s.split(/\s+/).filter(Boolean);
  while (ws.length > 3 && STEM.has(ws[0].toLowerCase().replace(/[^a-z]/g,''))) ws.shift();
  return ws.join(' ');
}

// Fuller fallback: a clean, readable, COMPLETE phrase from the question (not a 1-word noun
// dump, and never a mid-sentence truncation). Caps at 10 words; trims dangling stopwords so
// the title never ends on "to", "of", "your", etc.
function fullPhrase(t: string): string {
  let s = peelStem(peelOpeners(t)).replace(/\b(a|an|the)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  let ws = s.split(' ').filter(Boolean);
  if (ws.length > 10) ws = ws.slice(0, 10);
  while (ws.length > 2 && STOP.has(ws[ws.length - 1].toLowerCase())) ws.pop();  // no trailing preposition/pronoun
  while (ws.length > 2 && STOP.has(ws[0].toLowerCase())) ws.shift();
  return titleCase(ws.join(' '));
}

// noun-phrase fallback (kept for the frame objects); fuller phrase when it would be too terse.
function nounFallback(t: string): string {
  const doc = nlp(peelOpeners(t));
  let np: string[] = doc.match('#Adjective? #Noun+').out('array');
  if (!np.length) np = doc.nouns().out('array');
  // longest noun phrase is the most specific one
  const phrase = np.sort((a, b) => b.length - a.length)[0] || t;
  const short = finalize(phrase, 6);
  // if the noun phrase collapses to 1-2 words, prefer the fuller readable phrase
  return short.split(' ').filter(Boolean).length >= 3 ? short : fullPhrase(t);
}

export function makeTitle(rawText: string, heading?: string): string {
  const alias = universalAlias(rawText || '');
  if (alias) return alias;
  const cleaned = peelOpeners(stripNoise(rawText || ''));
  if (!cleaned && heading) return finalize(heading, 6);
  const brand = brandTitle(cleaned);
  if (brand) return brand;
  // Trust an explicit frame match — it is a deliberate, well-formed title (may legitimately
  // be a single token like "Deal-breakers" / "Purchase intention").
  const framed = frameTitle(cleaned);
  if (framed) return framed;
  let title = nounFallback(cleaned);
  // never emit a coding label
  if (/^(open end|single coding|multiple coding|record|grid)$/i.test(title) && heading) title = finalize(heading,6);
  // clear-and-concise: a bare 1-word noun dump is too terse -> use a fuller readable phrase.
  if (title.split(/\s+/).filter(Boolean).length < 2) {
    const fuller = fullPhrase(cleaned);
    if (fuller.split(/\s+/).filter(Boolean).length >= 2) title = fuller;
  }
  return title;
}

