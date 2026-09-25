import { StoryOpsError } from '../src/shared/errors.js';
import { parseWithSchema } from '../src/shared/fs.js';
import { platformStrategySchema, type PlatformModule } from './schema.js';
import { habrPlatform } from './habr/index.js';
import { mediumPlatform } from './medium/index.js';
import { linkedinPlatform } from './linkedin/index.js';
import { telegramPlatform } from './telegram/index.js';
import { genericBlogPlatform } from './generic-blog/index.js';

export class PlatformRegistry {
  private readonly modules = new Map<string, PlatformModule>();

  /** Validates the strategy against the shared schema before accepting it. */
  register(module: PlatformModule): this {
    const strategy = parseWithSchema(platformStrategySchema, module.strategy, `platform strategy "${module.strategy?.id ?? '?'}"`);
    if (this.modules.has(strategy.id)) throw new StoryOpsError('PLATFORM_DUPLICATE', `Platform "${strategy.id}" is already registered`);
    this.modules.set(strategy.id, { ...module, strategy });
    return this;
  }

  has(id: string): boolean {
    return this.modules.has(id);
  }

  get(id: string): PlatformModule {
    const module = this.modules.get(id);
    if (!module) {
      throw new StoryOpsError('PLATFORM_UNKNOWN', `Unknown platform "${id}"`, { hint: `Registered platforms: ${this.ids().join(', ')}` });
    }
    return module;
  }

  ids(): string[] {
    return [...this.modules.keys()].sort();
  }

  list(): PlatformModule[] {
    return this.ids().map((id) => this.modules.get(id)!);
  }
}

/** Registry with every built-in platform. */
export function createDefaultRegistry(): PlatformRegistry {
  return new PlatformRegistry()
    .register(habrPlatform)
    .register(mediumPlatform)
    .register(linkedinPlatform)
    .register(telegramPlatform)
    .register(genericBlogPlatform);
}
