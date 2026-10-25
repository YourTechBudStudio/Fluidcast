import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { oneThinkingPerStretch } from './content.ts';
import type { TranscriptEntry } from './schema.ts';

const thinking = (parentToolUseId: string | null = null): TranscriptEntry => ({
  _tag: 'thinking',
  parentToolUseId,
  summary: '',
});

const line = (text: string, parentToolUseId: string | null = null): TranscriptEntry => ({
  _tag: 'text',
  parentToolUseId,
  text,
});

describe('oneThinkingPerStretch', () => {
  it('drops a thinking entry whose previous entry of the same parent is thinking', () => {
    assert.deepEqual(
      oneThinkingPerStretch([
        thinking(),
        thinking(),
        line('A.'),
        thinking(),
        // Another parent's entries neither end nor start the top-level stretch.
        thinking('call_1'),
        line('Sub.', 'call_1'),
        thinking(),
        thinking('call_1'),
        thinking('call_1'),
      ]),
      [
        thinking(),
        line('A.'),
        thinking(),
        thinking('call_1'),
        line('Sub.', 'call_1'),
        thinking('call_1'),
      ],
    );
  });
});
