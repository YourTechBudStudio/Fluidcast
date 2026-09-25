// Scripted stand-in for the Client SDK: loads fixture scenarios into the real atoms and answers commands with short scripts.
// Temporary; phase 5 replaces this whole module with the real data source.
import type { AtomRegistry } from 'effect/unstable/reactivity';

import {
  type Action,
  commandsAtom,
  connectionAtom,
  type ConversationView,
  conversationAtom,
  type Speaker,
} from '../conversation';
import { type PlaybackStatus, playbackAtom, playbackControlsAtom } from '../playback';
import * as F from './fixtures';
import type { SyntheticVoice } from './synthetic';

export const SCENARIOS = [
  { id: 'fresh', label: 'Fresh idle' },
  { id: 'sent', label: 'Just sent' },
  { id: 'speaking', label: 'Speaking' },
  { id: 'waiting', label: 'Waiting mid-turn' },
  { id: 'complete', label: 'Turn complete' },
  { id: 'interrupted', label: 'Interrupted' },
  { id: 'generationFailed', label: 'Generation failed' },
  { id: 'audioFailed', label: 'Audio failed' },
  { id: 'connecting', label: 'Connecting' },
  { id: 'reconnecting', label: 'Reconnecting' },
  { id: 'superseded', label: 'Superseded' },
  { id: 'held', label: 'Tap to resume' },
  { id: 'twoSpeakers', label: 'Two speakers' },
  { id: 'longTranscript', label: 'Long transcript' },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]['id'];

export const isScenarioId = (value: unknown): value is ScenarioId =>
  SCENARIOS.some((s) => s.id === value);

type Speak = Extract<Action, { type: 'speak' }>;

export interface MockDriver {
  load(id: ScenarioId): void;
  dispose(): void;
}

export function createMockDriver(
  registry: AtomRegistry.AtomRegistry,
  voice: SyntheticVoice,
  onScenario: (id: ScenarioId) => void,
): MockDriver {
  let timers: ReturnType<typeof setTimeout>[] = [];
  /**
   * Lines still to play in the current scripted turn. The "Speaking" scenarios keep the turn going with fresh lines appended to the log;
   * played actions are never rewritten (ADR 0006).
   */
  let queue: Speak[] = [];
  let loop: (() => Speak[]) | null = null;

  const later = (ms: number, f: () => void) => timers.push(setTimeout(f, ms));
  const halt = () => {
    timers.forEach(clearTimeout);
    timers = [];
    queue = [];
    loop = null;
    voice.stop();
  };

  const view = () => registry.get(conversationAtom);
  const setView = (patch: Partial<ConversationView>) =>
    registry.set(conversationAtom, { ...view(), ...patch });
  const setPlayback = (status: PlaybackStatus) => registry.set(playbackAtom, status);
  const reset = (
    speakers: readonly Speaker[],
    actions: Action[],
    phase: ConversationView['phase'],
    playback: PlaybackStatus = { kind: 'idle' },
  ) => {
    registry.set(connectionAtom, 'connected');
    registry.set(conversationAtom, { speakers, actions, phase });
    setPlayback(playback);
  };

  /** Plays the line at the cursor, then moves on to the next queued line, or ends the turn. */
  const play = (line: Speak) => {
    setPlayback({ kind: 'playing', actionId: line.id });
    const duration = voice.speak(line.text);
    later(duration, () => {
      voice.stop();
      const next = queue.shift();
      if (next) {
        setView({ actions: [...view().actions, next], phase: 'speaking' });
        play(next);
      } else if (loop) {
        const again = loop();
        const [first, ...rest] = again;
        queue = rest;
        setView({ actions: [...view().actions, first!], phase: 'speaking' });
        play(first!);
      } else {
        setView({ phase: 'idle' });
        setPlayback({ kind: 'idle' });
      }
    });
  };

  const startTurn = (lines: Speak[]) => {
    const [first, ...rest] = lines;
    if (!first) return;
    queue = rest;
    setView({ actions: [...view().actions, first], phase: 'speaking' });
    play(first);
  };

  const turnLines = () => F.TURN_LINES.map((text) => F.speak(text));

  const commands = {
    sendMessage(text: string) {
      const { phase } = view();
      if (
        registry.get(connectionAtom) !== 'connected' ||
        (phase !== 'idle' && phase !== 'generationFailed')
      )
        return;
      halt();
      setView({ actions: [...view().actions, F.user(text)], phase: 'waiting' });
      setPlayback({ kind: 'idle' });
      later(1600, () => startTurn(turnLines()));
    },
    interrupt() {
      const { phase } = view();
      if (phase !== 'speaking' && phase !== 'waiting') return;
      halt();
      setView({ actions: [...view().actions, F.interrupted()], phase: 'idle' });
      setPlayback({ kind: 'idle' });
    },
    retryGeneration() {
      if (view().phase !== 'generationFailed') return;
      halt();
      setView({ phase: 'waiting' });
      later(1200, () => startTurn(turnLines().slice(1)));
    },
  };

  const replayCurrent = () => {
    const status = registry.get(playbackAtom);
    const current = view().actions.at(-1);
    if (status.kind === 'idle' || current?.type !== 'speak' || current.id !== status.actionId)
      return;
    play(current);
  };
  const controls = { retryClip: replayCurrent, resume: replayCurrent };

  registry.set(commandsAtom, commands);
  registry.set(playbackControlsAtom, controls);

  const load = (id: ScenarioId) => {
    halt();
    onScenario(id);
    const past = F.history();
    const ask = F.user(F.SAMPLE_QUESTION);
    switch (id) {
      case 'fresh':
        return reset(F.SOLO, [], 'idle');
      case 'sent':
        return reset(F.SOLO, [...past, ask], 'waiting');
      case 'speaking': {
        const base = [...past, ask];
        reset(F.SOLO, base, 'waiting');
        loop = turnLines;
        return startTurn(turnLines());
      }
      case 'waiting': {
        const [a, b] = turnLines();
        return reset(F.SOLO, [...past, ask, a!, b!], 'waiting');
      }
      case 'complete':
        return reset(F.SOLO, past, 'idle');
      case 'interrupted':
        return reset(F.SOLO, past.slice(0, 6), 'idle');
      case 'generationFailed': {
        const [a] = turnLines();
        return reset(F.SOLO, [...past, ask, a!, F.generationFailed()], 'generationFailed');
      }
      case 'audioFailed': {
        const [a, b, c] = turnLines();
        reset(F.SOLO, [...past, ask, a!, b!], 'speaking', { kind: 'failed', actionId: b!.id });
        queue = [c!];
        return;
      }
      case 'connecting':
        reset(F.SOLO, [], 'idle');
        return registry.set(connectionAtom, 'connecting');
      case 'reconnecting': {
        const [a] = turnLines();
        reset(F.SOLO, [...past, ask, a!], 'speaking');
        return registry.set(connectionAtom, 'reconnecting');
      }
      case 'superseded':
        reset(F.SOLO, past, 'idle');
        return registry.set(connectionAtom, 'superseded');
      case 'held': {
        const [a, ...rest] = turnLines();
        reset(F.SOLO, [...past, ask, a!], 'speaking', { kind: 'held', actionId: a!.id });
        queue = rest;
        return;
      }
      case 'twoSpeakers': {
        const base = [F.user(F.DUO_QUESTION)];
        const lines = () => F.DUO_LINES.map(([speaker, text]) => F.speak(text, speaker));
        reset(F.DUO, base, 'waiting');
        loop = lines;
        return startTurn(lines());
      }
      case 'longTranscript':
        return reset(F.SOLO, F.longHistory(), 'idle');
    }
  };

  return { load, dispose: halt };
}
