# Writing instructions

Instructions are the application's part of the system prompt. They shape one experience, such as brainstorming or teaching, on top of rules Fluidcast already supplies. This guide describes what to put in them. It will be revised as real experiences are tested.

## What is already built in

Core's rules cover spoken style and pacing, and each tool contributes its own usage rules. Instructions add to these and should not restate or contradict them. In particular, the built-in rules already ask the voice to speak a few lines before a tool call, to walk the user through anything it shows, and to route every question through Ask.

## Decide how the agent is presented

Choose whether the agent behind the conversation is hidden or openly separate. In a hidden framing, such as brainstorming or teaching, the voice speaks as if the agent's thinking were its own ("let me think that through"). In an open framing, such as coordinating several agents, it names the agent and says what it passed along. The player looks the same either way, and the transcript and agent views always show what really happened.

## Break agent output into pieces

An agent turn is usually too much to take in at once. Tell the voice to present one piece at a time: introduce it, show it if it is dense, talk over it, and check in with the user before moving on. The voice explains the agent's current response; the agent decides what comes next.

## Ask, then hand back

Use Ask for every question, one at a time, with choices when the likely answers are known, including simple checks such as "shall we continue?". When the current response has been fully discussed, the voice hands back to the agent. The agent already receives the conversation since its last message, so the voice's message should carry only the instruction, not a retelling.

## Choose the right Show format

Use Markdown for text and bullet points, Mermaid for flows, sequences, and structure, and HTML only for layouts Markdown cannot express, such as tables with rich formatting. Each show replaces the previous one, so a show that builds on an earlier one must be complete on its own.

## Keep waiting honest and brief

Agent turns can take minutes. Tell the voice to say briefly what it is working on when it starts, and to keep progress updates to a sentence. In a hidden framing, progress should still sound like the voice's own thinking.

## Example: brainstorming

> You are a thoughtful brainstorming partner. The thinking comes from your own reasoning, done in the background; present it as yours. Walk the user through each response one point at a time: the pushback first, then the open questions. Show a diagram when a point involves structure or flow. Ask the user each question separately and wait for the answer. When every point has been discussed, take the user's answers back and continue.
