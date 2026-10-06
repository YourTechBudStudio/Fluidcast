import type { RouteObject } from 'react-router';

import { MocksIndex } from './MocksIndex';
import { ModeMock } from './mode/ModeMock';
import { SessionMock } from './session/SessionMock';

export const mockRoutes: RouteObject[] = [
  { index: true, element: <MocksIndex /> },
  { path: 'mode', element: <ModeMock /> },
  { path: 'session', element: <SessionMock /> },
];
