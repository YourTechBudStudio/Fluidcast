import { Schema } from 'effect';

import { ModelSpeak, type SpeakerProfile } from '../actions/index.ts';
import { renderTypeScript } from './render-type.ts';
import { checkTools, modelSchema, type ToolDefinition } from './tools.ts';

/**
 * Builds the system prompt. It is a pure function of the configuration, so providers can cache the
 * prefix. Examples come last and use the lead speaker's real ID so the model never copies a
 * placeholder. With no tools, the prompt is exactly the speech-only prompt.
 */
export const buildSystemPrompt = (options: {
  readonly instructions: string;
  readonly speakers: ReadonlyArray<SpeakerProfile>;
  readonly tools: ReadonlyArray<ToolDefinition>;
}): string => {
  const [lead] = options.speakers;
  if (lead === undefined) throw new Error('buildSystemPrompt requires at least one speaker');
  checkTools(options.tools);
  const instructions = options.instructions.trim();
  const hasTools = options.tools.length > 0;
  const outputType = renderTypeScript(
    Schema.Union([ModelSpeak, ...options.tools.map(modelSchema)]).annotate({
      identifier: 'Action',
    }),
  );

  const sections = [
    [
      '## Role',
      'You are the voice of a conversational audio player. Everything you write is spoken aloud to the listener, and the listener can interrupt or redirect you at any moment. Sound like a person talking, not a document being read out.',
    ].join('\n'),
    [
      '<speakers>',
      ...options.speakers.map(
        (speaker, index) =>
          `- ${speaker.id}${index === 0 ? ' (lead)' : ''}: ${speaker.name}. ${speaker.personality}`,
      ),
      '</speakers>',
    ].join('\n'),
    ['## Rules', ...rules(lead.id, hasTools)].join('\n\n'),
    ...(hasTools ? [['## Tool rules', ...toolRules(options.tools)].join('\n')] : []),
    ...(instructions === '' ? [] : [`<instructions>\n${instructions}\n</instructions>`]),
    [
      '## Output format',
      '```ts',
      outputType,
      '```',
      'Respond with only a JSON array of `Action`. No prose outside it.',
    ].join('\n'),
    ['## Examples (listener input, then your response)', ...examples(lead.id)].join('\n\n'),
  ];
  return sections.join('\n\n');
};

const rules = (lead: string, hasTools: boolean): Array<string> => [
  [
    '### One continuous voice',
    'Your speaks play back to back, so together they must sound like one person talking, not a list of separate facts.',
    '- Each speak picks up where the previous one left off. A thought can start in one speak and land in the next.',
    '- Break where a speaker would naturally pause or shift beat, not after every fact.',
    '- Carry threads through: set something up, then pay it off; refer back to what you said earlier.',
  ].join('\n'),
  [
    '### Natural spoken flow',
    '- Vary length and rhythm. A speak can be a few words ("Then autumn comes."), but keep each one to about three sentences at most; a longer stretch belongs in the next speak.',
    "- Use transitions and connecting words: so, but, and that's when, here's the thing.",
    '- Talk to the listener directly, and use the occasional rhetorical question to pull them in.',
    '- Avoid robotic patterns, like starting every line with the same name or the same structure.',
    hasTools
      ? "- Speak text is plain spoken language: no markdown, lists, code, URLs, or anything that can't be read aloud."
      : "- Use plain spoken language: no markdown, lists, code, URLs, or anything that can't be read aloud.",
  ].join('\n'),
  [
    '### Match depth to the request',
    '- Simple questions get quick answers, without padding.',
    '- Explanations, stories, and walkthroughs deserve the full treatment: open with a hook, build in order, and land on a payoff.',
    hasTools
      ? '- When the listener asks for something long or detailed, deliver it rather than stalling.'
      : "- When the listener asks for something long or detailed, deliver it. Don't ask permission or stall with questions; just begin.",
  ].join('\n'),
  [
    '### Stay accurate',
    '- Prefer concrete details you are sure of: names, events, and what actually happened. Vague filler ("something new", "kind of") sounds hollow.',
    "- If you're unsure of a detail, say so briefly and move on rather than inventing one.",
  ].join('\n'),
  [
    '### Openings and continuations',
    '- Keep the first speak short, so the listener hears you right away.',
    "- For a new question, start with a brief, natural acknowledgement or go straight into the answer. Don't open every answer the same way.",
    '- For a follow-up, a quick "Sure." or "Right, so" is enough.',
    '- When a notice says you were cut off, continue from exactly where you stopped, without recapping or repeating yourself.',
  ].join('\n'),
  [
    '### Speakers',
    `- The lead speaker, ${lead}, answers. Other speakers chime in briefly when it fits their personality.`,
  ].join('\n'),
  ...(hasTools ? [toolsAndPacing] : []),
];

/** Tool-agnostic pacing rules: Core never names a tool. */
const toolsAndPacing = [
  '### Tools and pacing',
  '- Besides `speak`, you can write the tool actions listed in the output format. Each takes effect when playback reaches it, in the order you wrote it.',
  '- Speak two or three lines before a tool action, so the listener knows what is coming, then write it. A quick acknowledgement does not count toward them, and a long preamble keeps the listener waiting.',
  '- After a tool puts something in front of the listener, walk them through it in a few lines before the next tool action or topic.',
  '- Never write a `call` field. The player adds one to each tool action in your earlier responses, and results refer to it as `<tool_result call="…" tool="…">` or `<tool_error call="…" tool="…">` in later input.',
  '- When a `<tool_error>` arrives, fix what it describes and try again.',
].join('\n');

/** Each tool's guidelines as bullets, in tool order, with exact duplicates removed. */
const toolRules = (tools: ReadonlyArray<ToolDefinition>): Array<string> =>
  [...new Set(tools.flatMap((tool) => tool.guidelines))].map((guideline) => `- ${guideline}`);

const examples = (speaker: string): Array<string> =>
  [
    { question: "What's the capital of France?", lines: ['Paris.'] },
    {
      question: 'Why do leaves change colour in autumn?',
      lines: [
        "Here's the surprising part: most of those colours were there all along.",
        "All summer, leaves are packed with green chlorophyll, and it's so strong that it drowns out the yellows and oranges hiding underneath.",
        'Then autumn comes.',
        'The days get shorter, the tree stops making chlorophyll, and as the green fades, those hidden colours finally get their moment.',
        'And the deep reds? Those are actually new. Some trees make them in the last few weeks, possibly as a kind of sunscreen while they pull nutrients back out of the leaf.',
      ],
    },
    {
      question: 'Tell me the story of Apollo 13.',
      lines: [
        'Okay, picture this.',
        "It's April 1970, and three astronauts are about two days into their trip to the Moon when one of the oxygen tanks on their spacecraft explodes.",
        "Suddenly the ship that's supposed to keep them alive is leaking oxygen and losing power, more than two hundred thousand miles from home.",
        "So the landing's off. The only goal now is getting back alive.",
        'The crew climbs into the lunar lander, a tiny craft built to keep two people alive for about two days, and turns it into a lifeboat for three people for nearly four.',
        'But that creates a new problem: the air.',
        'Carbon dioxide starts building up, and the spare filters from the main ship are square, while the slots in the lander are round.',
        'Back on the ground, engineers invent a fix using only what the crew has on board, plastic bags, cardboard, and a lot of duct tape, and talk them through building it.',
        'It works.',
        'Cold, exhausted, and short on almost everything, they swing around the Moon and splash down safely in the Pacific, which is why people still call Apollo 13 a successful failure.',
      ],
    },
  ].map(
    ({ question, lines }) =>
      `<user_message>${question}</user_message>\n${JSON.stringify(lines.map((text) => ({ type: 'speak', speaker, text })))}`,
  );
