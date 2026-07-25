(() => {
  'use strict';

  const data = window.CORRIENTES_DEFINITIVE_RESULTS_2025;
  const candidates = window.LLA_CANDIDATES_2025;
  if (!data || !Array.isArray(data.results) || !Array.isArray(data.llaResults)) return;

  const categoryByRole = {
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
  const categoryLabels = {
    Gobernador: 'Gobernador y vicegobernador',
    Senadores: 'Senadores provinciales',
    Diputados: 'Diputados provinciales',
    Intendente: 'Intendente y viceintendente',
    Concejales: 'Concejales',
  };
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const number = value => Number(value || 0).toLocaleString('es-AR');
  const percent = value => `${Number(value || 0).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}%`;
  const levelForNomination = nomination => nomination.level === 'provincial' ? 'province' : 'municipality';
  const resultKey = (level, jurisdiction, category) => `${level}|${normalize(jurisdiction)}|${normalize(category)}`;
  const getLLA = (level, jurisdiction, category) => data.llaIndex?.[resultKey(level, jurisdiction, category)] || null;
  const getNominationResult = nomination => getLLA(levelForNomination(nomination), nomination.jurisdiction, categoryByRole[nomination.roleKey]);
  const people = new Map((candidates?.people || []).map(person => [person.id, person]));
  const nominationsByPerson = new Map();
  for (const nomination of candidates?.nominations || []) {
    if (!nominationsByPerson.has(nomination.personId)) nominationsByPerson.set(nomination.personId, []);
    nominationsByPerson.get(nomination.personId).push(nomination);
  }

  function rankFor(result) {
    if (!result) return null;
    const rows = data.results
      .filter(row => row.jurisdictionType === result.jurisdictionType && normalize(row.jurisdiction) === normalize(result.jurisdiction) && row.category === result.category)
      .sort((a, b) => b.percentage - a.percentage || b.votes - a.votes);
    const position = rows.findIndex(row => normalize(row.alliance) === 'LA LIBERTAD AVANZA') + 1;
    return {position, total: rows.length, leader: rows[0] || null, rows};
  }

  function resultBadge(result, compact = false) {
    if (!result) return '<span class="result-audit-missing">Sin resultado LLA para esta categoría</span>';
    const rank = rankFor(result);
    const title = compact ? 'Lista LLA' : 'Resultado definitivo de la lista LLA';
    return `<span class="result-audit-badge" title="El porcentaje pertenece a la lista o fórmula, no a la persona">
      <strong>${title}: ${percent(result.percentageDisplayed)}</strong>
      <small>${number(result.votes)} votos · ${number(result.validVotes)} válidos${rank?.position ? ` · posición ${rank.position}/${rank.total}` : ''}</small>
    </span>`;
  }

  function resultForText(personId, office, jurisdiction) {
    const rows = nominationsByPerson.get(personId) || [];
    return rows.find(row => normalize(row.office) === normalize(office) && normalize(row.jurisdiction) === normalize(jurisdiction)) || null;
  }

  function clarifyNationalResult() {
    const firstCard = document.querySelector('#summary .card span');
    if (firstCard) firstCard.textContent = 'Lista 501 · Diputados nacionales 2025';
    const nationalCandidatePanel = [...document.querySelectorAll('#elections .panel')].find(panel => /Candidatos LLA/i.test(panel.querySelector('h2')?.textContent || ''));
    if (nationalCandidatePanel && !nationalCandidatePanel.querySelector('.result-audit-note')) {
      const note = document.createElement('p');
      note.className = 'detail result-audit-note';
      note.innerHTML = '<strong>Aclaración:</strong> el 32,67% corresponde a la Lista 501 en toda la provincia. No es un porcentaje individual de cada candidato.';
      nationalCandidatePanel.querySelector('h2')?.insertAdjacentElement('afterend', note);
    }
  }

  function officialRows(level, category) {
    const rows = {};
    for (const result of data.llaResults) {
      if (result.jurisdictionType === level && result.category === category) rows[normalize(result.jurisdiction).toLowerCase()] = result.percentageDisplayed;
    }
    return rows;
  }

  function installOfficialMapResults() {
    const contest = document.getElementById('contest');
    const level = document.getElementById('level');
    if (!contest || !level || typeof results === 'undefined' || typeof state === 'undefined') return;

    const definitions = [
      ['2025-governor', 'Gobernador', 'Provinciales 2025 · Gobernador'],
      ['2025-senators', 'Senadores', 'Provinciales 2025 · Senadores'],
      ['2025-deputies-provincial', 'Diputados', 'Provinciales 2025 · Diputados'],
      ['2025-mayor', 'Intendente', 'Municipales 2025 · Intendente'],
      ['2025-councillors', 'Concejales', 'Municipales 2025 · Concejales'],
    ];
    contest.innerHTML = definitions.map(([value, , label]) => `<option value="${value}">${label}</option>`).join('');

    for (const [value, category] of definitions) {
      results[value] = {
        category,
        source: 'official-definitive-2025',
        rowsByType: {
          department: officialRows('department', category),
          municipality: officialRows('municipality', category),
        },
        type: 'department',
        rows: {},
      };
    }

    function sync(eventValue) {
      const contestValue = eventValue || contest.value || '2025-governor';
      const territoryType = level.value === 'departments' ? 'department' : 'municipality';
      const current = results[contestValue];
      if (!current) return;
      current.type = territoryType;
      current.rows = current.rowsByType[territoryType] || {};
    }

    level.addEventListener('change', () => sync(contest.value), true);
    contest.addEventListener('change', event => sync(event.target.value), true);
    contest.value = '2025-governor';
    state.contest = '2025-governor';
    sync('2025-governor');
    try { draw(); } catch (_) {}
  }

  function enhanceIntelligenceDrawer() {
    const drawer = document.getElementById('intelDrawer');
    if (!drawer || drawer.classList.contains('hidden')) return;
    const personName = drawer.querySelector('.intel-drawer-head h2')?.textContent?.trim();
    const person = [...people.values()].find(row => row.name === personName);
    if (!person) return;
    const nominationList = drawer.querySelector('h3.intel-section-title + .intel-list');
    if (!nominationList) return;
    for (const article of nominationList.querySelectorAll('article.intel-row')) {
      if (article.dataset.resultEnhanced) continue;
      const office = article.querySelector('strong')?.textContent?.trim() || '';
      const jurisdiction = (article.querySelector('.intel-muted')?.textContent || '').split('·')[0].trim();
      const nomination = resultForText(person.id, office, jurisdiction);
      if (!nomination) continue;
      article.querySelector('.intel-row-main')?.insertAdjacentHTML('beforeend', resultBadge(getNominationResult(nomination), true));
      article.dataset.resultEnhanced = '1';
    }
  }

  function enhanceNetworkDetail() {
    const detail = document.getElementById('networkDetail');
    if (!detail || detail.classList.contains('hidden')) return;
    const personName = detail.querySelector('.network-detail-head h2')?.textContent?.trim();
    const person = [...people.values()].find(row => row.name === personName);
    if (!person) return;
    for (const article of detail.querySelectorAll('.network-nominations article')) {
      if (article.dataset.resultEnhanced) continue;
      const office = article.querySelector('strong')?.textContent?.trim() || '';
      const jurisdiction = (article.querySelector('span')?.textContent || '').split('·')[0].trim();
      const nomination = resultForText(person.id, office, jurisdiction);
      if (!nomination) continue;
      article.insertAdjacentHTML('beforeend', resultBadge(getNominationResult(nomination), true));
      article.dataset.resultEnhanced = '1';
    }
  }

  function enhanceNetworkList() {
    for (const group of document.querySelectorAll('#networkResults .network-group')) {
      const jurisdiction = group.querySelector('h3')?.textContent?.trim() || '';
      for (const button of group.querySelectorAll('.network-person')) {
        if (button.dataset.resultEnhanced) continue;
        const office = button.querySelector('.network-person-meta b')?.textContent?.trim() || '';
        const nomination = resultForText(button.dataset.personId, office, jurisdiction);
        if (!nomination) continue;
        button.querySelector('.network-person-meta')?.insertAdjacentHTML('beforeend', resultBadge(getNominationResult(nomination), true));
        button.dataset.resultEnhanced = '1';
      }
    }
  }

  function enhanceTerritoryProfile() {
    const jurisdiction = document.getElementById('territorySelect')?.value || '';
    for (const officeCard of document.querySelectorAll('#territoryContent .intel-office')) {
      if (officeCard.dataset.resultEnhanced) continue;
      const office = officeCard.querySelector('h4')?.textContent?.trim() || '';
      const nomination = (candidates?.nominations || []).find(row => normalize(row.jurisdiction) === normalize(jurisdiction) && normalize(row.office) === normalize(office));
      if (!nomination) continue;
      officeCard.querySelector('h4')?.insertAdjacentHTML('afterend', resultBadge(getNominationResult(nomination), true));
      officeCard.dataset.resultEnhanced = '1';
    }
    const header = document.querySelector('#territoryContent .intel-territory-header');
    if (header && !header.dataset.resultSummary) {
      const categories = ['Gobernador','Senadores','Diputados','Intendente','Concejales'];
      const cards = categories.map(category => getLLA('municipality', jurisdiction, category)).filter(Boolean);
      if (cards.length) {
        header.insertAdjacentHTML('afterend', `<div class="result-audit-category-grid">${cards.map(result => `<article><span>${escapeHtml(categoryLabels[result.category] || result.category)}</span><strong>${percent(result.percentageDisplayed)}</strong><small>${number(result.votes)} votos</small></article>`).join('')}</div>`);
      }
      header.dataset.resultSummary = '1';
    }
  }

  function enhanceMapClick() {
    const svg = document.getElementById('mapSvg');
    if (!svg || svg.dataset.officialResultBound) return;
    svg.dataset.officialResultBound = '1';
    svg.addEventListener('click', event => {
      const territory = event.target.closest?.('.territory');
      if (!territory) return;
      setTimeout(() => {
        const level = document.getElementById('level')?.value === 'departments' ? 'department' : 'municipality';
        const category = results?.[state?.contest]?.category;
        const result = category ? getLLA(level, territory.dataset.name, category) : null;
        const detail = document.getElementById('mapDetail');
        if (detail && result) {
          const rank = rankFor(result);
          detail.innerHTML = `<strong>${escapeHtml(territory.dataset.name)}</strong><br>${resultBadge(result)}
            <br><a href="${escapeHtml(result.sourceUrl)}" target="_blank" rel="noopener">Abrir escrutinio definitivo</a>
            ${rank?.leader && normalize(rank.leader.alliance) !== 'LA LIBERTAD AVANZA' ? `<br><small>Lideró ${escapeHtml(rank.leader.alliance)} con ${percent(rank.leader.percentageDisplayed)}.</small>` : ''}`;
        }
      }, 0);
    });
  }

  const resultsSectionHtml = `
    <div class="panel">
      <div class="result-audit-heading"><div><h2>Resultados definitivos · Corrientes 2025</h2><p class="detail">Cada porcentaje pertenece a una lista o fórmula dentro de una categoría y jurisdicción. No representa un rendimiento individual de cada integrante.</p></div><span class="pill">Fuente oficial</span></div>
      <div class="result-audit-toolbar">
        <div class="field"><label for="officialResultLevel">Nivel</label><select id="officialResultLevel"><option value="province">Provincia</option><option value="department">Departamento</option><option value="municipality">Municipio</option></select></div>
        <div class="field"><label for="officialResultJurisdiction">Jurisdicción</label><select id="officialResultJurisdiction"></select></div>
        <div class="field"><label for="officialResultCategory">Categoría</label><select id="officialResultCategory"></select></div>
      </div>
    </div>
    <div id="officialResultContent"></div>`;

  function ensureResultsSection() {
    const nav = document.querySelector('nav');
    const app = document.querySelector('.app');
    if (!nav || !app) return;
    let button = nav.querySelector('[data-view="official-results"]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.view = 'official-results';
      button.textContent = 'Resultados';
      nav.appendChild(button);
    }
    let section = document.getElementById('official-results');
    if (!section) {
      section = document.createElement('section');
      section.id = 'official-results';
      section.innerHTML = resultsSectionHtml;
      app.appendChild(section);
    }
    if (!button.dataset.bound) {
      button.dataset.bound = '1';
      button.addEventListener('click', () => {
        document.querySelectorAll('nav button, section').forEach(node => node.classList.remove('active'));
        button.classList.add('active');
        section.classList.add('active');
        initializeResultFilters();
        renderOfficialResults();
      });
    }
  }

  function availableJurisdictions(level) {
    return data.jurisdictions
      .filter(row => row.jurisdictionType === level)
      .map(row => row.jurisdiction)
      .sort((a, b) => a.localeCompare(b, 'es'));
  }

  function availableCategories(level, jurisdiction) {
    const preferred = ['Gobernador','Senadores','Diputados','Intendente','Concejales'];
    const found = new Set(data.results.filter(row => row.jurisdictionType === level && normalize(row.jurisdiction) === normalize(jurisdiction)).map(row => row.category));
    return preferred.filter(category => found.has(category));
  }

  function initializeResultFilters() {
    const level = document.getElementById('officialResultLevel');
    const jurisdiction = document.getElementById('officialResultJurisdiction');
    const category = document.getElementById('officialResultCategory');
    if (!level || !jurisdiction || !category) return;

    function fillJurisdictions() {
      const values = availableJurisdictions(level.value);
      jurisdiction.innerHTML = values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
      if (level.value === 'province') jurisdiction.value = 'Provincia de Corrientes';
      fillCategories();
    }
    function fillCategories() {
      const values = availableCategories(level.value, jurisdiction.value);
      category.innerHTML = values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(categoryLabels[value] || value)}</option>`).join('');
      renderOfficialResults();
    }

    if (!level.dataset.bound) {
      level.dataset.bound = '1';
      level.addEventListener('change', fillJurisdictions);
      jurisdiction.addEventListener('change', fillCategories);
      category.addEventListener('change', renderOfficialResults);
    }
    if (!jurisdiction.options.length) fillJurisdictions();
  }

  function renderOfficialResults() {
    const level = document.getElementById('officialResultLevel')?.value || 'province';
    const jurisdiction = document.getElementById('officialResultJurisdiction')?.value || 'Provincia de Corrientes';
    const category = document.getElementById('officialResultCategory')?.value || 'Gobernador';
    const target = document.getElementById('officialResultContent');
    if (!target) return;
    const rows = data.results
      .filter(row => row.jurisdictionType === level && normalize(row.jurisdiction) === normalize(jurisdiction) && row.category === category)
      .sort((a, b) => b.percentage - a.percentage || b.votes - a.votes);
    const lla = rows.find(row => normalize(row.alliance) === 'LA LIBERTAD AVANZA');
    const rank = lla ? rows.indexOf(lla) + 1 : null;
    const leader = rows[0];
    target.innerHTML = `
      <div class="panel">
        <div class="result-audit-heading"><div><h2>${escapeHtml(jurisdiction)}</h2><p class="detail">${escapeHtml(categoryLabels[category] || category)} · escrutinio definitivo</p></div>${lla ? resultBadge(lla) : '<span class="result-audit-missing">LLA no presentó lista en esta categoría</span>'}</div>
        <div class="result-audit-kpis">
          <article><span>Votos LLA</span><strong>${lla ? number(lla.votes) : '—'}</strong></article>
          <article><span>Porcentaje de lista</span><strong>${lla ? percent(lla.percentageDisplayed) : '—'}</strong></article>
          <article><span>Posición</span><strong>${rank ? `${rank} de ${rows.length}` : '—'}</strong></article>
          <article><span>Votos válidos</span><strong>${lla ? number(lla.validVotes) : number(leader?.validVotes)}</strong></article>
        </div>
      </div>
      <div class="panel">
        <h3>Clasificación por lista o alianza</h3>
        <div class="result-audit-table-wrap"><table class="table result-audit-table"><thead><tr><th>Pos.</th><th>Lista o alianza</th><th>Votos</th><th>Porcentaje</th></tr></thead><tbody>
          ${rows.map((row, index) => `<tr class="${normalize(row.alliance) === 'LA LIBERTAD AVANZA' ? 'is-lla' : ''}"><td>${index + 1}</td><td>${escapeHtml(row.alliance)}</td><td>${number(row.votes)}</td><td><strong>${percent(row.percentageDisplayed)}</strong></td></tr>`).join('')}
        </tbody></table></div>
        ${leader?.sourceUrl ? `<p class="detail"><a href="${escapeHtml(leader.sourceUrl)}" target="_blank" rel="noopener">Consultar el escrutinio oficial de esta jurisdicción</a></p>` : ''}
      </div>`;
  }

  function scanEnhancements() {
    clarifyNationalResult();
    enhanceIntelligenceDrawer();
    enhanceNetworkDetail();
    enhanceNetworkList();
    enhanceTerritoryProfile();
  }

  clarifyNationalResult();
  installOfficialMapResults();
  ensureResultsSection();
  enhanceMapClick();
  scanEnhancements();
  const observer = new MutationObserver(() => scanEnhancements());
  observer.observe(document.body, {subtree: true, childList: true});
  window.CorrientesOfficialResults = {data, getLLA, getNominationResult, rankFor};
})();