import type { PlatformModule } from '../schema.js';
import { mediumStrategy } from './strategy.js';

export const mediumPlatform: PlatformModule = { strategy: mediumStrategy };
