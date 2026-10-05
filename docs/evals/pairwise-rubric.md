# Pairwise comparison of two walkthroughs

Read the first section of judge-rubric.md ("What Fluidcast is for", "What you get", "What to ignore"): the same job applies. You see one worker reply and two walkthroughs of it, X and Y, produced by different prompts. The `LISTENER` lines are scripted; ignore their content.

Decide which walkthrough the listener (a tired developer who would otherwise read the reply) would rather get, weighing in this order:

1. **Fidelity**: every point and every worker question reaches the listener without distortion or invented content. A worker's offer or invitation ('I can also…', 'want me to…', 'say the word if…') is a worker question: putting it to the listener is not an invented question, and showing it only before a Continue loses it. A walkthrough that loses a core point or a question, distorts something, or adds its own decisions loses unless the other is as bad or worse.
2. **Cognitive burden**: one idea at a time, compressed and well-structured screens, speech that orients instead of reading the screen.
3. **Speed**: gets the listener to understanding with less listening and fewer needless steps.
4. **Engagement**: feels like a sharp colleague talking you through it.

Ignore order of presentation (X is not better for being first), personality fillers, and the length of the transcript as such: judge what the listener experiences.

Write exactly this JSON to the path you were given:

```json
{
  "winner": "X",
  "strength": 2,
  "fidelity": "same",
  "why": "one or two sentences naming the deciding difference"
}
```

`winner`: `X`, `Y` or `tie`. `strength`: 1 slight, 2 clear, 3 decisive. `fidelity`: which one is more faithful (`X`, `Y` or `same`).
