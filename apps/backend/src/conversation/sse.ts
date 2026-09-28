import { Duration, Stream } from 'effect';
import { HttpServerResponse } from 'effect/unstable/http';

import { heartbeatIntervalMillis } from '@fluidcast/app-contract';

/**
 * A Server-Sent Events response in the app contract's framing: each string becomes one event with
 * a single `data:` line, and a heartbeat comment is sent periodically. The response ends when
 * `messages` ends; when the client goes away the server interrupts it.
 */
export const sseResponse = <E>(messages: Stream.Stream<string, E>) => {
  const heartbeat = Stream.tick(Duration.millis(heartbeatIntervalMillis)).pipe(
    Stream.drop(1),
    Stream.as(': heartbeat\n\n'),
  );
  const body = messages.pipe(
    Stream.map((message) => `data: ${message}\n\n`),
    Stream.merge(heartbeat, { haltStrategy: 'left' }),
    Stream.encodeText,
  );
  return HttpServerResponse.stream(body, {
    contentType: 'text/event-stream',
    headers: { 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
  });
};
