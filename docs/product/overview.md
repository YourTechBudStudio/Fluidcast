# Product overview

## Purpose

Fluidcast provides a voice-and-visual interface for working with existing agents. As agent tasks grow, text-only coordination becomes harder to follow. Fluidcast makes that coordination conversational without replacing the underlying agents, their skills, or their established processes. Its aim is to reduce the cognitive burden of working with agents: dense agent output becomes pieces the user can hear, see, and respond to at their own pace.

The primary experience resembles an interactive podcast player: users listen, see explanations, answer questions, and redirect the conversation while agents work in the background. Visuals initially include Mermaid diagrams, Markdown, and HTML.

## Use cases

- **Brainstorming:** A capable agent advances the thinking one step per turn while Fluidcast walks the user through each step, collects their reactions, and relays them back. This is the lead use case.
- **Agent coordination:** Explain results, discuss decisions, and steer the session's one worker, which can be an existing agent session. A conversation can begin from work an agent has already completed, not only from a fresh user prompt.
- **Curriculum delivery:** Explain prepared learning material that the session's worker holds. This remains a possible layer above the same harness, not a separate architectural requirement.

## Experience principles

- The listener drives: each worker reply is walked through one piece at a time, and nothing moves on until the listener continues.
- Favor fluent, bounded speech segments over long monologues.
- Start background work early when conversational ordering permits, and use progress updates to keep users informed.
- Show dense material in bounded pieces and talk over it, rather than presenting everything at once.
- Ask every question visibly, so it stays in front of the user until answered.
- Preserve player controls: step away, resume, skip forward, and revisit speech.
- Controls govern presentation, never background work: stepping away and interrupting let agents keep working.
- Support multiple speakers and visual explanations without requiring them in every conversation.

See the [interaction model](interaction-model.md) for player controls and recovery expectations.

## Scope

Fluidcast is a set of SDKs. Its reference backend and browser applications demonstrate integration patterns and are not distributed as an application. It is not a replacement coding-agent harness or a hosted application platform.

Applications own their server, transport integration, UI, and audio playback. Libraries should remain dependency-light. Initial usage is browser-focused, with authoritative conversation state on the backend.
