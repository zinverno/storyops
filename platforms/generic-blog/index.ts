import type { PlatformModule } from '../schema.js';
import { genericBlogStrategy } from './strategy.js';

export const genericBlogPlatform: PlatformModule = { strategy: genericBlogStrategy };
