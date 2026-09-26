import type { CoverageLevel } from '../author/coverage.js';
import type { EventType, EvidenceStrength } from '../repo/events.js';
import type { ActivityLevel, SaturationState } from '../topics/saturation.js';
import type { TrendDirection } from '../topics/trends.js';

/**
 * A topic opportunity is a set of separate, inspectable dimensions. There is
 * deliberately no combined score and no rank: the author weighs them.
 */

export type Level = 'low' | 'medium' | 'high';
export type OverlapLevel = 'none' | 'low' | 'medium' | 'high';
export type Quadrant = 'active opportunity' | 'niche' | 'crowded/repetitive' | 'low relevance' | 'unknown platform data';

export interface Dimensions {
  repositoryNovelty: { level: Level; reason: string };
  evidenceStrength: { level: EvidenceStrength | 'none'; reason: string };
  authorOverlap: { level: OverlapLevel; reason: string };
  platformActivity: { level: ActivityLevel; reason: string };
  saturation: { state: SaturationState | 'unknown'; reason: string };
  trendDirection: { direction: TrendDirection | 'unknown'; reason: string };
  technicalSpecificity: { level: Level; reason: string };
  recency: { level: 'recent' | 'this-year' | 'older' | 'unknown'; lastEventAt?: string; days?: number };
}

export interface EventRef {
  id: string;
  type: EventType;
  aspects: EventType[];
  date: string;
  summary: string;
  subsystem?: string;
  strength: EvidenceStrength;
  basis: string;
  evidence: Array<{ kind: string; ref: string; note?: string }>;
}

export interface PublicationRef {
  id: string;
  title: string;
  platform: string;
  date?: string;
  url?: string;
  level?: Exclude<CoverageLevel, 'not-covered'>;
  cosine?: number;
  sharedTerms?: string[];
}

export interface ThemeContext {
  topicId: string;
  label: string;
  relation: 'topic' | 'related';
  state: SaturationState;
  share: number;
  articleCount: number;
  sampleSize: number;
  activity: ActivityLevel;
  trend: TrendDirection;
  because: string[];
  window: { start: string; end: string; days: number };
  exampleArticles: Array<{ id: string; url: string }>;
}

export interface OpportunityCandidate {
  id: string;
  topic: { id: string; label: string; origin: string; specificity: string };
  query?: string;
  repository: { id: string; name: string; events: EventRef[]; firstEventAt?: string; lastEventAt?: string } | null;
  whyTechnicallyInteresting: string[];
  whatChanged: string[];
  author: {
    coverage: CoverageLevel;
    coverageText: string;
    publications: PublicationRef[];
    similar: PublicationRef[];
    alreadyCovered: string[];
    genuinelyNew: string[];
  };
  platform: { id: string; primary: ThemeContext | null; themes: ThemeContext[] } | null;
  patterns: Array<{ patternId: string; observation: string; strength: string; possibleRelevance: string }>;
  dimensions: Dimensions;
  quadrant: Quadrant;
  risks: string[];
  questions: string[];
  unknowns: string[];
  /** Possible directions are descriptive; they are not titles, outlines or copy. */
  possibleDirections: string[];
}

export const OPPORTUNITY_SCHEMA_VERSION = 1;

export interface OpportunityReport {
  schemaVersion: typeof OPPORTUNITY_SCHEMA_VERSION;
  generatedAt: string;
  repository: { id: string; name: string; inspectedAt?: string; head?: string } | null;
  platform: { id: string; runs: number; latestRunAt?: string; windowDays: number } | null;
  author: { publications: number };
  method: string;
  notice: string;
  matrix: Record<Quadrant, string[]>;
  candidates: OpportunityCandidate[];
  limitations: string[];
}
