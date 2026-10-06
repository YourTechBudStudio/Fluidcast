import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import { mockRoutes } from '../mocks';
import { App } from './App';

/**
 * The page's routes. `/` is still today's player; `/mocks` holds throwaway, presentation-only mocks for issue #5 and is
 * removed once the mode screen and session routes are implemented.
 */
const router = createBrowserRouter([
  { path: '/', element: <App /> },
  { path: '/mocks', children: mockRoutes },
]);

export function Root() {
  return <RouterProvider router={router} />;
}
