import type { PlatformModule } from '../schema.js';
import { linkedinStrategy } from './strategy.js';

export const linkedinPlatform: PlatformModule = { strategy: linkedinStrategy };
