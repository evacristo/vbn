import type {
  CandidateSummary,
  ElectionCategory,
  ElectionResultSummary,
  JurisdictionLevel,
  MapFeature,
  TerritorySummary,
} from '../shared/contracts.js';

interface CandidateDatabase {
  people?: Array<{ id: string; name: string }>;
  nominations?: Array<{
    personId: string;
    office: string;
    jurisdiction: string;
    level: string;
    roleKey: string;
    order?: number;
    listType?: string;
    sourceUrl?: string;
  }>;
}

interface ResultDatabase {
  results?: Array<{
    jurisdictionType: JurisdictionLevel;
    jurisdiction: string;
    category: ElectionCategory;
    alliance: string;
    votes: number;
    validVotes: number;
    percentageDisplayed: number;
    sourceUrl?: string;
  }>;
  llaResults?: ResultDatabase['results'];
}

interface GeometryRow extends Array<string | [number, number] | undefined> {
  0: string;
  1: string;
  2?: [number, number];
}

const roleCategory: Record<string, ElectionCategory> = {
  governor: 'Gobernador',
  vice_governor: 'Gobernador',
  senator_titular: 'Senadores',
  senator_suplente: 'Senadores',
  deputy_titular: 'Diputados',
  deputy_suplente: 'Diputados',
  mayor: 'Intendente',
  vice_mayor: 'Intendente',
  councillor_titular: 'Concejales',
  councillor_suplente: 'Concejales',
};

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export class TerritorialDataStore {
  private candidates: CandidateDatabase = {};
  private results: ResultDatabase = {};
  private departments: GeometryRow[] = [];
  private municipalities: GeometryRow[] = [];
  private loadedAt = 0;

  constructor(private readonly baseUrl = process.env.DATA_BASE_URL || 'https://evacristo.github.io/vbn') {}

  async ensureLoaded(): Promise<void> {
    if (Date.now() - this.loadedAt < 5 * 60_000 && this.candidates.nominations?.length) return;

    const [candidates, results, departments, municipalities1, municipalities2] = await Promise.all([
      this.fetchJson<CandidateDatabase>('lla-candidates-2025.json'),
      this.fetchJson<ResultDatabase>('election-results-2025.json'),
      this.fetchGeometry('map-departments.js', 'DEPT'),
      this.fetchGeometry('map-municipalities-1.js', 'MUNI1'),
      this.fetchGeometry('map-municipalities-2.js', 'MUNI2'),
    ]);

    this.candidates = candidates;
    this.results = results;
    this.departments = departments;
    this.municipalities = [...municipalities1, ...municipalities2];
    this.loadedAt = Date.now();
  }

  async searchPeople(query: string, limit = 30): Promise<CandidateSummary[]> {
    await this.ensureLoaded();
    const needle = normalize(query);
    const people = new Map((this.candidates.people || []).map((person) => [person.id, person.name]));

    return (this.candidates.nominations || [])
      .filter((row) => {
        const name = people.get(row.personId) || '';
        return [name, row.office, row.jurisdiction].some((value) => normalize(value).includes(needle));
      })
      .slice(0, limit)
      .map((row) => ({
        personId: row.personId,
        name: people.get(row.personId) || row.personId,
        office: row.office,
        category: roleCategory[row.roleKey] || 'Concejales',
        jurisdiction: row.jurisdiction,
        order: row.order,
        listType: row.listType,
        sourceUrl: row.sourceUrl,
      }));
  }

  async getTerritory(level: JurisdictionLevel, jurisdiction: string): Promise<TerritorySummary> {
    await this.ensureLoaded();
    const people = new Map((this.candidates.people || []).map((person) => [person.id, person.name]));
    const wanted = normalize(jurisdiction);

    const candidates = (this.candidates.nominations || [])
      .filter((row) => normalize(row.jurisdiction) === wanted)
      .map<CandidateSummary>((row) => ({
        personId: row.personId,
        name: people.get(row.personId) || row.personId,
        office: row.office,
        category: roleCategory[row.roleKey] || 'Concejales',
        jurisdiction: row.jurisdiction,
        order: row.order,
        listType: row.listType,
        sourceUrl: row.sourceUrl,
      }));

    const allResults = this.results.results || [];
    const selected = allResults.filter((row) => row.jurisdictionType === level && normalize(row.jurisdiction) === wanted);
    const ranks = new Map<string, Map<string, number>>();
    for (const category of new Set(selected.map((row) => row.category))) {
      const ordered = selected.filter((row) => row.category === category).sort((a, b) => b.percentageDisplayed - a.percentageDisplayed || b.votes - a.votes);
      ranks.set(category, new Map(ordered.map((row, index) => [normalize(row.alliance), index + 1])));
    }

    const results = selected.map<ElectionResultSummary>((row) => ({
      jurisdiction: row.jurisdiction,
      level: row.jurisdictionType,
      category: row.category,
      alliance: row.alliance,
      votes: row.votes,
      validVotes: row.validVotes,
      percentage: row.percentageDisplayed,
      position: ranks.get(row.category)?.get(normalize(row.alliance)),
      sourceUrl: row.sourceUrl,
    }));

    return { jurisdiction, level, candidates, results };
  }

  async getMap(level: Exclude<JurisdictionLevel, 'province'>, category: ElectionCategory): Promise<MapFeature[]> {
    await this.ensureLoaded();
    const geometry = level === 'department' ? this.departments : this.municipalities;
    const llaRows = (this.results.llaResults || []).filter((row) => row.jurisdictionType === level && row.category === category);
    const resultByJurisdiction = new Map(llaRows.map((row) => [normalize(row.jurisdiction), row.percentageDisplayed]));

    return geometry.map((row, index) => ({
      id: `${level}-${index}-${normalize(row[0])}`,
      name: row[0],
      level,
      path: row[1],
      center: row[2],
      value: resultByJurisdiction.get(normalize(row[0])) ?? null,
    }));
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'CorrientesTerritorialChatGPTApp/0.1' },
    });
    if (!response.ok) throw new Error(`No se pudo cargar ${path}: HTTP ${response.status}`);
    return await response.json() as T;
  }

  private async fetchGeometry(path: string, variable: string): Promise<GeometryRow[]> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/${path}`, {
      headers: { Accept: 'text/javascript', 'User-Agent': 'CorrientesTerritorialChatGPTApp/0.1' },
    });
    if (!response.ok) throw new Error(`No se pudo cargar ${path}: HTTP ${response.status}`);
    const text = await response.text();
    const match = text.match(new RegExp(`(?:window\\.)?${variable}\\s*=\\s*(\\[[\\s\\S]*\\])\\s*;?`));
    if (!match) throw new Error(`Formato geométrico inválido en ${path}`);
    return JSON.parse(match[1]) as GeometryRow[];
  }
}
