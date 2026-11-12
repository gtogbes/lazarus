import { loaders } from 'virtual:lazarus/program-sources';
import type { ProgramSource } from './types';

// One promise per program, so React's `use` sees a stable promise across renders.
const cache = new Map<string, Promise<ProgramSource>>();

/** Loads a program's pre-highlighted sources (a separate chunk per program). */
export function loadProgramSource(id: string): Promise<ProgramSource> {
  let promise = cache.get(id);
  if (!promise) {
    const load = loaders[id];
    promise = load ? load().then((module) => module.default) : Promise.reject(new Error(`No sources for ${id}`));
    cache.set(id, promise);
  }
  return promise;
}
