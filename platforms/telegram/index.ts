import type { PlatformModule } from '../schema.js';
import { telegramStrategy } from './strategy.js';

export const telegramPlatform: PlatformModule = { strategy: telegramStrategy };
