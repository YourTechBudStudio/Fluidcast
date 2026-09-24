# Product overview

## Purpose

Fluidcast provides a voice-and-visual interface for working with existing agents. As agent tasks grow, text-only coordination becomes harder to follow. Fluidcast makes that coordination conversational without replacing the underlying agents, their skills, or their established processes.

The primary experience resembles an interactive podcast player: users listen, see explanations, answer questions, and redirect the conversation while agents work in the background. Visuals initially include Mermaid diagrams, Markdown, and HTML.

## Use cases

- **Agent coordination:** Explain results, discuss decisions, and delegate work to existing or newly created agent sessions. A conversation can begin from work an agent has already completed, not only from a fresh user prompt.
- **Curriculum delivery:** Explain prepared learning material, potentially without a backing coding agent. This remains a possible layer above the same harness, not a separate architectural requirement.

## Experience principles

- Favor fluent, bounded speech segments over long monologues.
- Start background work early when conversational ordering permits, and use progress updates to keep users informed.
- Preserve player controls: pause, resume, skip forward, and revisit speech.
- Distinguish **pause**, which lets background work continue, from **interrupt**, which redirects the conversation and cancels unfinished tool calls.
- Support multiple speakers and visual explanations without requiring them in every conversation.

See the [interaction model](interaction-model.md) for player controls and recovery expectations.

## Scope

Fluidcast is a set of SDKs, with a reference browser application for exercising the experience. It is not a replacement coding-agent harness or a hosted application platform.

Applications own their server, transport integration, UI, and audio playback. Libraries should remain dependency-light. Initial usage is browser-focused, with authoritative conversation state on the backend.
