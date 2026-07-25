import { useEffect, useMemo, useState } from 'react';
import type { MapFeature, WidgetPayload } from '../../shared/contracts.js';
import './styles.css';

const fallbackPayload: WidgetPayload = {
  view: 'search',
  title: 'Corrientes Territorial',
  subtitle: 'Pedí un municipio, una persona o una categoría electoral desde el chat.',
  candidates: [],
  results: [],
  features: [],
  relationships: [],
};

function readInitialPayload(): WidgetPayload {
  return window.openai?.toolOutput ?? fallbackPayload;
}

function percentageColor(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return 'var(--map-empty)';
  const ratio = Math.max(0, Math.min(1, value / 35));
  const lightness = 92 - ratio * 48;
  return `hsl(273 53% ${lightness}%)`;
}

function MapView({ features }: { features: MapFeature[] }) {
  const [selected, setSelected] = useState<MapFeature | null>(null);

  if (!features.length) {
    return <div className="empty-state">El mapa aparecerá cuando abras un territorio o una categoría desde el chat.</div>;
  }

  return (
    <div className="map-card">
      <svg viewBox="0 0 900 560" role="img" aria-label="Mapa político de Corrientes">
        <rect width="900" height="560" className="map-background" />
        {features.map((feature) => (
          <path
            key={feature.id}
            d={feature.path}
            fill={percentageColor(feature.value)}
            className={selected?.id === feature.id ? 'map-feature selected' : 'map-feature'}
            onClick={() => setSelected(feature)}
          >
            <title>{feature.name}{feature.value != null ? ` · ${feature.value.toFixed(2)}%` : ''}</title>
          </path>
        ))}
      </svg>
      <div className="map-detail" aria-live="polite">
        <strong>{selected?.name ?? 'Tocá un territorio'}</strong>
        <span>{selected?.value != null ? `LLA ${selected.value.toFixed(2)}%` : selected ? 'Sin resultado para esta categoría' : 'El detalle aparecerá acá.'}</span>
      </div>
    </div>
  );
}

export default function App() {
  const [payload, setPayload] = useState<WidgetPayload>(readInitialPayload);
  const [tab, setTab] = useState<'summary' | 'map' | 'people' | 'relations'>(payload.features?.length ? 'map' : 'summary');

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message?.method !== 'ui/notifications/tool-result') return;
      const next = message?.params?.structuredContent as WidgetPayload | undefined;
      if (next?.view) setPayload(next);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const theme = window.openai?.theme;
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  }, []);

  const title = payload.selectedJurisdiction || payload.title;
  const results = payload.results ?? payload.territory?.results ?? [];
  const candidates = payload.candidates ?? payload.territory?.candidates ?? [];
  const features = payload.features ?? [];
  const relationships = payload.relationships ?? [];

  const leadingResult = useMemo(() => {
    return [...results].sort((a, b) => b.percentage - a.percentage)[0];
  }, [results]);

  async function requestFullscreen() {
    await window.openai?.requestDisplayMode?.('fullscreen');
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">INTELIGENCIA TERRITORIAL</span>
          <h1>{title}</h1>
          <p>{payload.subtitle ?? 'Corrientes · candidaturas, resultados y relaciones'}</p>
        </div>
        <button className="icon-button" type="button" onClick={requestFullscreen} aria-label="Abrir en pantalla completa">↗</button>
      </header>

      <section className="content" aria-live="polite">
        {tab === 'summary' && (
          <div className="stack">
            <div className="kpi-grid">
              <article><span>Candidaturas</span><strong>{candidates.length}</strong></article>
              <article><span>Resultados</span><strong>{results.length}</strong></article>
              <article><span>Relaciones</span><strong>{relationships.length}</strong></article>
              <article><span>Mejor resultado</span><strong>{leadingResult ? `${leadingResult.percentage.toFixed(2)}%` : '—'}</strong></article>
            </div>
            <div className="panel">
              <h2>Operación móvil</h2>
              <p>Usá el chat para pedir una persona, un municipio, una categoría o una relación. El widget mantiene la vista táctil y el servidor conserva los datos.</p>
              <div className="quick-actions">
                <button type="button" onClick={() => window.openai?.sendFollowUpMessage?.('Abrí el mapa de resultados de LLA por municipio.')}>Mapa municipal</button>
                <button type="button" onClick={() => window.openai?.sendFollowUpMessage?.('Buscá candidatos de LLA por nombre o cargo.')}>Buscar personas</button>
              </div>
            </div>
          </div>
        )}

        {tab === 'map' && <MapView features={features} />}

        {tab === 'people' && (
          <div className="list">
            {candidates.length ? candidates.map((candidate) => (
              <article className="list-row" key={`${candidate.personId}-${candidate.office}-${candidate.jurisdiction}`}>
                <div>
                  <strong>{candidate.name}</strong>
                  <span>{candidate.office} · {candidate.jurisdiction}</span>
                </div>
                <button type="button" onClick={() => window.openai?.sendFollowUpMessage?.(`Abrí la ficha completa de ${candidate.name}.`)}>Abrir</button>
              </article>
            )) : <div className="empty-state">No hay candidaturas en esta vista.</div>}
          </div>
        )}

        {tab === 'relations' && (
          <div className="list">
            {relationships.length ? relationships.map((relationship) => (
              <article className="list-row" key={relationship.id}>
                <div>
                  <strong>{relationship.type}</strong>
                  <span>{relationship.evidenceStatus} · confianza {relationship.confidence}/5</span>
                </div>
              </article>
            )) : <div className="empty-state">Todavía no hay relaciones cargadas para esta vista.</div>}
          </div>
        )}
      </section>

      <nav className="bottom-nav" aria-label="Navegación del widget">
        <button className={tab === 'summary' ? 'active' : ''} type="button" onClick={() => setTab('summary')}>Resumen</button>
        <button className={tab === 'map' ? 'active' : ''} type="button" onClick={() => setTab('map')}>Mapa</button>
        <button className={tab === 'people' ? 'active' : ''} type="button" onClick={() => setTab('people')}>Personas</button>
        <button className={tab === 'relations' ? 'active' : ''} type="button" onClick={() => setTab('relations')}>Red</button>
      </nav>
    </main>
  );
}
