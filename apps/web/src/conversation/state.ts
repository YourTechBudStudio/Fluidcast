import { Atom } from 'effect/unstable/reactivity';

import { playbackAtom } from '../playback';
import type { Connection, ConversationCommands, ConversationView } from './model';
import { present } from './presentation';

/** The projected conversation. Phase 2 feeds it from fixtures; phase 5 from the Client SDK's view. */
export const conversationAtom = Atom.make<ConversationView>({
  actions: [],
  phase: 'idle',
  speakers: [],
}).pipe(Atom.keepAlive);

export const connectionAtom = Atom.make<Connection>('connecting').pipe(Atom.keepAlive);

const unwired = () => console.warn('[conversation] no commands are wired');

/** How the UI sends commands. The data source installs the implementation. */
export const commandsAtom = Atom.make<ConversationCommands>({
  sendMessage: unwired,
  interrupt: unwired,
  retryGeneration: unwired,
}).pipe(Atom.keepAlive);

/** Everything the player shows, derived from the conversation, the connection and playback. */
export const presentationAtom = Atom.make((get) =>
  present(get(conversationAtom), get(connectionAtom), get(playbackAtom)),
);
