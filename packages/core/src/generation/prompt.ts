import { ModelAction, type SpeakerProfile } from '../actions/index.ts';
import { renderTypeScript } from './render-type.ts';

const outputType = renderTypeScript(ModelAction);

/**
 * Builds the system prompt. It is deterministic for a given configuration, so providers can cache
 * the prefix. Examples come last and use the lead speaker's real ID so the model never copies a
 * placeholder.
 */
export const buildSystemPrompt = (options: {
  readonly instructions: string;
  readonly speakers: ReadonlyArray<SpeakerProfile>;
}): string => {
  const [lead] = options.speakers;
  if (lead === undefined) throw new Error('buildSystemPrompt requires at least one speaker');
  const instructions = options.instructions.trim();

  const sections = [
    'You are the voice of a conversational audio player. Everything you write is spoken aloud to the listener, one line at a time, and the listener can interrupt or redirect you at any moment.',
    [
      '<speakers>',
      ...options.speakers.map(
        (speaker, index) =>
          `- ${speaker.id}${index === 0 ? ' (lead)' : ''}: ${speaker.name}. ${speaker.personality}`,
      ),
      '</speakers>',
    ].join('\n'),
    [
      'How to speak:',
      '- Each speak is one or two sentences.',
      '- Keep the first speak short, so the listener hears you right away.',
      "- Use plain spoken language: no markdown, lists, code, URLs, or anything that can't be read aloud.",
      '- Answer simple questions quickly, without padding.',
      `- The lead speaker, ${lead.id}, answers.`,
    ].join('\n'),
    ...(instructions === '' ? [] : [`<instructions>\n${instructions}\n</instructions>`]),
    [
      'Output format:',
      '```ts',
      outputType,
      '```',
      'Respond with only a JSON array of `Action`. No prose outside it.',
    ].join('\n'),
    ['Examples (listener input, then your response):', ...examples(lead.id)].join('\n\n'),
  ];
  return sections.join('\n\n');
};

const examples = (speaker: string): Array<string> =>
  [
    { question: "What's the capital of France?", lines: ['Paris.'] },
    {
      question: 'Why do leaves change colour in autumn?',
      lines: [
        'Mostly because the green is fading, not because new colours appear.',
        'As the days shorten, trees stop making chlorophyll, and the yellows and oranges that were there all along finally show through.',
      ],
    },
  ].map(
    ({ question, lines }) =>
      `<user_message>${question}</user_message>\n${JSON.stringify(lines.map((text) => ({ type: 'speak', speaker, text })))}`,
  );
