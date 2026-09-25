import type { Action, Speaker } from '../conversation';

export const SOLO: readonly Speaker[] = [{ id: 'host', name: 'Ada' }];
export const DUO: readonly Speaker[] = [
  { id: 'host', name: 'Ada' },
  { id: 'guest', name: 'Theo' },
];

let counter = 0;
export const mockId = () => `mock-${(++counter).toString(36)}`;

export const user = (text: string): Action => ({ type: 'user_message', id: mockId(), text });
export const speak = (text: string, speaker = 'host'): Extract<Action, { type: 'speak' }> => ({
  type: 'speak',
  id: mockId(),
  speaker,
  text,
});
export const interrupted = (): Action => ({ type: 'interrupted', id: mockId() });
export const generationFailed = (): Action => ({
  type: 'generation_failed',
  id: mockId(),
  error: { tag: 'ProviderError', message: 'The model provider rate-limited the request.' },
});

export const SAMPLE_QUESTION = 'What happens if the connection drops mid-sentence?';

/** The lines a scripted turn speaks. */
export const TURN_LINES = [
  'Short version: the cursor only moves when the audio actually finishes.',
  'So if your connection drops mid-sentence, we pick up right where you left off.',
  'And if you cut in, I stop there and drop whatever I had queued up.',
];

export const DUO_QUESTION = 'Can you two explain how playback works?';
export const DUO_LINES: readonly (readonly [string, string])[] = [
  ['host', 'Great question. Theo, you built the playback side, want to take it?'],
  ['guest', 'Sure. Every line waits for its audio to finish before the next one starts.'],
  ['host', 'Which is why interrupting feels instant: nothing else is committed yet.'],
];

/** Three finished turns: a complete answer, an interrupted one, and a short one. */
export const history = (): Action[] => [
  user('How does Fluidcast decide when to move on to the next line?'),
  speak('Short version: the cursor only moves when the audio actually finishes.'),
  speak('That way nothing gets ahead of what you have actually heard.'),
  user('What happens if I cut in?'),
  speak('Then I stop right there, drop whatever I’d queued up, and'),
  interrupted(),
  user('Sorry, go on. What about failures?'),
  speak('Failures are the fun part. Anything I already said stays said.'),
];

/** Many turns, to check scrolling and auto-scroll. */
export const longHistory = (): Action[] =>
  Array.from({ length: 8 }, (_, i) => [
    user(`Question ${i + 1}: and what about the part after that?`),
    speak('Good one. The short answer is that every line is its own action in the log.'),
    speak('The cursor walks that log, and playback is what moves it forward.'),
  ]).flat();
