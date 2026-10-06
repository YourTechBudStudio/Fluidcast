import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SessionStatus } from '@fluidcast/app-contract';

import { routeFor } from './route';

const noSession = Option.some<SessionStatus>({ _tag: 'NoSession' });
const active = (id: string) => Option.some<SessionStatus>({ _tag: 'Active', id });

describe('routeFor', () => {
  it('waits for the first status', () => {
    expect(routeFor(Option.none(), '/')).toEqual({ _tag: 'Connecting' });
    expect(routeFor(Option.none(), '/session/a')).toEqual({ _tag: 'Connecting' });
  });

  it('renders the mode screen with no session, and redirects any other path to it', () => {
    expect(routeFor(noSession, '/')).toEqual({ _tag: 'Render' });
    expect(routeFor(noSession, '/session/a')).toEqual({ _tag: 'Redirect', to: '/' });
    expect(routeFor(noSession, '/nowhere')).toEqual({ _tag: 'Redirect', to: '/' });
  });

  it("renders the live session's player, and redirects every other path to it", () => {
    expect(routeFor(active('a'), '/session/a')).toEqual({ _tag: 'Render' });
    expect(routeFor(active('a'), '/')).toEqual({ _tag: 'Redirect', to: '/session/a' });
    expect(routeFor(active('a'), '/session/b')).toEqual({ _tag: 'Redirect', to: '/session/a' });
    expect(routeFor(active('a'), '/nowhere')).toEqual({ _tag: 'Redirect', to: '/session/a' });
  });

  it('encodes an ID with reserved characters', () => {
    expect(routeFor(active('a/b c'), '/')).toEqual({
      _tag: 'Redirect',
      to: '/session/a%2Fb%20c',
    });
    expect(routeFor(active('a/b c'), '/session/a%2Fb%20c')).toEqual({ _tag: 'Render' });
  });
});
