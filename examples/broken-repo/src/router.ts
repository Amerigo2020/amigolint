import { health } from './health.js';

export function routeRequest(path: string): string {
  return path === '/health' ? health() : 'not found';
}
