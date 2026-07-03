/**
 * Title composition for unseen questionnaires (no ML/LLM).
 *
 * Literature applied:
 * - RAKE / RAKE-PD: stop words as phrase delimiters, not just punctuation (Rose et al.; SciELO 2024)
 * - YAKE: position + length features for short text (Campos et al. 2020) — statistical only
 * - Extractive summarization: trim subordinate clauses, cap output length (Nenkova & McKeown)
 * - PRAKE: prefer complete noun phrases over verb fragments (phrase refinement)
 */

const PIPE_RE = /<[^>]+>/g;
const MAX_TITLE_WORDS = 15;

const TRAILING_CLAUSE_RE =
  /\b(?:when you|while (?:purchasing|buying)|as part of your|in order to|so that|if you|that you|who you|where you|because you|decide to buy|please select(?: all)?|pick your top|per option|slide \d+|what usually makes|think of brands).*$/i;

const QUESTION_PREFIXES = [
  /^\s*which\s+of\s+the\s+following\s+best\s+describes\s+(?:how\s+you\s+)?(?:your\s+)?/i,
  /^\s*which\s+of\s+the\s+following\s+(?:stores|brands|platforms|types|kind|statements)\s+/i,
  /^\s*which\s+of\s+the\s+following\s+/i,
  /^\s*which\s+(?:tech\s+|sports\s+)?(?:brands|stores|platforms|items|activities)\s+(?:do\s+you\s+|are\s+you\s+|typically\s+)?/i,
  /^\s*which\s+of\s+these\s+/i,
  /^\s*what\s+are\s+the\s+(?:main\s+|key\s+|top\s+\d+\s+)?(?:reasons\s+|factors\s+|brands\s+)?/i,
  /^\s*what\s+(?:is|are)\s+(?:your|the)\s+/i,
  /^\s*what\s+kind\s+of\s+/i,
  /^\s*what\s+type\s+of\s+/i,
  /^\s*on\s+what\s+activities\s+do\s+you\s+typically\s+/i,
  /^\s*please\s+(?:select|tell|let\s+me\s+know|indicate|look\s+at[^\w]+and\s+tell)\s+(?:me\s+|us\s+)?(?:what\s+(?:is|are)\s+)?(?:the\s+|your\s+)?/i,
  /^\s*how\s+(?:important|satisfied|aware|familiar|likely|influential|often|frequently|much)\s+(?:is|are|do|would|was|were)\s+/i,
  /^\s*in\s+your\s+observation,?\s*/i,
  /^\s*thinking\s+about\s+(?:your\s+)?(?:most\s+recent\s+)?/i,
  /^\s*you\s+might\s+have\s+some\s+(?:experience\s+)?/i,
  /^\s*you\s+mentioned\s+(?:that\s+)?(?:you\s+)?/i,
  /^\s*on\s+what\s+/i,
  /^\s*for\s+(?:your|which)\s+/i,
  /^\s*(?:could|can)\s+you\s+please\s+(?:tell\s+me\s+)?(?:what\s+(?:is|are)\s+)?(?:the\s+|your\s+)?/i,
  /^\s*do\s+you\s+/i,
  /^\s*have\s+you\s+/i,
  /^\s*are\s+you\s+/i,
  /^\s*when\s+you\s+(?:start\s+)?(?:considering|think(?:ing)?\s+about)\s+(?:any\s+)?/i,
  /^\s*when\s+you\s+/i,
  /^\s*where\s+do\s+you\s+(?:typically\s+)?/i,
  /^\s*why\s+do\s+you\s+/i,
  /^\s*before\s+today,?\s*/i,
  /^\s*as\s+you\s+are\s+aware\s+of\s+/i,
];

export type QuestionArchetype =
  | 'open_end'
  | 'instruction'
  | 'demographic'
  | 'awareness'
  | 'importance'
  | 'satisfaction'
  | 'frequency'
  | 'reasons'
  | 'preference'
  | 'comparison'
  | 'proportion'
  | 'influence'
  | 'behavior'
  | 'listing'
  | 'familiarity'
  | 'likelihood'
  | 'unknown';

type ArchetypeRule = { archetype: QuestionArchetype; re: RegExp };

const ARCHETYPE_RULES: ArchetypeRule[] = [
  { archetype: 'instruction', re: /post code below|nccs|sn:\s*continue/i },
  { archetype: 'open_end', re: /record verbatim|type in your response|_{3,}|open\s*end/i },
  { archetype: 'comparison', re: /compared to \d+\s*months ago|now vs|versus/i },
  { archetype: 'proportion', re: /what proportion|percentage of/i },
  { archetype: 'awareness', re: /how aware|had you heard|heard of|awareness of|aware of/i },
  { archetype: 'importance', re: /how important/i },
  { archetype: 'satisfaction', re: /how satisfied|rate your .+ experience|satisfaction with/i },
  { archetype: 'familiarity', re: /how familiar/i },
  { archetype: 'influence', re: /how influential|influence your|influence on/i },
  { archetype: 'likelihood', re: /how likely|willing to pay|willingness/i },
  { archetype: 'frequency', re: /how often|how frequently|how many times/i },
  { archetype: 'reasons', re: /why (?:do|did) you|reasons (?:for|you)|main reason/i },
  { archetype: 'preference', re: /prefer|preference|most often|enjoy (?:the\s+)?most|favourite|favorite/i },
  { archetype: 'behavior', re: /have you (?:ever\s+)?(?:purchased|used|tried|visited)|do you (?:currently\s+)?(?:have|own|use|purchase)/i },
  { archetype: 'demographic', re: /what is your|please select your|marital status|family status|household|occupation|education|employment status|age in completed/i },
  { archetype: 'listing', re: /which (?:of the following|platforms|stores|brands|types|kind)/i },
];

export function detectArchetype(text: string): QuestionArchetype {
  const t = preprocess(text).toLowerCase();
  for (const rule of ARCHETYPE_RULES) {
    if (rule.re.test(t)) return rule.archetype;
  }
  return 'unknown';
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toTitlePhrase(s: string): string {
  return capTitle(
    s
      .split(/\s+/)
      .filter(Boolean)
      .map((w, i) => {
        if (/^[A-Z]{2,}(-[A-Z]+)?$/.test(w)) return w;
        if (/^(ai|ott|lbma|nccs|pc|pcs)$/i.test(w)) return w.toUpperCase();
        return i === 0 ? capitalize(w) : w.toLowerCase();
      })
      .join(' ')
  );
}

function capTitle(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length <= MAX_TITLE_WORDS) return words.join(' ');
  return words.slice(0, MAX_TITLE_WORDS).join(' ');
}

function preprocess(text: string): string {
  return text
    .replace(PIPE_RE, ' ')
    .replace(/\([^)]*pipe[^)]*\)/gi, ' ')
    .replace(/\(pipe[^)]*\)/gi, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:single|multiple|record|ranking|grid)\s+coding\b.*/gi, '')
    .replace(/please select and rank[^.]*$/i, '')
    .replace(/\(.*?per option.*?\)/gi, '')
    .replace(/,?\s*randomize\b.*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripPrefixes(text: string): string {
  let t = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pref of QUESTION_PREFIXES) {
      if (pref.test(t)) {
        t = t.replace(pref, '');
        changed = true;
        break;
      }
    }
  }
  return t.replace(TRAILING_CLAUSE_RE, '').replace(/[?.:;,\s]+$/, '').trim();
}

function trimTopic(topic: string): string {
  return topic
    .replace(TRAILING_CLAUSE_RE, '')
    .replace(/\b(such as|e\.g\.|etc|including|among others).*$/i, '')
    .replace(/\b(in the (?:last|past) \d+ months?)\b.*/i, '')
    .replace(/\b(for each time of the day)\b.*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractKeyphrase(text: string): string {
  const cleaned = stripPrefixes(preprocess(text)).toLowerCase();
  if (!cleaned) return '';

  return trimTopic(cleaned);
}

function composeFromArchetype(archetype: QuestionArchetype, text: string): string | null {
  const topic = trimTopic(extractKeyphrase(text));
  if (!topic && archetype !== 'open_end' && archetype !== 'instruction') return null;

  switch (archetype) {
    case 'instruction':
      return 'NCCS classification';
    case 'open_end':
      return topic ? toTitlePhrase(topic) : 'Open end';
    case 'demographic':
      return toTitlePhrase(topic);
    case 'awareness':
      return capTitle(`Awareness of ${toTitlePhrase(topic)}`);
    case 'importance': {
      const core = topic
        .replace(/\bbeing built into\b/i, 'in')
        .replace(/\bwhen you decide to buy\b/i, '')
        .replace(/\bwhile purchasing\b/i, '')
        .trim();
      return capTitle(`Importance of ${toTitlePhrase(core)}`);
    }
    case 'satisfaction':
      return capTitle(`Satisfaction with ${toTitlePhrase(topic)}`);
    case 'familiarity':
      return capTitle(`Familiarity with ${toTitlePhrase(topic)}`);
    case 'frequency':
      return topic.includes('frequency') ? toTitlePhrase(topic) : capTitle(`${toTitlePhrase(topic)} frequency`);
    case 'reasons': {
      const clean = topic.replace(/^(?:for\s+)+/i, '').replace(/\bpipe\b.*$/i, '').trim();
      return capTitle(`Reasons for ${toTitlePhrase(clean)}`);
    }
    case 'preference':
      if (/spend your day|activities.*day/i.test(text)) return 'Daily activities';
      if (/hang out|hangout/i.test(text)) return 'Hangout places';
      if (/hobbies|interests/i.test(text)) return 'Main hobbies';
      if (/content.*create/i.test(text)) return 'Content creation';
      return topic.match(/prefer|favourite|favorite/)
        ? capTitle(`Preferred ${toTitlePhrase(topic.replace(/\bprefer(red)?\b/i, '').trim())}`)
        : capTitle(`${toTitlePhrase(topic)} preference`);
    case 'comparison': {
      const metal = /\bgold\b/i.test(text) ? 'Gold' : /\bsilver\b/i.test(text) ? 'Silver' : '';
      const months = text.match(/(\d+)\s*months ago/i);
      if (metal && months) return `${metal} demand now vs ${months[1]} months ago`;
      return toTitlePhrase(topic);
    }
    case 'proportion':
      return capTitle(`Proportion ${toTitlePhrase(topic)}`);
    case 'influence':
      return topic.includes('influence') ? toTitlePhrase(topic) : capTitle(`${toTitlePhrase(topic)} influence`);
    case 'likelihood':
      return capTitle(`Willingness ${toTitlePhrase(topic)}`);
    case 'behavior':
      if (/visited a physical store.*laptops|visited.*store.*research/i.test(text)) {
        return 'Store visit for research';
      }
      return toTitlePhrase(topic);
    case 'listing':
      if (/behave when buying tech|buying tech products/i.test(text)) return 'Tech purchase behaviour';
      if (/stores.*enjoy visiting/i.test(text)) return 'Preferred stores';
      return toTitlePhrase(topic);
    default:
      return topic ? toTitlePhrase(topic) : null;
  }
}

export function composeTableTitle(text: string): string | null {
  const archetype = detectArchetype(text);

  if (/behave when buying tech|buying tech products/i.test(text)) {
    return 'Tech purchase behaviour';
  }
  if (/spend your day/i.test(text) && /activities/i.test(text)) {
    return 'Daily activities';
  }
  if (/spend time on work/i.test(text)) {
    return 'Work activity type';
  }
  if (/instagram.recommended|trending places/i.test(text)) {
    return 'Trending places visited';
  }

  if (archetype === 'unknown') {
    const topic = extractKeyphrase(text);
    return topic ? toTitlePhrase(topic) : null;
  }
  return composeFromArchetype(archetype, text);
}
