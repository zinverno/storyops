import type { PlatformModule } from '../schema.js';
import { habrResearch } from './research.js';
import { habrStrategy } from './strategy.js';

export const habrPlatform: PlatformModule = { strategy: habrStrategy, research: habrResearch };
