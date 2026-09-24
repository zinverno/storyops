import type { PlatformModule } from '../schema.js';
import { telegramRenderer } from './renderer.js';
import { telegramStrategy } from './strategy.js';

export const telegramPlatform: PlatformModule = { strategy: telegramStrategy, renderer: telegramRenderer };
