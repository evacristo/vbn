(() => {
  'use strict';

  const db = window.LLA_CANDIDATES_2025;
  if (!db || !Array.isArray(db.people) || !Array.isArray(db.nominations)) return;

  const people = new Map(db.people.map(person => [person.id, person]));
  const nominationsByPerson = new Map();
  for (const nomination of db.nominations) {
    if (!nominationsByPerson.has(nomination.personId)) nominationsByPerson.set(nomination.personId, []);
    nominationsByPerson.get(nomination.personId).push(nomination);
  }

  const customRelationsKey = 'corrientes-ti-custom-relations-v1';
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const relationLabels = {
    referente_de: 'Referente de',
    responde_a: 'Responde a',
    aliado_de: 'Aliado/a de',
    equipo_de: 'Integra el equipo de',
    formula_con: 'Integra fórmula con',
    vinculo_politico: 'Vínculo político con',
    otro: 'Otro vínculo',
  };

  function loadCustomRelations() {
    try {
      const parsed = JSON.parse(localStorage.getItem(customRelationsKey) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveCustomRelations(rows) {
    localStorage.setItem(customRelationsKey, JSON.stringify(rows));
  }

  function ensureInterface() {
    const nav = document.querySelector('nav');
    const app = document.querySelector('.app');
    if (!nav || !app) return null;

    let button = nav.querySelector('[data-view="network"]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.view = 'network';
      button.textContent = 'Red LLA';
      nav.appendChild(button);
    }

    let section = document.getElementById('network');
    if (!section) {
      section = document.createElement('section');
      section.id = 'network';
      section.innerHTML = `
        <div class="cards network-metrics" id="networkMetrics"></div>
        <div class="panel">
          <div class="network-heading">
            <div>
              <h2>Red de candidaturas LLA · Corrientes 2025</h2>
              <p class="detail">Estructura por nivel, poder, jurisdicción y orden de lista. No presume subordinación personal.</p>
            </div>
            <span class="pill">Fuente electoral oficial</span>
          </div>
          <div class="network-toolbar">
            <div class="field"><label for="networkJurisdiction">Jurisdicción</label><select id="networkJurisdiction"></select></div>
            <div class="field"><label for="networkOffice">Cargo</label><select id="networkOffice"></select></div>
            <div class="field"><label for="networkSearch">Buscar persona</label><input id="networkSearch" type="search" placeholder="Nombre o alias"></div>
          </div>
          <div class="network-coverage" id="networkCoverage"></div>
        </div>
        <div id="networkResults"></div>
        <div class="panel network-detail hidden" id="networkDetail" aria-live="polite"></div>
      `;
      app.appendChild(section);
    }

    button.addEventListener('click', () => {
      document.querySelectorAll('nav button, section').forEach(element => element.classList.remove('active'));
      button.classList.add('active');
      section.classList.add('active');
      renderNetwork();
    });
    return section;
  }

  function fillFilters() {
    const jurisdiction = document.getElementById('networkJurisdiction');
    const office = document.getElementById('networkOffice');
    if (!jurisdiction || !office || jurisdiction.dataset.ready) return;

    const jurisdictions = [...new Set(db.nominations.map(row => row.jurisdiction))].sort((a, b) => a.localeCompare(b, 'es'));
    jurisdiction.innerHTML = '<option value="">Todas</option>' + jurisdictions.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');

    const offices = [...new Set(db.nominations.map(row => row.office))].sort((a, b) => a.localeCompare(b, 'es'));
    office.innerHTML = '<option value="">Todos</option>' + offices.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');

    jurisdiction.dataset.ready = '1';
    jurisdiction.addEventListener('change', renderNetwork);
    office.addEventListener('change', renderNetwork);
    document.getElementById('networkSearch')?.addEventListener('input', renderNetwork);
  }

  function renderMetrics() {
    const element = document.getElementById('networkMetrics');
    if (!element) return;
    const municipalLists = db.coverage.filter(row => row.hasOfficialLLAList).length;
    element.innerHTML = `
      <div class="card"><span>Personas incorporadas</span><strong>${db.people.length}</strong></div>
      <div class="card"><span>Candidaturas oficializadas</span><strong>${db.nominations.length}</strong></div>
      <div class="card"><span>Municipios con lista LLA</span><strong>${municipalLists}</strong></div>
    `;
  }

  function nominationSort(a, b) {
    const branchOrder = ['Ejecutivo provincial', 'Legislatura provincial · Senado', 'Legislatura provincial · Diputados', 'Ejecutivo municipal', 'Concejo Deliberante'];
    return branchOrder.indexOf(a.branch) - branchOrder.indexOf(b.branch)
      || (a.order || 99) - (b.order || 99)
      || people.get(a.personId)?.name.localeCompare(people.get(b.personId)?.name || '', 'es');
  }

  function renderNetwork() {
    fillFilters();
    renderMetrics();

    const selectedJurisdiction = document.getElementById('networkJurisdiction')?.value || '';
    const selectedOffice = document.getElementById('networkOffice')?.value || '';
    const search = normalize(document.getElementById('networkSearch')?.value || '');
    const filtered = db.nominations.filter(row => {
      const person = people.get(row.personId);
      const searchable = normalize([person?.name, person?.officialName, ...(person?.aliases || [])].join(' '));
      return (!selectedJurisdiction || row.jurisdiction === selectedJurisdiction)
        && (!selectedOffice || row.office === selectedOffice)
        && (!search || searchable.includes(search));
    }).sort(nominationSort);

    const coverage = document.getElementById('networkCoverage');
    if (coverage) {
      if (selectedJurisdiction) {
        const row = db.coverage.find(item => item.jurisdiction === selectedJurisdiction);
        coverage.innerHTML = row
          ? `<span class="network-status ${row.hasOfficialLLAList ? 'has-list' : 'no-list'}">${row.hasOfficialLLAList ? `${row.candidateCount} candidaturas LLA encontradas` : 'No se encontró lista LLA en la resolución municipal oficial'}</span>`
          : '<span class="network-status has-list">Categoría provincial</span>';
      } else {
        const noList = db.coverage.filter(row => !row.hasOfficialLLAList).length;
        coverage.innerHTML = `<span class="network-status has-list">${db.coverage.length} municipios revisados</span><span class="network-status no-list">${noList} sin lista LLA oficial encontrada</span>`;
      }
    }

    const grouped = new Map();
    for (const nomination of filtered) {
      const key = `${nomination.jurisdiction}|||${nomination.branch}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(nomination);
    }

    const results = document.getElementById('networkResults');
    if (!results) return;
    if (!filtered.length) {
      results.innerHTML = '<div class="panel"><p class="detail">No hay candidaturas que coincidan con estos filtros.</p></div>';
      return;
    }

    results.innerHTML = [...grouped.entries()].map(([key, rows]) => {
      const [jurisdiction, branch] = key.split('|||');
      return `
        <div class="panel network-group">
          <div class="network-group-title"><div><h3>${escapeHtml(jurisdiction)}</h3><span>${escapeHtml(branch)}</span></div><strong>${rows.length}</strong></div>
          <div class="network-list">
            ${rows.map(row => {
              const person = people.get(row.personId);
              const order = row.order ? `N.º ${row.order}` : 'Sin orden';
              const aliases = person?.aliases?.length ? `<small>Alias: ${escapeHtml(person.aliases.join(', '))}</small>` : '';
              return `
                <button type="button" class="network-person" data-person-id="${escapeHtml(row.personId)}">
                  <span class="network-person-main"><strong>${escapeHtml(person?.name || row.personId)}</strong>${aliases}</span>
                  <span class="network-person-meta"><b>${escapeHtml(row.office)}</b><small>${escapeHtml(order)} · ${escapeHtml(row.listType)}</small></span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    results.querySelectorAll('[data-person-id]').forEach(button => button.addEventListener('click', () => renderPerson(button.dataset.personId)));
  }

  function relationSummary(personId) {
    const official = db.relationships.filter(row => row.from === personId || row.to === personId);
    const custom = loadCustomRelations().filter(row => row.from === personId || row.to === personId);
    return {official, custom};
  }

  function renderPerson(personId) {
    const person = people.get(personId);
    const detail = document.getElementById('networkDetail');
    if (!person || !detail) return;
    const nominations = (nominationsByPerson.get(personId) || []).slice().sort(nominationSort);
    const relations = relationSummary(personId);
    const formulaLinks = relations.official.filter(row => row.type === 'integra_formula_con').map(row => {
      const otherId = row.from === personId ? row.to : row.from;
      return people.get(otherId)?.name;
    }).filter(Boolean);

    const targets = db.people.filter(row => row.id !== personId).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    detail.classList.remove('hidden');
    detail.innerHTML = `
      <div class="network-detail-head">
        <div><span class="pill">Ficha de persona</span><h2>${escapeHtml(person.name)}</h2>${person.aliases?.length ? `<p class="detail">Alias: ${escapeHtml(person.aliases.join(', '))}</p>` : ''}</div>
        <button type="button" class="network-close" id="networkClose">Cerrar</button>
      </div>
      <h3>Candidaturas oficiales</h3>
      <div class="network-nominations">
        ${nominations.map(row => `<article><strong>${escapeHtml(row.office)}</strong><span>${escapeHtml(row.jurisdiction)} · ${row.order ? `orden ${row.order}` : 'sin orden'} · ${escapeHtml(row.listType)}</span><a href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="noopener">Ver resolución oficial</a></article>`).join('')}
      </div>
      ${formulaLinks.length ? `<div class="network-callout"><strong>Fórmula electoral</strong><span>${escapeHtml(formulaLinks.join(', '))}</span></div>` : ''}
      <h3>Relaciones agregadas en este dispositivo</h3>
      <div class="network-relations" id="networkCustomRelations">
        ${relations.custom.length ? relations.custom.map(row => {
          const outgoing = row.from === personId;
          const other = people.get(outgoing ? row.to : row.from);
          return `<div class="network-relation"><span>${outgoing ? escapeHtml(relationLabels[row.type] || row.type) : 'Vínculo inverso'}: <strong>${escapeHtml(other?.name || 'Persona')}</strong>${row.note ? ` · ${escapeHtml(row.note)}` : ''}</span><button type="button" data-delete-relation="${escapeHtml(row.id)}">Eliminar</button></div>`;
        }).join('') : '<p class="detail">Todavía no agregaste relaciones propias para esta persona.</p>'}
      </div>
      <div class="network-relation-form">
        <div class="field"><label for="relationTarget">Relacionar con</label><select id="relationTarget">${targets.map(row => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="relationType">Tipo de relación</label><select id="relationType">${Object.entries(relationLabels).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('')}</select></div>
        <div class="field"><label for="relationNote">Nota</label><input id="relationNote" type="text" placeholder="Contexto o evidencia"></div>
        <button type="button" class="network-save" id="relationSave">Guardar relación</button>
      </div>
      <p class="detail network-source-note">Las relaciones que agregues se guardan únicamente en este teléfono. La base oficial no infiere dependencia o jerarquía entre personas.</p>
    `;

    detail.scrollIntoView({behavior: 'smooth', block: 'start'});
    document.getElementById('networkClose')?.addEventListener('click', () => detail.classList.add('hidden'));
    document.getElementById('relationSave')?.addEventListener('click', () => {
      const target = document.getElementById('relationTarget')?.value;
      const type = document.getElementById('relationType')?.value;
      const note = document.getElementById('relationNote')?.value.trim() || '';
      if (!target || !type) return;
      const rows = loadCustomRelations();
      rows.push({id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`, from: personId, to: target, type, note, createdAt: new Date().toISOString()});
      saveCustomRelations(rows);
      renderPerson(personId);
    });
    detail.querySelectorAll('[data-delete-relation]').forEach(button => button.addEventListener('click', () => {
      const rows = loadCustomRelations().filter(row => row.id !== button.dataset.deleteRelation);
      saveCustomRelations(rows);
      renderPerson(personId);
    }));
  }

  function enhanceMap() {
    const svg = document.getElementById('mapSvg');
    if (!svg || svg.dataset.candidateEnhanced) return;
    svg.dataset.candidateEnhanced = '1';
    svg.addEventListener('click', event => {
      const territory = event.target.closest?.('.territory');
      if (!territory) return;
      const name = territory.dataset.name;
      const rows = db.nominations.filter(row => row.level === 'municipal' && normalize(row.jurisdiction) === normalize(name));
      if (!rows.length) return;
      const summary = rows.sort(nominationSort).slice(0, 8).map(row => `${row.office}: ${people.get(row.personId)?.name || ''}`).join(' · ');
      setTimeout(() => {
        const mapDetail = document.getElementById('mapDetail');
        if (mapDetail) mapDetail.innerHTML += `<br><strong>Candidaturas LLA 2025:</strong> ${escapeHtml(summary)}${rows.length > 8 ? ` · +${rows.length - 8} concejales/suplentes` : ''}`;
      }, 0);
    });
  }

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = 'network-lla.css?v=1';
  document.head.appendChild(stylesheet);
  ensureInterface();
  enhanceMap();
})();
