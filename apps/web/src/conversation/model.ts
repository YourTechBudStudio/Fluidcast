import type { Connection, ConversationView } from '@yourtechbudstudio/fluidcast-client';
import type { Action as ProtocolAction } from '@yourtechbudstudio/fluidcast-core/actions';
import type { Phase, SpeakerLabel } from '@yourtechbudstudio/fluidcast-harness/protocol';

/** The player renders the protocol's own types (ADR 0007): no local mirror. */
export type Action = ProtocolAction;
export type { Connection, ConversationView, Phase };

/** A configured voice, as the Harness snapshot labels it. Only its id appears in actions. */
export type Speaker = SpeakerLabel;

/** What the UI can ask of the conversation. Each resolves `true` once the Harness accepted the command. */
export interface ConversationCommands {
  readonly sendMessage: (text: string) => Promise<boolean>;
  readonly interrupt: () => Promise<boolean>;
  readonly retryGeneration: () => Promise<boolean>;
}
