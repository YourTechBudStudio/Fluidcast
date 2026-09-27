import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkTools } from '@yourtechbudstudio/fluidcast-core/generation';
import { askToolName } from '@yourtechbudstudio/fluidcast-tool-ask/schema';
import { showToolName } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import { referenceTools } from './session.ts';

describe('referenceTools', () => {
  it('registers Show and Ask, in that order, as a valid tool set', () => {
    const tools = referenceTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [showToolName, askToolName],
    );
    assert.doesNotThrow(() => checkTools(tools));
  });
});
