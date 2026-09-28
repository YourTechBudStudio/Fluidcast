import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ToolFault } from '@yourtechbudstudio/fluidcast-harness';

import { faultOf } from './failure.ts';
import { assistant, background, result, say, text } from './frames.test.ts';

const assistantError = (error: string) => assistant([text('Something went wrong.')], { error });

describe('failure classification', () => {
  it('makes a known startup failure a ClaudeStartup fault', () => {
    assert.deepEqual(
      faultOf(result({ subtype: 'error_during_execution', startupFailure: 'cwd_unavailable' })),
      new ToolFault({ reason: 'ClaudeStartup' }),
    );
  });

  it('makes account and credential errors ClaudeAuth faults', () => {
    for (const error of [
      'authentication_failed',
      'oauth_org_not_allowed',
      'account_on_hold',
      'verification_required',
      'billing_error',
      'cloud_credential_error',
    ]) {
      assert.deepEqual(faultOf(assistantError(error)), new ToolFault({ reason: 'ClaudeAuth' }));
    }
  });

  it('leaves other assistant errors and error results to the turn', () => {
    for (const error of [
      'rate_limit',
      'overloaded',
      'server_error',
      'max_output_tokens',
      'unknown',
    ]) {
      assert.equal(faultOf(assistantError(error)), undefined);
    }
    assert.equal(faultOf(result({ subtype: 'error_during_execution' })), undefined);
    assert.equal(faultOf(result({ isError: true })), undefined);
    assert.equal(faultOf(say('Fine.')), undefined);
    assert.equal(faultOf(background()), undefined);
  });
});
