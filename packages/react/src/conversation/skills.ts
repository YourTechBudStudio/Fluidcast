import { parseModifier, type Skill } from '@yourtechbudstudio/fluidcast-tool-agent/schema';

// The composer's skill suggestions, pure: when the menu opens, how names match, and what completing writes. The menu is
// only a typing aid: what counts as a skill when sent is `parseModifier`, the same rule the Agent tool applies.

/** A name's fuzzy match: its rank (higher is better) and the matched character positions, in order. */
export interface NameMatch {
  readonly score: number;
  readonly positions: ReadonlyArray<number>;
}

const isWordStart = (name: string, at: number): boolean =>
  at === 0 || name[at - 1] === '-' || name[at - 1] === '_' || name[at - 1] === ':';

/**
 * Matches `query` against `name` in the style of VS Code's quick open: the query's characters must appear in the name
 * in order, case-insensitively, but need not be adjacent. Ranks, most significant first: a name that starts with the
 * query, then matches on word starts (after `-`, `_` or `:`), then adjacent matches, then shorter names. Of the
 * possible alignments, the best one is kept and its positions returned. An empty query matches everything equally.
 */
export const matchName = (query: string, name: string): NameMatch | undefined => {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  const brevity = 999 - Math.min(n.length, 999);
  if (q.length === 0) return { score: brevity, positions: [] };
  if (n.startsWith(q)) {
    const positions = Array.from(q, (_, i) => i);
    return { score: 1e9 + alignmentScore(name, positions) * 1e3 + brevity, positions };
  }
  // best[i][j]: the best alignment of q[0..i] that matches q[i] at n[j]; from[i][j] is where q[i-1] matched.
  const best: Array<Array<number>> = [];
  const from: Array<Array<number>> = [];
  for (let i = 0; i < q.length; i++) {
    best.push(Array.from({ length: n.length }, () => -Infinity));
    from.push(Array.from({ length: n.length }, () => -1));
    for (let j = i; j < n.length; j++) {
      if (n[j] !== q[i]) continue;
      const own = isWordStart(name, j) ? wordStartWeight : 0;
      if (i === 0) {
        best[i]![j] = own;
        continue;
      }
      for (let k = i - 1; k < j; k++) {
        const prior = best[i - 1]![k]!;
        if (prior === -Infinity) continue;
        const total = prior + own + (k === j - 1 ? 1 : 0);
        if (total > best[i]![j]!) {
          best[i]![j] = total;
          from[i]![j] = k;
        }
      }
    }
  }
  const last = best[q.length - 1]!;
  let end = -1;
  for (let j = 0; j < n.length; j++) if (last[j]! > (end === -1 ? -Infinity : last[end]!)) end = j;
  if (end === -1) return undefined;
  const positions: Array<number> = [];
  for (let i = q.length - 1, j = end; i >= 0; j = from[i]![j]!, i--) positions.unshift(j);
  return { score: last[end]! * 1e3 + brevity, positions };
};

/** One word start outweighs any number of adjacent matches. */
const wordStartWeight = 1000;

const alignmentScore = (name: string, positions: ReadonlyArray<number>): number =>
  positions.reduce(
    (total, at, i) =>
      total + (isWordStart(name, at) ? wordStartWeight : 0) + (positions[i - 1] === at - 1 ? 1 : 0),
    0,
  );

/** A skill the menu offers, with the name positions to highlight. */
export interface SkillMatch {
  readonly skill: Skill;
  readonly positions: ReadonlyArray<number>;
}

/** How many matches the menu shows. */
export const menuLimit = 6;

/** The best matches for `query`, ranked; ties, and a bare `/`, keep the list's order. Names only. */
export const matchSkills = (
  skills: ReadonlyArray<Skill>,
  query: string,
  limit = menuLimit,
): ReadonlyArray<SkillMatch> =>
  skills
    .flatMap((skill, index) => {
      const match = matchName(query, skill.name);
      return match === undefined
        ? []
        : [{ skill, positions: match.positions, score: match.score, index }];
    })
    .sort((a, b) =>
      query.length === 0 ? a.index - b.index : b.score - a.score || a.index - b.index,
    )
    .slice(0, limit)
    .map(({ skill, positions }) => ({ skill, positions }));

/**
 * The menu's query, or `undefined` when the menu stays shut: the caret (with nothing selected) must sit in the first
 * word, which must start with `/`, and what precedes the caret must be `/` and name characters. Upper case is allowed,
 * because matching ignores case; a second `/`, as in a path, never opens it.
 */
export const menuQuery = (
  text: string,
  selection: { readonly start: number; readonly end: number },
): string | undefined => {
  if (selection.start !== selection.end) return undefined;
  const typed = /^\/([A-Za-z0-9:_-]*)$/.exec(text.slice(0, selection.start));
  if (typed === null) return undefined;
  // The caret may sit inside the word: the rest of it must still be name characters.
  const rest = /^\S*/.exec(text.slice(selection.start))![0];
  return /^[A-Za-z0-9:_-]*$/.test(rest) ? typed[1] : undefined;
};

/** The first word, the one `/name` occupies: the text up to the first whitespace. */
export const firstWord = (text: string): string => /^\S*/.exec(text)![0];

/** Completing to `name`: the first word becomes `/name` and one space, the rest is kept, and the caret follows the space. */
export const completeSkill = (
  text: string,
  name: string,
): { readonly text: string; readonly caret: number } => {
  const head = `/${name} `;
  return {
    text: head + text.slice(firstWord(text).length).replace(/^[ \t]+/, ''),
    caret: head.length,
  };
};

/** How many leading characters are a skill the Agent tool will recognise (`/` and the name), or 0. */
export const skillPrefixLength = (text: string): number => {
  const parsed = parseModifier(text);
  return parsed === undefined ? 0 : parsed.modifier.name.length + 1;
};
