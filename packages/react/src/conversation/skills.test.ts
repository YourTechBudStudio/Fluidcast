import { describe, expect, it } from 'vitest';

import type { Skill } from '@yourtechbudstudio/fluidcast-tool-agent/schema';

import { completeSkill, matchName, matchSkills, menuQuery, skillPrefixLength } from './skills';

const skill = (name: string): Skill => ({ name, description: `About ${name}.` });
const names = (matches: ReturnType<typeof matchSkills>) => matches.map((m) => m.skill.name);
const caret = (at: number) => ({ start: at, end: at });

describe('matchName', () => {
  it('finds create-implementation-plan from its word starts and from a word', () => {
    expect(matchName('cip', 'create-implementation-plan')?.positions).toEqual([0, 7, 22]);
    // The word `plan`, not the scattered p, l, a, n inside `implementation`.
    expect(matchName('plan', 'create-implementation-plan')?.positions).toEqual([22, 23, 24, 25]);
  });

  it('ignores case', () => {
    expect(matchName('Des', 'designing-ui')?.positions).toEqual([0, 1, 2]);
  });

  it('needs the characters in order', () => {
    expect(matchName('ud', 'designing-ui')).toBeUndefined();
    expect(matchName('x', 'designing-ui')).toBeUndefined();
  });

  it('highlights the best alignment', () => {
    expect(matchName('dui', 'designing-ui')?.positions).toEqual([0, 10, 11]);
    expect(matchName('si', 'shaping-issues')?.positions).toEqual([0, 8]);
  });
});

describe('matchSkills', () => {
  const list = [
    skill('ui-design'),
    skill('shaping-issues'),
    skill('designing-ui'),
    skill('design-architecture'),
    skill('code-review'),
  ];

  it('ranks names that start with the query above names that only contain it', () => {
    expect(names(matchSkills(list, 'des'))).toEqual([
      'designing-ui',
      'design-architecture',
      'ui-design',
    ]);
  });

  it('ranks word starts above scattered matches, then shorter names', () => {
    const ranked = matchSkills([skill('a-b-long'), skill('xaxb'), skill('a-b')], 'ab').map(
      (m) => m.skill.name,
    );
    expect(ranked).toEqual(['a-b', 'a-b-long', 'xaxb']);
  });

  it('keeps the list order for ties', () => {
    expect(names(matchSkills([skill('ab-x'), skill('ab-y')], 'ab'))).toEqual(['ab-x', 'ab-y']);
  });

  it('lists everything in order for a bare slash, up to the limit', () => {
    expect(names(matchSkills(list, ''))).toEqual(list.map((s) => s.name));
    expect(names(matchSkills(list, '', 2))).toEqual(['ui-design', 'shaping-issues']);
  });

  it('matches names only, never descriptions', () => {
    expect(matchSkills([{ name: 'review', description: 'designs' }], 'des')).toEqual([]);
  });
});

describe('menuQuery', () => {
  it('opens while the caret is in a first word that starts with a slash', () => {
    expect(menuQuery('/', caret(1))).toBe('');
    expect(menuQuery('/des', caret(4))).toBe('des');
    expect(menuQuery('/Des', caret(4))).toBe('Des');
    expect(menuQuery('/des more', caret(4))).toBe('des');
    // Inside the word: the query is what precedes the caret.
    expect(menuQuery('/designing', caret(4))).toBe('des');
  });

  it('stays shut once the caret leaves the first word, or with a selection', () => {
    expect(menuQuery('/des more', caret(5))).toBeUndefined();
    expect(menuQuery('/des more', caret(0))).toBeUndefined();
    expect(menuQuery('/des', { start: 1, end: 4 })).toBeUndefined();
  });

  it('stays shut for anything that is not a slash and name characters', () => {
    expect(menuQuery('/tmp/x', caret(6))).toBeUndefined();
    expect(menuQuery('/tmp/x', caret(2))).toBeUndefined();
    expect(menuQuery(' /des', caret(5))).toBeUndefined();
    expect(menuQuery('des', caret(3))).toBeUndefined();
    expect(menuQuery('/dé', caret(3))).toBeUndefined();
  });
});

describe('completeSkill', () => {
  it('writes the name and one space, keeping the rest and placing the caret after the space', () => {
    expect(completeSkill('/des', 'designing-ui')).toEqual({ text: '/designing-ui ', caret: 14 });
    expect(completeSkill('/Des', 'designing-ui')).toEqual({ text: '/designing-ui ', caret: 14 });
    expect(completeSkill('/des three mockups', 'designing-ui')).toEqual({
      text: '/designing-ui three mockups',
      caret: 14,
    });
    expect(completeSkill('/', 'shaping-issues')).toEqual({ text: '/shaping-issues ', caret: 16 });
  });
});

describe('skillPrefixLength', () => {
  it('colours only what the Agent tool reads as a skill', () => {
    expect(skillPrefixLength('/designing-ui three mockups')).toBe(13);
    expect(skillPrefixLength('/designing-ui')).toBe(13);
    expect(skillPrefixLength('/Des')).toBe(0);
    expect(skillPrefixLength('/tmp/notes.md has the draft')).toBe(0);
    expect(skillPrefixLength(' /designing-ui')).toBe(0);
    expect(skillPrefixLength('/')).toBe(0);
  });
});
