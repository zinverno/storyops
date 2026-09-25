/**
 * Built-in topic taxonomy: a small, deterministic baseline for recognising
 * what platform articles and publications are about. Every topic is a label
 * plus aliases (Russian and English surface forms). Matching is lexical
 * (stems, phrases, hubs, tags); nothing here is a semantic model.
 *
 * Project-specific topics come from the configuration (`topics`, and each
 * project's `glossary`), and may point at built-in topics through `related`.
 * Clustering with embeddings is deliberately out of scope.
 *
 * specificity:
 *   generic    – broad framing that many unrelated articles share ("AI in general")
 *   technology – a concrete technology or technique
 *   practice   – an engineering practice or article kind
 *   project    – a concept specific to one of the author's projects (config only)
 */

export type TopicSpecificity = 'generic' | 'technology' | 'practice' | 'project';

export interface TopicDefinition {
  id: string;
  label: string;
  aliases: string[];
  parent?: string;
  /** Built-in topics that give platform context for a project topic. */
  related?: string[];
  /** Hub or tag slugs that indicate the topic on a platform. */
  hubs?: string[];
  specificity: TopicSpecificity;
}

export const BUILTIN_TOPICS: readonly TopicDefinition[] = [
  {
    id: 'ai-generic',
    label: 'AI / LLM (general framing)',
    aliases: ['ии', 'ai', 'llm', 'llms', 'gpt', 'chatgpt', 'нейросеть', 'нейросети', 'нейронка', 'нейронные сети', 'искусственный интеллект', 'artificial intelligence', 'generative ai', 'genai', 'claude', 'gemini', 'copilot'],
    hubs: ['artificial_intelligence', 'machine_learning', 'natural_language_processing'],
    specificity: 'generic',
  },
  { id: 'ai-agents', label: 'AI agents', parent: 'ai-generic', aliases: ['ai agent', 'ai agents', 'ии агент', 'ии агенты', 'llm agent', 'агентные системы', 'agentic', 'мультиагентные', 'multi-agent'], specificity: 'technology' },
  { id: 'ai-coding-assistants', label: 'AI coding assistants', parent: 'ai-generic', aliases: ['ии ассистент', 'ии ассистенты', 'ai assistant', 'coding assistant', 'ассистент для программиста', 'copilot', 'cursor'], specificity: 'technology' },
  { id: 'rag', label: 'RAG', parent: 'ai-generic', aliases: ['rag', 'retrieval augmented', 'retrieval-augmented'], specificity: 'technology' },
  { id: 'semantic-search', label: 'Semantic search / embeddings', aliases: ['семантический поиск', 'semantic search', 'embedding', 'embeddings', 'эмбеддинг', 'эмбеддинги', 'векторный поиск', 'vector search', 'векторная база', 'vector database'], specificity: 'technology' },
  { id: 'databases', label: 'Databases and storage', aliases: ['postgresql', 'postgres', 'mysql', 'sqlite', 'база данных', 'базы данных', 'database', 'субд', 'clickhouse', 'redis', 'хранилище данных'], hubs: ['postgresql', 'sql', 'databases', 'mysql', 'sqlite'], specificity: 'technology' },
  { id: 'full-text-search', label: 'Search engines', aliases: ['elasticsearch', 'opensearch', 'полнотекстовый поиск', 'full-text search', 'поисковый движок', 'search engine'], specificity: 'technology' },
  { id: 'performance', label: 'Performance', aliases: ['производительность', 'оптимизация', 'profiling', 'профилировщик', 'утечка памяти', 'memory leak', 'latency', 'throughput', 'бенчмарк', 'benchmark', 'время сборки'], hubs: ['high_performance'], specificity: 'practice' },
  { id: 'incidents', label: 'Incidents and postmortems', aliases: ['инцидент', 'постмортем', 'postmortem', 'outage', 'авария', 'разбор'], specificity: 'practice' },
  { id: 'architecture', label: 'Software architecture', aliases: ['архитектура', 'architecture', 'микросервисы', 'microservices', 'монолит', 'monolith', 'event sourcing', 'cqrs', 'как устроен'], hubs: ['architecture'], specificity: 'practice' },
  { id: 'migration', label: 'Migrations', aliases: ['миграция', 'migration', 'перенесли', 'переезд', 'переход на'], specificity: 'practice' },
  { id: 'testing', label: 'Testing', aliases: ['тестирование', 'тесты', 'testing', 'tdd', 'unit test', 'e2e'], hubs: ['testing'], specificity: 'practice' },
  { id: 'devops', label: 'DevOps, CI/CD and build', aliases: ['devops', 'ci cd', 'kubernetes', 'k8s', 'docker', 'монорепозиторий', 'monorepo', 'сборка', 'пайплайн'], hubs: ['devops', 'kubernetes', 'docker'], specificity: 'practice' },
  { id: 'security', label: 'Security', aliases: ['безопасность', 'уязвимость', 'security', 'vulnerability', 'cve', 'xss'], hubs: ['infosecurity'], specificity: 'practice' },
  { id: 'observability', label: 'Observability', aliases: ['мониторинг', 'observability', 'логирование', 'tracing', 'трейсинг'], hubs: ['monitoring'], specificity: 'practice' },
  { id: 'knowledge-management', label: 'Notes and knowledge management', aliases: ['obsidian', 'база знаний', 'knowledge base', 'заметки', 'заметок', 'zettelkasten', 'pkm', 'граф заметок'], specificity: 'technology' },
  { id: 'pet-projects', label: 'Pet projects', aliases: ['pet проект', 'pet project', 'side project', 'свой проект'], specificity: 'generic' },
  { id: 'tool-roundups', label: 'Tool roundups and overviews', aliases: ['обзор', 'подборка', 'обзор возможностей', 'roundup', 'overview', 'топ инструментов'], specificity: 'generic' },
  { id: 'future-of-tech', label: 'Opinion on the future of technology', aliases: ['будущее', 'что нас ждёт', 'что нас ждет', 'мысли после', 'future of', 'меняет разработку'], specificity: 'generic' },
  { id: 'programming-languages', label: 'Programming languages', aliases: ['golang', 'typescript', 'javascript', 'python', 'rust', 'java', 'kotlin'], hubs: ['go', 'typescript', 'javascript', 'python', 'rust', 'java'], specificity: 'technology' },
  { id: 'career', label: 'Career and hiring', aliases: ['карьера', 'собеседование', 'джун', 'junior', 'senior', 'hiring', 'найм'], hubs: ['career'], specificity: 'generic' },
];
