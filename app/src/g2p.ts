// English text to phonemes (ARPAbet without stress), using spelling rules plus a list of irregular words.
// It only has to be good enough to pick mouth shapes; the voice does its own pronunciation.

export interface SpokenWord {
  /** Position in the original text, to match the voice's word events. */
  start: number;
  end: number;
  phonemes: string[];
  /** Silence after the word, from punctuation, in milliseconds. */
  pause: number;
}

const IRREGULAR: Record<string, string> = Object.fromEntries(`
a AX|an AE N|the TH AX|of AH V|to T UW|too T UW|two T UW|do D UW|does D AH Z|done D AH N|don't D OW N T|who HH UW|whose HH UW Z|you Y UW|your Y AO R|yours Y AO R Z|youth Y UW TH
are AA R|were W ER|was W AA Z|is IH Z|his HH IH Z|has HH AE Z|as AE Z|have HH AE V|give G IH V|live L IH V|gave G EY V|said S EH D|says S EH Z|one W AH N|once W AH N S|won W AH N|son S AH N
some S AH M|come K AH M|love L AH V|above AX B AH V|other AH TH ER|mother M AH TH ER|brother B R AH TH ER|another AX N AH TH ER|nothing N AH TH IH NG|money M AH N IY|month M AH N TH|front F R AH N T|from F R AH M|what W AH T
there TH EH R|their TH EH R|they TH EY|where W EH R|here HH IH R|hear HH IH R|heart HH AA R T|very V EH R IY|many M EH N IY|any EH N IY|every EH V R IY|people P IY P L|because B IH K AO Z|been B IH N|being B IY IH NG
could K UH D|would W UH D|should SH UH D|put P UH T|push P UH SH|pull P UH L|full F UH L|good G UH D|food F UW D|mood M UW D|blood B L AH D|look L UH K|book B UH K|woman W UH M AX N|women W IH M IH N
hello HH AX L OW|hi HH AY|bye B AY|my M AY|i AY|eye AY|eyes AY Z|me M IY|he HH IY|she SH IY|we W IY|be B IY|go G OW|so S OW|no N OW|know N OW|known N OW N|own OW N|show SH OW|grown G R OW N|shown SH OW N|flow F L OW|now N AW|how HH AW|our AW R|hour AW R|four F AO R|pour P AO R|tour T UH R
laugh L AE F|enough IH N AH F|rough R AH F|tough T AH F|cough K AO F|through TH R UW|though TH OW|thought TH AO T|young Y AH NG|touch T AH CH|country K AH N T R IY|double D AH B L|trouble T R AH B L|group G R UW P|soup S UW P
get G EH T|girl G ER L|gift G IH F T|begin B IH G IH N|together T AX G EH TH ER|finger F IH NG G ER|hungry HH AH NG G R IY|english IH NG G L IH SH|language L AE NG G W IH JH
great G R EY T|break B R EY K|bread B R EH D|friend F R EH N D|ready R EH D IY|head HH EH D|dead D EH D|weather W EH TH ER|want W AA N T|water W AO T ER|watch W AA CH|war W AO R|warm W AO R M|word W ER D|work W ER K|world W ER L D
island AY L AX N D|half HH AE F|calm K AA M|talk T AO K|walk W AO K|move M UW V|prove P R UW V|shoe SH UW|lose L UW Z|gone G AO N|busy B IH Z IY|business B IH Z N IH S|build B IH L D|buy B AY|guy G AY|guess G EH S
sure SH UH R|sugar SH UH G ER|ocean OW SH AX N|special S P EH SH AX L|machine M AX SH IY N|police P AX L IY S|idea AY D IY AX|area EH R IY AX|video V IH D IY OW|radio R EY D IY OW|photo F OW T OW|piano P IY AE N OW
today T AX D EY|tomorrow T AX M AA R OW|tonight T AX N AY T|welcome W EH L K AX M|beautiful B Y UW T IH F AX L|avatar AE V AX T AA R|namaste N AA M AX S T EY|kurta K ER T AX|salwar S AA L W AA R|name N EY M|nice N AY S|meet M IY T|please P L IY Z
zero Z IH R OW|three TH R IY|five F AY V|six S IH K S|seven S EH V AX N|eight EY T|nine N AY N|ten T EH N|eleven IH L EH V AX N|twelve T W EH L V|hundred HH AH N D R AX D|thousand TH AW Z AX N D|million M IH L Y AX N|dollar D AA L ER|percent P ER S EH N T|and AE N D|plus P L AH S|at AE T|point P OY N T|forty F AO R T IY
`.trim().split(/[|\n]/).map(entry => [entry.slice(0, entry.indexOf(' ')), entry.slice(entry.indexOf(' ') + 1)]));

// [spelling, phonemes], tried in order at each position. Grouped by the first letter they match.
const V = '[aeiouy]';
const SOURCE: [string, string][] = [
  ['augh(?=t)', 'AO'], ['au', 'AO'], ['aw', 'AO'], ['air', 'EH R'], ['ai', 'EY'], ['ay', 'EY'], ['are$', 'EH R'], ['ar(?=[^aeiou]|$)', 'AA R'], ['all', 'AO L'], ['al(?=k)', 'AO'],
  ['(?<=[a-z]{2})age$', 'IH JH'], ['able$', 'AX B L'], ['a(?=[bcdfgklmnpstvz]e$)', 'EY'], ['a(?=[bcdfgkmnpstvz](?:ing|ed|es|er|ers)$)', 'EY'], ['a(?=tion)', 'EY'], ['a$', 'AX'], ['^a(?=[^aeiou][aeiou])', 'AX'], ['(?<=w)a(?=[tsn])', 'AA'], ['a', 'AE'],
  ['b(?=t$)', ''], ['b+', 'B'],
  ['ch(?=r)', 'K'], ['ch', 'CH'], ['ck', 'K'], ['ci(?=al|ous|an|ent)', 'SH'], ['cc(?=[eiy])', 'K S'], ['c(?=[eiy])', 'S'], ['c+', 'K'],
  ['dg(?=e)', 'JH'], ['d+', 'D'],
  ['eigh', 'EY'], ['eau', 'OW'], ['ee', 'IY'], ['ear(?=[nldt])', 'ER'], ['ear', 'IH R'], ['eer', 'IH R'], ['ea(?=lth|the|ven|sure)', 'EH'], ['ea', 'IY'], ['ew', 'UW'], ['eu', 'UW'], ['ei', 'IY'], ['ey$', 'IY'], ['er(?=r)', 'EH'], ['er', 'ER'],
  [`(?<=${V}[a-z]*(?:[pkfsxc]|ch|sh))ed$`, 'T'], [`(?<=${V}[a-z]*[td])ed$`, 'IH D'], [`(?<=${V}[a-z]*)ed$`, 'D'],
  [`(?<=${V}[a-z]*(?:[szxgc]|ch|sh))es$`, 'IH Z'], [`(?<=${V}[a-z]*)es$`, 'Z'], [`(?<=${V}[a-z]*)e$`, ''], [`(?<=${V}[a-z]*)e(?=(?:ly|ment|less|ful)$)`, ''],
  ['^e(?=[^aeiou][aeiou])', 'IH'], ['e$', 'IY'], ['e(?=[^aeiou]e$)', 'IY'], [`(?<=${V}[a-z]*)e(?=(?:l|n|nt|nce|m)$)`, 'AX'], ['e', 'EH'],
  ['f+', 'F'],
  ['^gh', 'G'], ['gh', ''], ['^gn', 'N'], ['gn$', 'N'], ['gg', 'G'], ['g(?=[eiy])', 'JH'], ['g', 'G'],
  ['h(?=[aeiouy])', 'HH'], ['h', ''],
  ['igh', 'AY'], ['ign$', 'AY N'], [`(?<=^[^aeiou]+)ie[sd]?$`, 'AY'], ['ies$', 'IY Z'], ['ied$', 'IY D'], ['ie', 'IY'], ['ir(?=e)', 'AY R'], ['ir(?=[^aeiou]|$)', 'ER'], ['ing$', 'IH NG'], [`(?<=${V}[a-z]+)ive$`, 'IH V'],
  ['i(?=[bcdfgklmnpstvz]e$)', 'AY'], ['i(?=[bcdfgkmnpstvz](?:ing|ed|es|er|ers)$)', 'AY'], ['i(?=nd$|ld$)', 'AY'], ['i(?=[ao])', 'IY'], ['i$', 'IY'], ['i', 'IH'],
  ['j', 'JH'], ['^kn', 'N'], ['k+', 'K'],
  ['(?<=[bcdfgkpstz])le$', 'AX L'], ['l+', 'L'], ['mb$', 'M'], ['m+', 'M'],
  ['ng(?=$|s$|[^aeiou])', 'NG'], ['n(?=[kx])', 'NG'], ['n+', 'N'],
  ['ough(?=t)', 'AO'], ['ough', 'OW'], ['ould', 'UH D'], ['ous$', 'AX S'], ['ou', 'AW'], ['(?<=[lr]|kn|sn|st)ow(?!n)', 'OW'], ['ow', 'AW'], ['oo(?=k)', 'UH'], ['oo', 'UW'], ['o[yi]', 'OY'], ['oa', 'OW'], ['oe$', 'OW'],
  ['(?<=w)or(?=[dkls])', 'ER'], ['or', 'AO R'], ['o(?=[bcdfgklmnpstvz]e$)', 'OW'], ['o(?=[bcdgklmnpstvz](?:ing|ed|es|er|ers)$)', 'OW'], ['o(?=ld|st$|ll$)', 'OW'], ['o$', 'OW'], ['(?<=i)on$', 'AX N'], ['o(?=[^aeiou][aeiou])', 'OW'], ['o', 'AA'],
  ['ph', 'F'], ['^ps', 'S'], ['p+', 'P'], ['que$', 'K'], ['qu', 'K W'], ['q', 'K'], ['rh', 'R'], ['r+', 'R'],
  ['ssion', 'SH AX N'], ['sion', 'ZH AX N'], ['sure$', 'ZH ER'], ['sh', 'SH'], ['sch', 'S K'], ['sc(?=[eiy])', 'S'], ['s(?=m$)', 'Z'], ['(?<=[aeiou])s(?=[aeiou])', 'Z'], ['(?<=[bdglmnrvwy]|[aeo])s$', 'Z'], ['s+', 'S'],
  ['tch', 'CH'], ['th', 'TH'], ['tion', 'SH AX N'], ['ture', 'CH ER'], ['ti(?=al|ous|an)', 'SH'], ['t+', 'T'],
  ['ur', 'ER'], ['uy', 'AY'], ['ui', 'UW'], ['ue$', 'UW'], ['(?<=g)u(?=[eiy])', ''], ['u(?=[^aeiou]e$)', 'UW'], ['^u(?=[^aeiou][aeiou])', 'Y UW'], ['u$', 'UW'], ['(?<=[bp])u(?=ll|sh)', 'UH'], ['u', 'AH'],
  ['v+', 'V'], ['^wr', 'R'], ['wh(?=o)', 'HH'], ['wh?', 'W'], ['^x', 'Z'], ['x', 'K S'],
  ['^y', 'Y'], ['(?<=^[^aeiouy]+)y$', 'AY'], ['y$', 'IY'], ['y(?=[^aeiou]e$)', 'AY'], ['y', 'IH'], ['z+', 'Z'],
];
const RULES = new Map<string, [RegExp, string[]][]>();
for (const [pattern, phonemes] of SOURCE) {
  const letter = pattern.replace(/\(\?<?[=!](?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, '').replace('^', '')[0];
  RULES.set(letter, [...(RULES.get(letter) ?? []), [new RegExp(pattern, 'y'), phonemes ? phonemes.split(' ') : []]]);
}

const CONTRACTIONS: [RegExp, string[]][] = [
  [/n't$/, ['N', 'T']], [/'s$/, ['Z']], [/'re$/, ['ER']], [/'ll$/, ['AX', 'L']], [/'ve$/, ['V']], [/'m$/, ['M']], [/'d$/, ['D']]];
const LETTERS: Record<string, string> = {
  a: 'EY', b: 'B IY', c: 'S IY', d: 'D IY', e: 'IY', f: 'EH F', g: 'JH IY', h: 'EY CH', i: 'AY', j: 'JH EY', k: 'K EY', l: 'EH L', m: 'EH M',
  n: 'EH N', o: 'OW', p: 'P IY', q: 'K Y UW', r: 'AA R', s: 'EH S', t: 'T IY', u: 'Y UW', v: 'V IY', w: 'D AH B L Y UW', x: 'EH K S', y: 'W AY', z: 'Z IY',
};

export function wordToPhonemes(raw: string): string[] {
  const word = raw.toLowerCase().replaceAll('’', "'").normalize('NFD').replace(/\p{M}/gu, '');
  if (Object.hasOwn(IRREGULAR, word)) return IRREGULAR[word].split(' ');
  for (const [ending, phonemes] of CONTRACTIONS) {
    if (ending.test(word) && word.length > word.match(ending)![0].length) return [...wordToPhonemes(word.replace(ending, '')), ...phonemes];
  }
  const letters = word.replace(/[^a-z]/g, '');
  // Spell out abbreviations such as PDF or TV.
  if (letters.length > 1 && letters.length < 6 && (raw === raw.toUpperCase() && letters.length < 4 || !/[aeiouy]/.test(letters))) {
    return [...letters].flatMap(l => LETTERS[l].split(' '));
  }
  if (letters.length === 1) return LETTERS[letters].split(' ');
  const out: string[] = [];
  for (let i = 0; i < letters.length;) {
    let step = 1;
    for (const [pattern, phonemes] of RULES.get(letters[i]) ?? []) {
      pattern.lastIndex = i;
      const match = pattern.exec(letters);
      if (!match) continue;
      out.push(...phonemes);
      step = match[0].length;
      break;
    }
    i += step;
  }
  return out;
}

const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = 'zero ten twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');

export function numberWords(n: number): string[] {
  if (n < 20) return [ONES[n]];
  if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])];
  for (const [size, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [100, 'hundred']] as const) {
    if (n >= size) return [...numberWords(Math.floor(n / size)), name, ...(n % size ? numberWords(n % size) : [])];
  }
  return [];
}

const SYMBOLS: Record<string, string> = { '&': 'and', '%': 'percent', '+': 'plus', '@': 'at', $: 'dollar' };

function tokenPhonemes(token: string): string[] {
  if (Object.hasOwn(SYMBOLS, token)) return wordToPhonemes(SYMBOLS[token]);
  if (!/\d/.test(token)) return wordToPhonemes(token);
  const [whole, fraction] = token.replaceAll(',', '').split('.');
  const words = whole.length > 12 ? [...whole].map(d => ONES[Number(d)]) : numberWords(Number(whole));
  if (fraction) words.push('point', ...[...fraction].map(d => ONES[Number(d)]));
  return words.flatMap(wordToPhonemes);
}

export function textToWords(text: string): SpokenWord[] {
  const tokens = [...text.matchAll(/[A-Za-zÀ-ɏ]+(?:['’][A-Za-zÀ-ɏ]+)*|\d+(?:,\d{3})*(?:\.\d+)?|[&%+@$]/g)];
  return tokens.map((match, i) => {
    const start = match.index, end = start + match[0].length;
    const gap = text.slice(end, tokens[i + 1]?.index ?? text.length);
    const pause = /[.!?\n…]/.test(gap) ? 420 : /[,;:—–()]|\s-\s/.test(gap) ? 200 : 0;
    return { start, end, phonemes: tokenPhonemes(match[0]), pause };
  });
}

/** True when the text has letters the English rules cannot read, such as Hindi. */
export const hasUnsupportedLetters = (text: string): boolean => /[^\P{L}\p{Script=Latin}]/u.test(text);
