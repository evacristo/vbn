export type JurisdictionLevel = 'province' | 'department' | 'municipality';
export type ElectionCategory = 'Gobernador' | 'Senadores' | 'Diputados' | 'Intendente' | 'Concejales';
export type EvidenceStatus = 'official' | 'declared' | 'inferred' | 'review';

export interface CandidateSummary {
  personId: string;
  name: string;
  office: string;
  category: ElectionCategory;
  jurisdiction: string;
  order?: number;
  listType?: string;
  sourceUrl?: string;
}

export interface ElectionResultSummary {
  jurisdiction: string;
  level: JurisdictionLevel;
  category: ElectionCategory;
  alliance: string;
  votes: number;
  validVotes: number;
  percentage: number;
  position?: number;
  sourceUrl?: string;
}

export interface TerritorySummary {
  jurisdiction: string;
  level: JurisdictionLevel;
  candidates: CandidateSummary[];
  results: ElectionResultSummary[];
  notes?: string[];
}

export interface RelationshipRecord {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  type: string;
  note?: string;
  sourceUrl?: string;
  evidenceStatus: EvidenceStatus;
  confidence: 1 | 2 | 3 | 4 | 5;
  updatedAt: string;
}

export interface MapFeature {
  id: string;
  name: string;
  level: Exclude<JurisdictionLevel, 'province'>;
  path: string;
  center?: [number, number];
  value?: number | null;
}

export interface WidgetPayload {
  view: 'territory' | 'map' | 'person' | 'graph' | 'search';
  title: string;
  subtitle?: string;
  territory?: TerritorySummary;
  candidates?: CandidateSummary[];
  results?: ElectionResultSummary[];
  features?: MapFeature[];
  relationships?: RelationshipRecord[];
  selectedPersonId?: string;
  selectedJurisdiction?: string;
}
