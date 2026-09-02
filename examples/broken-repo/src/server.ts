import { routeRequest } from './router.js';

export function createServer(): { listen(port: number): void } {
  return {
    listen(port) {
      console.log(`Demo server listening on ${port}`);
      routeRequest('/health');
    },
  };
}
