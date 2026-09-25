import { Effect, Schema, Stream } from 'effect';

import { makeActionId, ModelAction, type Speak } from '../actions/index.ts';
import { InvalidAction, MalformedOutput } from './errors.ts';

/**
 * Parses streamed model text into actions as soon as each top-level array element closes.
 *
 * Text before the first `[` (prose or a code fence) is skipped. The stream ends successfully at
 * the matching `]` and stops pulling upstream, so trailing text is never read and an in-flight
 * provider request is cancelled rather than drained. Any element that is not valid JSON, does not
 * match the schema, or names an unknown speaker fails the stream with its index, as does a missing
 * or misplaced separator where an element was expected; actions already emitted stay valid.
 */
export const parseActions = <E, R>(
  text: Stream.Stream<string, E, R>,
  options: { readonly speakerIds: ReadonlySet<string> },
): Stream.Stream<Speak, E | MalformedOutput | InvalidAction, R> =>
  Stream.suspend(() => {
    const scanner = makeScanner();
    const decode = Schema.decodeUnknownEffect(ModelAction);
    return text.pipe(
      Stream.map((chunk) => scanner.push(chunk)),
      Stream.takeUntil((scanned) => scanned.closed),
      Stream.flatMap((scanned) => Stream.fromIterable(scanned.elements)),
      Stream.concat(
        Stream.suspend(() => {
          const reason = scanner.endReason();
          return reason === undefined ? Stream.empty : Stream.fail(new MalformedOutput({ reason }));
        }),
      ),
      Stream.mapEffect(({ index, raw }) =>
        Effect.gen(function* () {
          if (raw === undefined) return yield* new InvalidAction({ index, reason: 'json' });
          const json = yield* Effect.try({
            try: (): unknown => JSON.parse(raw),
            catch: () => new InvalidAction({ index, reason: 'json' }),
          });
          const action = yield* decode(json).pipe(
            Effect.mapError(() => new InvalidAction({ index, reason: 'schema' })),
          );
          if (!options.speakerIds.has(action.speaker)) {
            return yield* new InvalidAction({ index, reason: 'unknown_speaker' });
          }
          return { ...action, id: makeActionId() } satisfies Speak;
        }),
      ),
    );
  });

/** An element's source text, or `undefined` where the array's structure is broken at that index. */
interface RawElement {
  readonly index: number;
  readonly raw: string | undefined;
}

/**
 * Where the scanner is in the top-level array. Separators are validated, so `[,x]`, `[x,]`,
 * `[x,,y]` and `[x y]` fail at the index where an element was expected.
 */
type Phase =
  | 'before' // before the opening `[`
  | 'elementOrClose' // just after `[`
  | 'element' // just after `,`
  | 'inElement'
  | 'separator' // just after an element: `,` or `]`
  | 'closed';

/**
 * A single-pass scanner over the top-level JSON array. It keeps nesting depth and string/escape
 * state across chunks and only buffers the text of the element in progress, so total work is
 * linear in the output.
 */
const makeScanner = () => {
  let phase: Phase = 'before';
  let depth = 0;
  let inString = false;
  let escaped = false;
  let pending = '';
  let nextIndex = 0;

  const push = (
    chunk: string,
  ): { readonly elements: Array<RawElement>; readonly closed: boolean } => {
    const elements: Array<RawElement> = [];
    let start = 0;

    const complete = (end: number, next: Phase) => {
      elements.push({ index: nextIndex++, raw: pending + chunk.slice(start, end) });
      pending = '';
      phase = next;
    };
    const broken = () => {
      elements.push({ index: nextIndex++, raw: undefined });
      phase = 'closed';
    };

    for (let position = 0; position < chunk.length && phase !== 'closed'; position++) {
      const char = chunk[position];
      if (phase === 'before') {
        if (char === '[') phase = 'elementOrClose';
        continue;
      }
      if (phase !== 'inElement') {
        if (isWhitespace(char)) continue;
        if (phase === 'separator') {
          if (char === ',') phase = 'element';
          else if (char === ']') phase = 'closed';
          else broken();
          continue;
        }
        if (char === ']' && phase === 'elementOrClose') {
          phase = 'closed';
          continue;
        }
        if (char === ',' || char === ']') {
          broken();
          continue;
        }
        // The first character of an element; scan it below.
        phase = 'inElement';
        start = position;
        depth = 0;
      }
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') {
        inString = true;
      } else if (char === '{' || char === '[') {
        depth++;
      } else if (char === '}' || char === ']') {
        if (depth === 0) {
          // A scalar element ended by the array's own closing bracket.
          complete(position, 'closed');
        } else if (--depth === 0) {
          complete(position + 1, 'separator');
        }
      } else if (char === ',' && depth === 0) {
        // A scalar element ended by its separator.
        complete(position, 'element');
      }
    }

    if (phase === 'inElement') pending += chunk.slice(start);
    return { elements, closed: phase === 'closed' };
  };

  return {
    push,
    endReason: (): 'no_array' | 'unterminated' | undefined =>
      phase === 'before' ? 'no_array' : phase === 'closed' ? undefined : 'unterminated',
  };
};

const isWhitespace = (char: string | undefined) =>
  char === ' ' || char === '\n' || char === '\r' || char === '\t';
