import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Effect } from 'effect';
import { LanguageModel } from 'effect/unstable/ai';

import { checkTools } from '@yourtechbudstudio/fluidcast-core/generation';
import { agentTool } from '@yourtechbudstudio/fluidcast-tool-agent';
import { agentToolName } from '@yourtechbudstudio/fluidcast-tool-agent/schema';
import { askToolName } from '@yourtechbudstudio/fluidcast-tool-ask/schema';
import { showToolName } from '@yourtechbudstudio/fluidcast-tool-show/schema';

import { referenceTools, referenceWorkerTypes } from './session.ts';

describe('referenceTools', () => {
  it('registers Show, Ask and Agent, in that order, as a valid tool set', async () => {
    // Building the pool spawns nothing: workers connect on their first message.
    const tools = await Effect.runPromise(
      Effect.gen(function* () {
        const agents = yield* agentTool({
          types: referenceWorkerTypes({ cwd: process.cwd(), environment: {} }),
        });
        return referenceTools(agents.tool);
      }).pipe(
        Effect.provideServiceEffect(
          LanguageModel.LanguageModel,
          LanguageModel.make({
            generateText: () => Effect.die('unused'),
            streamText: () => Effect.die('unused') as never,
          }),
        ),
        Effect.scoped,
      ),
    );
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [showToolName, askToolName, agentToolName],
    );
    assert.doesNotThrow(() => checkTools(tools));
  });
});
