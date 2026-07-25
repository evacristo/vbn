(() => {
  'use strict';

  const db = window.LLA_CANDIDATES_2025;
  if (!db || !Array.isArray(db.people) || !Array.isArray(db.nominations)) return;

  const APP_VERSION = 'intelligence-suite-v1';
  const STORE_KEY = 'corrientes-ti-intelligence-v1';
  const CUSTOM_RELATIONS_KEY = 'corrientes-ti-custom-relations-v1';
  const people = new Map(db.people.map(person => [person.id, person]));
  const organizations = new Map((db.organizations || []).map(org => [org.id, org]));
  const nominationsByPerson = new Map();
  const nominationsByJurisdiction = new Map();

  for (const nomination of db.nominations) {
    if (!nominationsByPerson.has(nomination.personId)) nominationsByPerson.set(nomination.personId, []);
    nominationsByPerson.get(nomination.personId).push(nomination);
    if (!nominationsByJurisdiction.has(nomination.jurisdiction)) nominationsByJurisdiction.set(nomination.jurisdiction, []);
    nominationsByJurisdiction.get(nomination.jurisdiction).push(nomination);
  }

  const evidenceLabels = {
    official: 'Oficial',
    declared: 'Declarada',
    inferred: 'Inferida',
    review: 'En revisión',
  };

  const relationLabels = {
    referente_de: 'Referente de',
    responde_a: 'Responde a',
    aliado_de: 'Aliado/a de',
    equipo_de: 'Integra equipo de',
    formula_con: 'Integra fórmula con',
    vinculo_politico: 'Vínculo político con',
    familiar_de: 'Vínculo familiar con',
    profesional_de: 'Vínculo profesional con',
    otro: 'Otro vínculo',
  };

  const branchRank = {
    'Ejecutivo provincial': 0,
    'Legislatura provincial · Senado': 1,
    'Legislatura provincial · Diputados': 2,
    'Ejecutivo municipal': 3,
    'Concejo Deliberante': 4,
  };

  const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const nowIso = () => new Date().toISOString();
  const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const safeDate = value => {
    const date = value ? new Date(`${value}T12:00:00`) : null;
    return date && !Number.isNaN(date.getTime()) ? date : new Date(0);
  };
  const formatDate = value => {
    if (!value) return 'Sin fecha';
    const date = safeDate(value);
    return date.toLocaleDateString('es-AR', {year: 'numeric', month: 'short', day: '2-digit'});
  };

  function initialStore() {
    return {
      schemaVersion: 1,
      appVersion: APP_VERSION,
      personProfiles: {},
      territoryProfiles: {},
      sources: [],
      events: [],
      relationMetadata: {},
      audit: [],
      settings: {lastJurisdiction: ''},
    };
  }

  function loadStore() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      return stored && typeof stored === 'object'
        ? {...initialStore(), ...stored}
        : initialStore();
    } catch (_) {
      return initialStore();
    }
  }

  let store = loadStore();

  function persist(action, entityType = '', entityId = '', detail = '') {
    if (action) {
      store.audit.unshift({
        id: uid('audit'),
        at: nowIso(),
        action,
        entityType,
        entityId,
        detail,
      });
      store.audit = store.audit.slice(0, 250);
    }
    store.appVersion = APP_VERSION;
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }

  function readCustomRelations() {
    try {
      const rows = JSON.parse(localStorage.getItem(CUSTOM_RELATIONS_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }

  function writeCustomRelations(rows, action = 'Relación actualizada') {
    localStorage.setItem(CUSTOM_RELATIONS_KEY, JSON.stringify(rows));
    persist(action, 'relationship', '', `${rows.length} relaciones locales`);
  }

  function toast(message) {
    let node = document.getElementById('intelToast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'intelToast';
      node.className = 'intel-toast hidden';
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.add('hidden'), 2300);
  }

  function activateSection(sectionId, button) {
    document.querySelectorAll('nav button, section').forEach(element => element.classList.remove('active'));
    if (button) button.classList.add('active');
    document.getElementById(sectionId)?.classList.add('active');
    window.scrollTo({top: 0, behavior: 'smooth'});
  }

  function addNavSection(id, label, html, onOpen) {
    const nav = document.querySelector('nav');
    const app = document.querySelector('.app');
    if (!nav || !app) return null;
    let button = nav.querySelector(`[data-view="${id}"]`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.view = id;
      button.textContent = label;
      nav.appendChild(button);
    }
    let section = document.getElementById(id);
    if (!section) {
      section = document.createElement('section');
      section.id = id;
      section.innerHTML = html;
      app.appendChild(section);
    }
    if (!button.dataset.intelBound) {
      button.dataset.intelBound = '1';
      button.addEventListener('click', () => {
        activateSection(id, button);
        onOpen?.();
      });
    }
    return {button, section};
  }

  function optionHtml(values, selected = '', allLabel = 'Todas') {
    return `<option value="">${escapeHtml(allLabel)}</option>` + values.map(value =>
      `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`
    ).join('');
  }

  function evidenceBadge(status = 'review', confidence = 3) {
    const safeStatus = evidenceLabels[status] ? status : 'review';
    const confidenceLabel = confidence >= 4 ? 'Alta' : confidence >= 3 ? 'Media' : 'Baja';
    return `<span class="intel-badge ${safeStatus}">${evidenceLabels[safeStatus]}</span><span class="intel-badge ${confidence <= 2 ? 'low' : ''}">Confianza ${confidenceLabel}</span>`;
  }

  function officialEvents() {
    return db.nominations.map(row => ({
      id: `official-${row.id}`,
      date: row.electionDate,
      title: `Candidatura oficializada: ${row.office}`,
      description: `${row.jurisdiction} · orden ${row.order || 's/d'} · ${row.listType}`,
      personId: row.personId,
      jurisdiction: row.jurisdiction,
      sourceUrl: row.sourceUrl,
      evidenceStatus: 'official',
      confidence: 5,
      immutable: true,
      type: 'candidatura',
    }));
  }

  function allEvents() {
    return [...officialEvents(), ...(store.events || [])];
  }

  function personName(personId) {
    return people.get(personId)?.name || personId || 'Persona';
  }

  function nominationSort(a, b) {
    return (branchRank[a.branch] ?? 99) - (branchRank[b.branch] ?? 99)
      || (a.order || 99) - (b.order || 99)
      || personName(a.personId).localeCompare(personName(b.personId), 'es');
  }

  function getPersonProfile(personId) {
    return store.personProfiles[personId] || {
      currentRole: '',
      previousRoles: '',
      partyOrigin: '',
      publicProfiles: '',
      territoryReference: '',
      tags: '',
      notes: '',
      evidenceStatus: 'review',
      confidence: 3,
      updatedAt: '',
    };
  }

  function getTerritoryProfile(jurisdiction) {
    return store.territoryProfiles[jurisdiction] || {
      evaluation: 'sin_evaluar',
      priority: 3,
      currentAuthority: '',
      tags: '',
      notes: '',
      evidenceStatus: 'review',
      confidence: 3,
      updatedAt: '',
    };
  }

  function sourceRows(entityType, entityId) {
    return (store.sources || []).filter(source => source.entityType === entityType && source.entityId === entityId);
  }

  function saveSource(entityType, entityId, formPrefix) {
    const title = document.getElementById(`${formPrefix}SourceTitle`)?.value.trim() || '';
    const url = document.getElementById(`${formPrefix}SourceUrl`)?.value.trim() || '';
    const date = document.getElementById(`${formPrefix}SourceDate`)?.value || '';
    const evidenceStatus = document.getElementById(`${formPrefix}SourceStatus`)?.value || 'review';
    const confidence = Number(document.getElementById(`${formPrefix}SourceConfidence`)?.value || 3);
    const note = document.getElementById(`${formPrefix}SourceNote`)?.value.trim() || '';
    if (!title && !url) {
      toast('Indicá un título o enlace.');
      return false;
    }
    store.sources.push({
      id: uid('source'),
      entityType,
      entityId,
      title: title || url,
      url,
      date,
      note,
      evidenceStatus,
      confidence,
      createdAt: nowIso(),
    });
    persist('Fuente agregada', entityType, entityId, title || url);
    toast('Fuente guardada.');
    return true;
  }

  function renderSources(entityType, entityId, targetId) {
    const target = document.getElementById(targetId);
    if (!target) return;
    const rows = sourceRows(entityType, entityId);
    target.innerHTML = rows.length ? rows.map(source => `
      <article class="intel-source">
        <div class="intel-badges">${evidenceBadge(source.evidenceStatus, source.confidence)}</div>
        <strong>${escapeHtml(source.title)}</strong>
        ${source.date ? `<span class="intel-muted">${formatDate(source.date)}</span>` : ''}
        ${source.note ? `<span class="intel-muted">${escapeHtml(source.note)}</span>` : ''}
        ${source.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener">Abrir fuente</a>` : ''}
        <div><button class="intel-btn small danger" type="button" data-delete-source="${escapeHtml(source.id)}">Eliminar</button></div>
      </article>
    `).join('') : '<p class="intel-muted">Todavía no hay fuentes adicionales.</p>';
    target.querySelectorAll('[data-delete-source]').forEach(button => button.addEventListener('click', () => {
      store.sources = store.sources.filter(source => source.id !== button.dataset.deleteSource);
      persist('Fuente eliminada', entityType, entityId, button.dataset.deleteSource);
      renderSources(entityType, entityId, targetId);
      renderData();
    }));
  }

  function sourceForm(prefix) {
    return `
      <div class="intel-form">
        <div class="intel-field"><label for="${prefix}SourceTitle">Título</label><input id="${prefix}SourceTitle" placeholder="Acto, nota, declaración o documento"></div>
        <div class="intel-field"><label for="${prefix}SourceUrl">Enlace público</label><input id="${prefix}SourceUrl" type="url" placeholder="https://"></div>
        <div class="intel-field"><label for="${prefix}SourceDate">Fecha</label><input id="${prefix}SourceDate" type="date"></div>
        <div class="intel-field"><label for="${prefix}SourceStatus">Estado de evidencia</label><select id="${prefix}SourceStatus">
          <option value="official">Oficial</option><option value="declared">Declarada públicamente</option>
          <option value="inferred">Inferida</option><option value="review" selected>En revisión</option>
        </select></div>
        <div class="intel-field"><label for="${prefix}SourceConfidence">Confianza</label><select id="${prefix}SourceConfidence">
          <option value="1">1 · Muy baja</option><option value="2">2 · Baja</option><option value="3" selected>3 · Media</option>
          <option value="4">4 · Alta</option><option value="5">5 · Muy alta</option>
        </select></div>
        <div class="intel-field wide"><label for="${prefix}SourceNote">Nota</label><input id="${prefix}SourceNote" placeholder="Qué demuestra esta fuente"></div>
      </div>
    `;
  }

  function ensureDrawer() {
    let drawer = document.getElementById('intelDrawer');
    if (!drawer) {
      drawer = document.createElement('aside');
      drawer.id = 'intelDrawer';
      drawer.className = 'intel-drawer hidden';
      document.body.appendChild(drawer);
    }
    return drawer;
  }

  function closeDrawer() {
    document.getElementById('intelDrawer')?.classList.add('hidden');
  }

  function renderPersonDrawer(personId) {
    const person = people.get(personId);
    if (!person) return;
    const drawer = ensureDrawer();
    const profile = getPersonProfile(personId);
    const nominations = (nominationsByPerson.get(personId) || []).slice().sort(nominationSort);
    const customRelations = readCustomRelations().filter(row => row.from === personId || row.to === personId);
    const targets = [...people.values()].filter(row => row.id !== personId).sort((a, b) => a.name.localeCompare(b.name, 'es'));

    drawer.innerHTML = `
      <div class="intel-drawer-head">
        <div><span class="intel-badge official">Ficha consolidada</span><h2>${escapeHtml(person.name)}</h2><div class="intel-badges">${evidenceBadge(profile.evidenceStatus, profile.confidence)}</div></div>
        <button class="intel-close" type="button" id="intelDrawerClose">Cerrar</button>
      </div>
      <h3 class="intel-section-title">Candidaturas oficiales</h3>
      <div class="intel-list">${nominations.map(row => `
        <article class="intel-row">
          <div class="intel-row-main"><strong>${escapeHtml(row.office)}</strong><span class="intel-muted">${escapeHtml(row.jurisdiction)} · orden ${row.order || 's/d'} · ${escapeHtml(row.listType)}</span></div>
          <a class="intel-btn small" href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="noopener">Fuente</a>
        </article>
      `).join('') || '<p class="intel-muted">Sin candidaturas registradas.</p>'}</div>

      <h3 class="intel-section-title">Perfil político editable</h3>
      <div class="intel-form">
        <div class="intel-field"><label for="personCurrentRole">Cargo o función actual</label><input id="personCurrentRole" value="${escapeHtml(profile.currentRole)}"></div>
        <div class="intel-field"><label for="personTerritoryReference">Territorio de referencia</label><input id="personTerritoryReference" value="${escapeHtml(profile.territoryReference)}"></div>
        <div class="intel-field"><label for="personPartyOrigin">Partido o espacio de origen</label><input id="personPartyOrigin" value="${escapeHtml(profile.partyOrigin)}"></div>
        <div class="intel-field"><label for="personPublicProfiles">Perfiles públicos</label><input id="personPublicProfiles" value="${escapeHtml(profile.publicProfiles)}" placeholder="Instagram, X, Facebook, sitio"></div>
        <div class="intel-field wide"><label for="personPreviousRoles">Cargos anteriores</label><textarea id="personPreviousRoles">${escapeHtml(profile.previousRoles)}</textarea></div>
        <div class="intel-field"><label for="personTags">Etiquetas</label><input id="personTags" value="${escapeHtml(profile.tags)}" placeholder="referente, juventud, fiscalización"></div>
        <div class="intel-field"><label for="personEvidenceStatus">Estado</label><select id="personEvidenceStatus">
          ${Object.entries(evidenceLabels).map(([value, label]) => `<option value="${value}"${profile.evidenceStatus === value ? ' selected' : ''}>${label}</option>`).join('')}
        </select></div>
        <div class="intel-field"><label for="personConfidence">Confianza</label><select id="personConfidence">
          ${[1,2,3,4,5].map(value => `<option value="${value}"${profile.confidence === value ? ' selected' : ''}>${value}</option>`).join('')}
        </select></div>
        <div class="intel-field wide"><label for="personNotes">Notas</label><textarea id="personNotes">${escapeHtml(profile.notes)}</textarea></div>
      </div>
      <div class="intel-actions"><button class="intel-btn primary" type="button" id="savePersonProfile">Guardar perfil</button></div>

      <h3 class="intel-section-title">Relaciones propias</h3>
      <div class="intel-list" id="personRelations">${customRelations.length ? customRelations.map(row => {
        const outgoing = row.from === personId;
        const otherId = outgoing ? row.to : row.from;
        const meta = store.relationMetadata[row.id] || {};
        return `<article class="intel-row">
          <div class="intel-row-main"><strong>${outgoing ? escapeHtml(relationLabels[row.type] || row.type) : 'Vínculo inverso'}: ${escapeHtml(personName(otherId))}</strong>
          <span class="intel-muted">${escapeHtml(row.note || '')}</span><div class="intel-badges">${evidenceBadge(meta.evidenceStatus || row.evidenceStatus || 'review', Number(meta.confidence || row.confidence || 3))}</div></div>
          <button class="intel-btn small danger" type="button" data-delete-relation="${escapeHtml(row.id)}">Eliminar</button>
        </article>`;
      }).join('') : '<p class="intel-muted">Todavía no hay relaciones propias.</p>'}</div>

      <div class="panel" style="margin-top:10px">
        <h4>Nueva relación con evidencia</h4>
        <div class="intel-form">
          <div class="intel-field"><label for="relationTargetIntel">Persona</label><select id="relationTargetIntel">${targets.map(row => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join('')}</select></div>
          <div class="intel-field"><label for="relationTypeIntel">Tipo</label><select id="relationTypeIntel">${Object.entries(relationLabels).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('')}</select></div>
          <div class="intel-field"><label for="relationStatusIntel">Estado de evidencia</label><select id="relationStatusIntel"><option value="declared">Declarada</option><option value="inferred">Inferida</option><option value="review" selected>En revisión</option><option value="official">Oficial</option></select></div>
          <div class="intel-field"><label for="relationConfidenceIntel">Confianza</label><select id="relationConfidenceIntel">${[1,2,3,4,5].map(value => `<option value="${value}"${value === 3 ? ' selected' : ''}>${value}</option>`).join('')}</select></div>
          <div class="intel-field wide"><label for="relationSourceIntel">Fuente</label><input id="relationSourceIntel" type="url" placeholder="https://"></div>
          <div class="intel-field wide"><label for="relationNoteIntel">Nota</label><input id="relationNoteIntel" placeholder="Contexto y fundamento"></div>
        </div>
        <div class="intel-actions"><button class="intel-btn primary" type="button" id="saveRelationIntel">Guardar relación</button></div>
      </div>

      <h3 class="intel-section-title">Fuentes complementarias</h3>
      <div id="personSourceRows" class="intel-list"></div>
      <div class="panel" style="margin-top:10px">${sourceForm('person')}<div class="intel-actions"><button class="intel-btn primary" id="savePersonSource" type="button">Agregar fuente</button></div></div>

      <h3 class="intel-section-title">Línea de tiempo</h3>
      <div class="intel-timeline">${allEvents().filter(event => event.personId === personId).sort((a,b) => safeDate(b.date)-safeDate(a.date)).slice(0,20).map(event => `
        <article class="intel-event"><time>${formatDate(event.date)}</time><h4>${escapeHtml(event.title)}</h4><p>${escapeHtml(event.description || '')}</p><div class="intel-badges">${evidenceBadge(event.evidenceStatus, event.confidence)}</div></article>
      `).join('') || '<p class="intel-muted">Sin eventos.</p>'}</div>
    `;

    drawer.classList.remove('hidden');
    document.getElementById('intelDrawerClose')?.addEventListener('click', closeDrawer);
    renderSources('person', personId, 'personSourceRows');

    document.getElementById('savePersonProfile')?.addEventListener('click', () => {
      store.personProfiles[personId] = {
        currentRole: document.getElementById('personCurrentRole')?.value.trim() || '',
        territoryReference: document.getElementById('personTerritoryReference')?.value.trim() || '',
        partyOrigin: document.getElementById('personPartyOrigin')?.value.trim() || '',
        publicProfiles: document.getElementById('personPublicProfiles')?.value.trim() || '',
        previousRoles: document.getElementById('personPreviousRoles')?.value.trim() || '',
        tags: document.getElementById('personTags')?.value.trim() || '',
        notes: document.getElementById('personNotes')?.value.trim() || '',
        evidenceStatus: document.getElementById('personEvidenceStatus')?.value || 'review',
        confidence: Number(document.getElementById('personConfidence')?.value || 3),
        updatedAt: nowIso(),
      };
      persist('Perfil de persona actualizado', 'person', personId, person.name);
      toast('Perfil guardado.');
      renderData();
    });

    document.getElementById('saveRelationIntel')?.addEventListener('click', () => {
      const target = document.getElementById('relationTargetIntel')?.value;
      const type = document.getElementById('relationTypeIntel')?.value;
      const note = document.getElementById('relationNoteIntel')?.value.trim() || '';
      const sourceUrl = document.getElementById('relationSourceIntel')?.value.trim() || '';
      const evidenceStatus = document.getElementById('relationStatusIntel')?.value || 'review';
      const confidence = Number(document.getElementById('relationConfidenceIntel')?.value || 3);
      if (!target || !type) return;
      const id = uid('custom');
      const rows = readCustomRelations();
      rows.push({id, from: personId, to: target, type, note, sourceUrl, evidenceStatus, confidence, createdAt: nowIso()});
      store.relationMetadata[id] = {sourceUrl, evidenceStatus, confidence, updatedAt: nowIso()};
      writeCustomRelations(rows, 'Relación propia agregada');
      renderPersonDrawer(personId);
      renderGraph();
    });

    drawer.querySelectorAll('[data-delete-relation]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.deleteRelation;
      writeCustomRelations(readCustomRelations().filter(row => row.id !== id), 'Relación propia eliminada');
      delete store.relationMetadata[id];
      persist('Metadatos de relación eliminados', 'relationship', id);
      renderPersonDrawer(personId);
      renderGraph();
    }));

    document.getElementById('savePersonSource')?.addEventListener('click', () => {
      if (saveSource('person', personId, 'person')) {
        renderSources('person', personId, 'personSourceRows');
        renderData();
      }
    });
  }

  function buildGraphData() {
    const jurisdiction = document.getElementById('graphJurisdiction')?.value || 'Provincia de Corrientes';
    const evidenceFilter = document.getElementById('graphEvidence')?.value || 'all';
    const rows = jurisdiction === 'Provincia de Corrientes'
      ? db.nominations.filter(row => row.level === 'provincial')
      : (nominationsByJurisdiction.get(jurisdiction) || []);

    const nodeIds = new Set(rows.map(row => row.personId));
    nodeIds.add('org-lla-corrientes');
    for (const relation of db.relationships || []) {
      if (relation.type === 'integra_lista' && nodeIds.has(relation.from)) nodeIds.add(relation.to);
    }

    const nodes = [...nodeIds].map(id => {
      if (people.has(id)) {
        const nomination = rows.find(row => row.personId === id) || (nominationsByPerson.get(id) || [])[0];
        return {id, type: 'person', label: personName(id), branch: nomination?.branch || '', order: nomination?.order || 99};
      }
      const org = organizations.get(id) || {name: id};
      return {id, type: id === 'org-lla-corrientes' ? 'organization' : 'list', label: org.name || id, branch: org.branch || '', order: 0};
    });

    const visible = new Set(nodes.map(node => node.id));
    const edges = [];
    for (const relation of db.relationships || []) {
      if (visible.has(relation.from) && visible.has(relation.to)) {
        if (relation.type === 'candidato_de' || relation.type === 'integra_lista' || relation.type === 'integra_formula_con') {
          edges.push({id: relation.id, from: relation.from, to: relation.to, type: relation.type, evidenceStatus: 'official', confidence: 5, custom: false});
        }
      }
    }

    for (const relation of readCustomRelations()) {
      if (!visible.has(relation.from) || !visible.has(relation.to)) continue;
      const meta = store.relationMetadata[relation.id] || {};
      const status = meta.evidenceStatus || relation.evidenceStatus || 'review';
      if (evidenceFilter === 'official') continue;
      if (evidenceFilter !== 'all' && evidenceFilter !== status) continue;
      edges.push({id: relation.id, from: relation.from, to: relation.to, type: relation.type, evidenceStatus: status, confidence: Number(meta.confidence || relation.confidence || 3), custom: true});
    }

    return {nodes, edges, jurisdiction};
  }

  function graphPositions(nodes, mode) {
    const positions = new Map();
    const centerX = 500;
    const centerY = 320;
    const org = nodes.find(node => node.id === 'org-lla-corrientes');
    if (org) positions.set(org.id, {x: centerX, y: mode === 'hierarchy' ? 55 : centerY});

    const listNodes = nodes.filter(node => node.type === 'list');
    const personNodes = nodes.filter(node => node.type === 'person');

    if (mode === 'hierarchy') {
      const branches = ['Ejecutivo provincial','Legislatura provincial · Senado','Legislatura provincial · Diputados','Ejecutivo municipal','Concejo Deliberante'];
      branches.forEach((branch, branchIndex) => {
        const group = personNodes.filter(node => node.branch === branch).sort((a,b) => a.order-b.order || a.label.localeCompare(b.label,'es'));
        const y = 145 + branchIndex * 105;
        group.forEach((node, index) => {
          const gap = Math.min(130, 820 / Math.max(1, group.length));
          positions.set(node.id, {x: 500 - ((group.length - 1) * gap) / 2 + index * gap, y});
        });
      });
      listNodes.forEach((node, index) => positions.set(node.id, {x: 90 + (index % 8) * 115, y: 610 - Math.floor(index / 8) * 50}));
    } else {
      listNodes.forEach((node, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(1, listNodes.length) - Math.PI / 2;
        positions.set(node.id, {x: centerX + Math.cos(angle) * 150, y: centerY + Math.sin(angle) * 115});
      });
      personNodes.forEach((node, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(1, personNodes.length) - Math.PI / 2;
        const ring = 250 + (index % 2) * 72;
        positions.set(node.id, {x: centerX + Math.cos(angle) * ring, y: centerY + Math.sin(angle) * ring * .72});
      });
    }

    nodes.forEach((node, index) => {
      if (!positions.has(node.id)) positions.set(node.id, {x: 100 + (index % 8) * 110, y: 120 + Math.floor(index / 8) * 90});
    });
    return positions;
  }

  function nodeLabel(label, max = 22) {
    const value = String(label);
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
  }

  function renderGraph() {
    const svg = document.getElementById('intelGraph');
    if (!svg) return;
    const {nodes, edges, jurisdiction} = buildGraphData();
    const mode = document.getElementById('graphMode')?.value || 'ecosystem';
    const positions = graphPositions(nodes, mode);
    let html = `<rect width="1000" height="650" fill="transparent"/>`;

    for (const edge of edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const statusClass = edge.custom ? `custom ${edge.evidenceStatus}` : (edge.type === 'integra_formula_con' ? 'formula' : '');
      html += `<line class="intel-edge ${statusClass}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"><title>${escapeHtml(edge.type)} · ${escapeHtml(evidenceLabels[edge.evidenceStatus] || 'Oficial')}</title></line>`;
    }

    for (const node of nodes) {
      const position = positions.get(node.id);
      if (!position) continue;
      const radius = node.type === 'organization' ? 38 : node.type === 'list' ? 26 : 23;
      html += `<g class="intel-node ${node.type}" data-node-id="${escapeHtml(node.id)}" transform="translate(${position.x},${position.y})">
        <circle r="${radius}"></circle>
        <text y="${radius + 17}">${escapeHtml(nodeLabel(node.label, node.type === 'person' ? 22 : 28))}</text>
        <title>${escapeHtml(node.label)}</title>
      </g>`;
    }

    svg.innerHTML = html;
    svg.querySelectorAll('[data-node-id]').forEach(group => group.addEventListener('click', () => {
      const id = group.dataset.nodeId;
      svg.querySelectorAll('.intel-node').forEach(node => node.classList.toggle('selected', node === group));
      if (people.has(id)) renderPersonDrawer(id);
      else renderOrganizationDrawer(id, jurisdiction);
    }));

    const stats = document.getElementById('graphStats');
    if (stats) stats.innerHTML = `<span class="intel-badge official">${nodes.length} nodos</span><span class="intel-badge">${edges.length} conexiones</span><span class="intel-badge">${escapeHtml(jurisdiction)}</span>`;
  }

  function renderOrganizationDrawer(id, jurisdiction) {
    const org = organizations.get(id);
    if (!org) return;
    const drawer = ensureDrawer();
    const members = (db.relationships || []).filter(row => row.to === id && people.has(row.from)).map(row => row.from);
    drawer.innerHTML = `
      <div class="intel-drawer-head"><div><span class="intel-badge official">Organización electoral</span><h2>${escapeHtml(org.name)}</h2><p class="intel-muted">${escapeHtml(org.branch || org.type || '')} · ${escapeHtml(org.jurisdiction || jurisdiction || '')}</p></div><button class="intel-close" id="intelDrawerClose">Cerrar</button></div>
      <div class="intel-list">${members.map(personId => `<button type="button" class="intel-row" data-open-person="${escapeHtml(personId)}"><span class="intel-row-main"><strong>${escapeHtml(personName(personId))}</strong></span></button>`).join('') || '<p class="intel-muted">Sin integrantes visibles en este filtro.</p>'}</div>`;
    drawer.classList.remove('hidden');
    document.getElementById('intelDrawerClose')?.addEventListener('click', closeDrawer);
    drawer.querySelectorAll('[data-open-person]').forEach(button => button.addEventListener('click', () => renderPersonDrawer(button.dataset.openPerson)));
  }

  const graphHtml = `
    <div class="panel">
      <div class="intel-heading"><div><h2>Grafo político y electoral</h2><p class="detail">Las conexiones oficiales muestran candidaturas, listas y fórmulas. Las jerarquías personales sólo aparecen cuando fueron agregadas con evidencia.</p></div><div class="intel-badges" id="graphStats"></div></div>
      <div class="intel-toolbar" style="margin-top:12px">
        <div class="intel-field"><label for="graphJurisdiction">Jurisdicción</label><select id="graphJurisdiction"></select></div>
        <div class="intel-field"><label for="graphMode">Vista</label><select id="graphMode"><option value="ecosystem">Ecosistema</option><option value="hierarchy">Jerarquía institucional</option></select></div>
        <div class="intel-field"><label for="graphEvidence">Relaciones propias</label><select id="graphEvidence"><option value="all">Todas</option><option value="official">Sólo estructura oficial</option><option value="declared">Declaradas</option><option value="inferred">Inferidas</option><option value="review">En revisión</option></select></div>
      </div>
      <div class="intel-graph-wrap" style="margin-top:11px"><svg id="intelGraph" viewBox="0 0 1000 650" role="img" aria-label="Grafo de relaciones políticas y electorales"></svg></div>
      <div class="intel-legend"><span><i class="intel-line"></i>Estructura electoral oficial</span><span><i class="intel-line custom"></i>Relación propia con evidencia</span></div>
    </div>`;

  function initGraph() {
    const select = document.getElementById('graphJurisdiction');
    if (select && !select.dataset.ready) {
      const jurisdictions = ['Provincia de Corrientes', ...[...nominationsByJurisdiction.keys()].filter(name => name !== 'Provincia de Corrientes').sort((a,b) => a.localeCompare(b,'es'))];
      select.innerHTML = jurisdictions.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
      select.value = store.settings.lastJurisdiction || 'Provincia de Corrientes';
      if (!jurisdictions.includes(select.value)) select.value = 'Provincia de Corrientes';
      select.dataset.ready = '1';
      select.addEventListener('change', () => {
        store.settings.lastJurisdiction = select.value;
        persist('', '', '', '');
        renderGraph();
      });
      document.getElementById('graphMode')?.addEventListener('change', renderGraph);
      document.getElementById('graphEvidence')?.addEventListener('change', renderGraph);
    }
    renderGraph();
  }

  const territoriesHtml = `
    <div class="panel">
      <div class="intel-heading"><div><h2>Perfil territorial</h2><p class="detail">Candidaturas, estructura local, evaluación, fuentes y notas del municipio seleccionado.</p></div><span class="intel-badge official">74 municipios revisados</span></div>
      <div class="intel-toolbar" style="margin-top:12px"><div class="intel-field"><label for="territorySelect">Municipio</label><select id="territorySelect"></select></div></div>
    </div>
    <div id="territoryContent"></div>`;

  function renderTerritory() {
    const jurisdiction = document.getElementById('territorySelect')?.value;
    const target = document.getElementById('territoryContent');
    if (!jurisdiction || !target) return;
    const rows = (nominationsByJurisdiction.get(jurisdiction) || []).slice().sort(nominationSort);
    const coverage = (db.coverage || []).find(row => norm(row.jurisdiction) === norm(jurisdiction));
    const profile = getTerritoryProfile(jurisdiction);
    const titular = rows.filter(row => row.listType === 'titular').length;
    const suplente = rows.filter(row => row.listType === 'suplente').length;
    const branches = [...new Set(rows.map(row => row.branch))];
    const evaluationLabels = {sin_evaluar: 'Sin evaluar',fortaleza: 'Fortaleza',competitivo: 'Competitivo',debil: 'Débil',sin_estructura: 'Sin estructura detectada'};
    const byOffice = new Map();
    for (const row of rows) {
      if (!byOffice.has(row.office)) byOffice.set(row.office, []);
      byOffice.get(row.office).push(row);
    }

    target.innerHTML = `
      <div class="panel">
        <div class="intel-territory-header">
          <div><h2>${escapeHtml(jurisdiction)}</h2><div class="intel-badges">${coverage?.hasOfficialLLAList ? '<span class="intel-badge official">Lista LLA oficial encontrada</span>' : '<span class="intel-badge review">Sin lista LLA en resolución revisada</span>'}${evidenceBadge(profile.evidenceStatus, profile.confidence)}</div></div>
          ${coverage?.sourceUrl ? `<a class="intel-btn small" href="${escapeHtml(coverage.sourceUrl)}" target="_blank" rel="noopener">Resolución municipal</a>` : ''}
        </div>
        <div class="intel-kpis" style="margin-top:12px">
          <div class="intel-kpi"><span>Candidaturas</span><strong>${rows.length}</strong></div>
          <div class="intel-kpi"><span>Titulares</span><strong>${titular}</strong></div>
          <div class="intel-kpi"><span>Suplentes</span><strong>${suplente}</strong></div>
          <div class="intel-kpi"><span>Áreas institucionales</span><strong>${branches.length}</strong></div>
        </div>
        <div class="intel-office-grid">${[...byOffice.entries()].map(([office, officeRows]) => `
          <article class="intel-office"><h4>${escapeHtml(office)}</h4><ol>${officeRows.sort((a,b)=>(a.order||99)-(b.order||99)).map(row => `<li><button class="intel-btn small" type="button" data-territory-person="${escapeHtml(row.personId)}">${escapeHtml(personName(row.personId))}</button></li>`).join('')}</ol></article>
        `).join('') || '<div class="intel-empty">No se encontró una lista de LLA en esta resolución municipal.</div>'}</div>
      </div>

      <div class="panel">
        <h3>Evaluación territorial</h3>
        <div class="intel-form">
          <div class="intel-field"><label for="territoryEvaluation">Situación</label><select id="territoryEvaluation">${Object.entries(evaluationLabels).map(([value,label])=>`<option value="${value}"${profile.evaluation===value?' selected':''}>${label}</option>`).join('')}</select></div>
          <div class="intel-field"><label>Prioridad estratégica</label><div class="intel-score" id="territoryPriority">${[1,2,3,4,5].map(value=>`<button type="button" data-priority="${value}" class="${profile.priority===value?'active':''}">${value}</button>`).join('')}</div></div>
          <div class="intel-field"><label for="territoryAuthority">Autoridad actual</label><input id="territoryAuthority" value="${escapeHtml(profile.currentAuthority)}" placeholder="Intendente, bloque o conducción"></div>
          <div class="intel-field"><label for="territoryTags">Etiquetas</label><input id="territoryTags" value="${escapeHtml(profile.tags)}" placeholder="prioritario, frontera, rural"></div>
          <div class="intel-field"><label for="territoryEvidenceStatus">Estado de evidencia</label><select id="territoryEvidenceStatus">${Object.entries(evidenceLabels).map(([value,label])=>`<option value="${value}"${profile.evidenceStatus===value?' selected':''}>${label}</option>`).join('')}</select></div>
          <div class="intel-field"><label for="territoryConfidence">Confianza</label><select id="territoryConfidence">${[1,2,3,4,5].map(value=>`<option value="${value}"${profile.confidence===value?' selected':''}>${value}</option>`).join('')}</select></div>
          <div class="intel-field wide"><label for="territoryNotes">Diagnóstico y notas</label><textarea id="territoryNotes">${escapeHtml(profile.notes)}</textarea></div>
        </div>
        <div class="intel-actions"><button class="intel-btn primary" id="saveTerritoryProfile" type="button">Guardar evaluación</button><button class="intel-btn" id="openTerritoryGraph" type="button">Ver en grafo</button></div>
      </div>

      <div class="panel">
        <h3>Fuentes territoriales</h3><div id="territorySourceRows" class="intel-list"></div>
        <div style="margin-top:11px">${sourceForm('territory')}<div class="intel-actions"><button class="intel-btn primary" id="saveTerritorySource" type="button">Agregar fuente</button></div></div>
      </div>`;

    target.querySelectorAll('[data-territory-person]').forEach(button => button.addEventListener('click', () => renderPersonDrawer(button.dataset.territoryPerson)));
    renderSources('territory', jurisdiction, 'territorySourceRows');

    target.querySelectorAll('[data-priority]').forEach(button => button.addEventListener('click', () => {
      target.querySelectorAll('[data-priority]').forEach(node => node.classList.remove('active'));
      button.classList.add('active');
    }));

    document.getElementById('saveTerritoryProfile')?.addEventListener('click', () => {
      const priority = Number(target.querySelector('[data-priority].active')?.dataset.priority || 3);
      store.territoryProfiles[jurisdiction] = {
        evaluation: document.getElementById('territoryEvaluation')?.value || 'sin_evaluar',
        priority,
        currentAuthority: document.getElementById('territoryAuthority')?.value.trim() || '',
        tags: document.getElementById('territoryTags')?.value.trim() || '',
        notes: document.getElementById('territoryNotes')?.value.trim() || '',
        evidenceStatus: document.getElementById('territoryEvidenceStatus')?.value || 'review',
        confidence: Number(document.getElementById('territoryConfidence')?.value || 3),
        updatedAt: nowIso(),
      };
      persist('Perfil territorial actualizado', 'territory', jurisdiction, evaluationLabels[store.territoryProfiles[jurisdiction].evaluation]);
      toast('Perfil territorial guardado.');
      renderData();
    });

    document.getElementById('saveTerritorySource')?.addEventListener('click', () => {
      if (saveSource('territory', jurisdiction, 'territory')) {
        renderSources('territory', jurisdiction, 'territorySourceRows');
        renderData();
      }
    });

    document.getElementById('openTerritoryGraph')?.addEventListener('click', () => {
      const graphNav = document.querySelector('nav [data-view="graph"]');
      activateSection('graph', graphNav);
      const select = document.getElementById('graphJurisdiction');
      if (select) select.value = jurisdiction;
      renderGraph();
    });
  }

  function initTerritories() {
    const select = document.getElementById('territorySelect');
    if (select && !select.dataset.ready) {
      const values = [...new Set((db.coverage || []).map(row => row.jurisdiction))].sort((a,b)=>a.localeCompare(b,'es'));
      select.innerHTML = values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
      select.value = store.settings.lastTerritory || values[0] || '';
      select.dataset.ready = '1';
      select.addEventListener('change', () => {
        store.settings.lastTerritory = select.value;
        persist('', '', '', '');
        renderTerritory();
      });
    }
    renderTerritory();
  }

  const timelineHtml = `
    <div class="panel">
      <div class="intel-heading"><div><h2>Actividad y línea de tiempo</h2><p class="detail">Combina eventos electorales oficiales con actividades, declaraciones y cambios agregados por el usuario.</p></div><span class="intel-badge review">Eventos propios editables</span></div>
      <div class="intel-toolbar four" style="margin-top:12px">
        <div class="intel-field"><label for="timelineJurisdiction">Municipio</label><select id="timelineJurisdiction"></select></div>
        <div class="intel-field"><label for="timelinePerson">Persona</label><select id="timelinePerson"></select></div>
        <div class="intel-field"><label for="timelineEvidence">Evidencia</label><select id="timelineEvidence"><option value="">Todas</option><option value="official">Oficial</option><option value="declared">Declarada</option><option value="inferred">Inferida</option><option value="review">En revisión</option></select></div>
        <div class="intel-field"><label for="timelineSearch">Buscar</label><input id="timelineSearch" type="search" placeholder="Acto, declaración, alianza"></div>
      </div>
    </div>
    <div class="panel">
      <h3>Agregar evento</h3>
      <div class="intel-form">
        <div class="intel-field"><label for="eventDate">Fecha</label><input id="eventDate" type="date"></div>
        <div class="intel-field"><label for="eventTitle">Título</label><input id="eventTitle"></div>
        <div class="intel-field"><label for="eventJurisdiction">Municipio</label><select id="eventJurisdiction"></select></div>
        <div class="intel-field"><label for="eventPerson">Persona</label><select id="eventPerson"></select></div>
        <div class="intel-field"><label for="eventStatus">Estado de evidencia</label><select id="eventStatus"><option value="declared">Declarada</option><option value="inferred">Inferida</option><option value="review" selected>En revisión</option><option value="official">Oficial</option></select></div>
        <div class="intel-field"><label for="eventConfidence">Confianza</label><select id="eventConfidence">${[1,2,3,4,5].map(value=>`<option value="${value}"${value===3?' selected':''}>${value}</option>`).join('')}</select></div>
        <div class="intel-field wide"><label for="eventDescription">Descripción</label><textarea id="eventDescription"></textarea></div>
        <div class="intel-field wide"><label for="eventSource">Fuente</label><input id="eventSource" type="url" placeholder="https://"></div>
      </div>
      <div class="intel-actions"><button class="intel-btn primary" id="saveEvent" type="button">Agregar evento</button></div>
    </div>
    <div class="panel"><div id="timelineResults"></div></div>`;

  function renderTimeline() {
    const jurisdiction = document.getElementById('timelineJurisdiction')?.value || '';
    const personId = document.getElementById('timelinePerson')?.value || '';
    const evidence = document.getElementById('timelineEvidence')?.value || '';
    const search = norm(document.getElementById('timelineSearch')?.value || '');
    const rows = allEvents().filter(event => {
      const haystack = norm(`${event.title} ${event.description || ''} ${personName(event.personId)} ${event.jurisdiction || ''}`);
      return (!jurisdiction || event.jurisdiction === jurisdiction)
        && (!personId || event.personId === personId)
        && (!evidence || event.evidenceStatus === evidence)
        && (!search || haystack.includes(search));
    }).sort((a,b) => safeDate(b.date)-safeDate(a.date));

    const target = document.getElementById('timelineResults');
    if (!target) return;
    target.innerHTML = rows.length ? `<div class="intel-timeline">${rows.slice(0,250).map(event => `
      <article class="intel-event">
        <time>${formatDate(event.date)} · ${escapeHtml(event.jurisdiction || 'Provincia')}</time>
        <h4>${escapeHtml(event.title)}</h4>
        <p>${escapeHtml(event.description || '')}</p>
        ${event.personId ? `<button class="intel-btn small" type="button" data-event-person="${escapeHtml(event.personId)}">${escapeHtml(personName(event.personId))}</button>` : ''}
        ${event.sourceUrl ? `<a class="intel-btn small" href="${escapeHtml(event.sourceUrl)}" target="_blank" rel="noopener">Fuente</a>` : ''}
        <div class="intel-badges" style="margin-top:5px">${evidenceBadge(event.evidenceStatus, event.confidence)}${!event.immutable ? `<button class="intel-btn small danger" data-delete-event="${escapeHtml(event.id)}" type="button">Eliminar</button>` : ''}</div>
      </article>
    `).join('')}</div>` : '<div class="intel-empty">No hay eventos que coincidan con los filtros.</div>';

    target.querySelectorAll('[data-event-person]').forEach(button => button.addEventListener('click', () => renderPersonDrawer(button.dataset.eventPerson)));
    target.querySelectorAll('[data-delete-event]').forEach(button => button.addEventListener('click', () => {
      store.events = store.events.filter(event => event.id !== button.dataset.deleteEvent);
      persist('Evento eliminado', 'event', button.dataset.deleteEvent);
      renderTimeline();
      renderData();
    }));
  }

  function initTimeline() {
    const jurisdictions = [...new Set((db.coverage || []).map(row => row.jurisdiction))].sort((a,b)=>a.localeCompare(b,'es'));
    const personValues = [...people.values()].sort((a,b)=>a.name.localeCompare(b.name,'es'));
    for (const id of ['timelineJurisdiction','eventJurisdiction']) {
      const select = document.getElementById(id);
      if (select && !select.dataset.ready) {
        select.innerHTML = optionHtml(jurisdictions, '', id === 'eventJurisdiction' ? 'Sin municipio' : 'Todos');
        select.dataset.ready = '1';
      }
    }
    for (const id of ['timelinePerson','eventPerson']) {
      const select = document.getElementById(id);
      if (select && !select.dataset.ready) {
        select.innerHTML = `<option value="">${id === 'eventPerson' ? 'Sin persona' : 'Todas'}</option>` + personValues.map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join('');
        select.dataset.ready = '1';
      }
    }
    ['timelineJurisdiction','timelinePerson','timelineEvidence'].forEach(id => {
      const element = document.getElementById(id);
      if (element && !element.dataset.bound) {
        element.dataset.bound = '1';
        element.addEventListener('change', renderTimeline);
      }
    });
    const search = document.getElementById('timelineSearch');
    if (search && !search.dataset.bound) {
      search.dataset.bound = '1';
      search.addEventListener('input', renderTimeline);
    }
    const save = document.getElementById('saveEvent');
    if (save && !save.dataset.bound) {
      save.dataset.bound = '1';
      save.addEventListener('click', () => {
        const title = document.getElementById('eventTitle')?.value.trim() || '';
        const date = document.getElementById('eventDate')?.value || '';
        if (!title || !date) {
          toast('Indicá fecha y título.');
          return;
        }
        store.events.push({
          id: uid('event'),
          date,
          title,
          description: document.getElementById('eventDescription')?.value.trim() || '',
          jurisdiction: document.getElementById('eventJurisdiction')?.value || '',
          personId: document.getElementById('eventPerson')?.value || '',
          sourceUrl: document.getElementById('eventSource')?.value.trim() || '',
          evidenceStatus: document.getElementById('eventStatus')?.value || 'review',
          confidence: Number(document.getElementById('eventConfidence')?.value || 3),
          type: 'actividad',
          createdAt: nowIso(),
        });
        persist('Evento agregado', 'event', store.events.at(-1).id, title);
        document.getElementById('eventTitle').value = '';
        document.getElementById('eventDescription').value = '';
        document.getElementById('eventSource').value = '';
        toast('Evento agregado.');
        renderTimeline();
        renderData();
      });
    }
    renderTimeline();
  }

  function duplicateGroups() {
    const groups = new Map();
    for (const person of db.people) {
      const key = norm(person.name).replace(/\b(de|del|la|las|los|y)\b/g,'').replace(/\s+/g,' ');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(person);
    }
    return [...groups.values()].filter(rows => rows.length > 1);
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text;
  }

  function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], {type});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function backupPayload() {
    return {schema: 'corrientes-ti-backup-v1',exportedAt: nowIso(),appVersion: APP_VERSION,publicDataMeta: db.meta,localIntelligence: store,customRelations: readCustomRelations()};
  }

  function exportCandidatesCsv() {
    const headers = ['persona','nombre_oficial','alias','cargo','rama','nivel','tipo_lista','orden','jurisdiccion','fecha_eleccion','resolucion','expediente','fuente'];
    const rows = db.nominations.map(row => {
      const person = people.get(row.personId) || {};
      return [person.name,person.officialName,(person.aliases||[]).join('|'),row.office,row.branch,row.level,row.listType,row.order,row.jurisdiction,row.electionDate,row.sourceResolution,row.sourceExpediente,row.sourceUrl];
    });
    downloadText('corrientes-lla-candidaturas-2025.csv', [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n'), 'text/csv;charset=utf-8');
  }

  function exportRelationsCsv() {
    const headers = ['origen','relacion','destino','estado_evidencia','confianza','nota','fuente'];
    const rows = readCustomRelations().map(row => {
      const meta = store.relationMetadata[row.id] || {};
      return [personName(row.from),relationLabels[row.type]||row.type,personName(row.to),meta.evidenceStatus||row.evidenceStatus||'review',meta.confidence||row.confidence||3,row.note||'',meta.sourceUrl||row.sourceUrl||''];
    });
    downloadText('corrientes-relaciones-locales.csv', [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n'), 'text/csv;charset=utf-8');
  }

  const dataHtml = `
    <div class="panel">
      <div class="intel-heading"><div><h2>Datos, respaldo y control</h2><p class="detail">Exportación, importación, trazabilidad, control de duplicados y estado de la información local.</p></div><span class="intel-badge">Esquema v1</span></div>
      <div id="dataMetrics" class="intel-kpis" style="margin-top:12px"></div>
    </div>
    <div class="panel">
      <h3>Respaldo</h3>
      <p class="detail">El respaldo incluye perfiles, fuentes, eventos, evaluaciones territoriales y relaciones agregadas en este dispositivo. La base electoral pública no se duplica dentro del archivo.</p>
      <div class="intel-actions">
        <button class="intel-btn primary" id="exportBackup" type="button">Descargar respaldo JSON</button>
        <button class="intel-btn" id="copyBackup" type="button">Copiar respaldo</button>
        <label class="intel-btn" for="importBackup">Importar respaldo</label><input id="importBackup" type="file" accept="application/json" hidden>
      </div>
    </div>
    <div class="panel"><h3>Exportaciones de trabajo</h3><div class="intel-actions"><button class="intel-btn" id="exportCandidatesCsv" type="button">Candidaturas CSV</button><button class="intel-btn" id="exportRelationsCsv" type="button">Relaciones CSV</button></div></div>
    <div class="panel"><h3>Control de calidad</h3><div id="qualityResults"></div></div>
    <div class="panel"><h3>Registro de cambios local</h3><div class="intel-audit" id="auditResults"></div></div>
    <div class="panel"><div class="intel-warning"><strong>Zona de riesgo.</strong> El borrado afecta únicamente notas, relaciones, fuentes y análisis guardados en este dispositivo.</div><div class="intel-actions"><button class="intel-btn danger" id="resetLocalData" type="button">Borrar análisis local</button></div></div>`;

  function renderData() {
    const metrics = document.getElementById('dataMetrics');
    if (!metrics) return;
    metrics.innerHTML = `
      <div class="intel-kpi"><span>Perfiles personales editados</span><strong>${Object.keys(store.personProfiles || {}).length}</strong></div>
      <div class="intel-kpi"><span>Territorios evaluados</span><strong>${Object.keys(store.territoryProfiles || {}).length}</strong></div>
      <div class="intel-kpi"><span>Fuentes agregadas</span><strong>${(store.sources || []).length}</strong></div>
      <div class="intel-kpi"><span>Relaciones propias</span><strong>${readCustomRelations().length}</strong></div>`;

    const duplicates = duplicateGroups();
    const quality = document.getElementById('qualityResults');
    if (quality) {
      const missingOfficialSource = db.nominations.filter(row => !row.sourceUrl).length;
      const lowConfidence = [...Object.values(store.personProfiles || {}), ...Object.values(store.territoryProfiles || {})].filter(row => Number(row.confidence || 0) <= 2).length;
      quality.innerHTML = `
        <div class="intel-list">
          <article class="intel-row"><div class="intel-row-main"><strong>Posibles nombres duplicados</strong><span class="intel-muted">${duplicates.length} grupos para revisión manual</span></div></article>
          <article class="intel-row"><div class="intel-row-main"><strong>Candidaturas sin enlace oficial</strong><span class="intel-muted">${missingOfficialSource}</span></div></article>
          <article class="intel-row"><div class="intel-row-main"><strong>Evaluaciones locales de baja confianza</strong><span class="intel-muted">${lowConfidence}</span></div></article>
        </div>
        ${duplicates.length ? `<div class="intel-table-wrap" style="margin-top:10px"><table class="intel-table"><thead><tr><th>Posible duplicado</th><th>Registros</th></tr></thead><tbody>${duplicates.slice(0,30).map(group=>`<tr><td>${escapeHtml(group[0].name)}</td><td>${escapeHtml(group.map(row=>row.name).join(' / '))}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
    }

    const audit = document.getElementById('auditResults');
    if (audit) audit.innerHTML = (store.audit || []).slice(0,80).map(row => `<div class="intel-audit-row"><strong>${escapeHtml(row.action)}</strong> · ${new Date(row.at).toLocaleString('es-AR')}<br><span class="intel-muted">${escapeHtml(row.entityType)} ${escapeHtml(row.entityId)} ${escapeHtml(row.detail || '')}</span></div>`).join('') || '<p class="intel-muted">Todavía no hay cambios locales registrados.</p>';
  }

  function initData() {
    renderData();
    const exportButton = document.getElementById('exportBackup');
    if (exportButton && !exportButton.dataset.bound) {
      exportButton.dataset.bound = '1';
      exportButton.addEventListener('click', () => downloadText(`corrientes-ti-respaldo-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(backupPayload(), null, 2), 'application/json;charset=utf-8'));
    }
    const copyButton = document.getElementById('copyBackup');
    if (copyButton && !copyButton.dataset.bound) {
      copyButton.dataset.bound = '1';
      copyButton.addEventListener('click', async () => {
        try {await navigator.clipboard.writeText(JSON.stringify(backupPayload(), null, 2));toast('Respaldo copiado.');}
        catch (_) {toast('Safari no permitió copiar; usá Descargar respaldo.');}
      });
    }
    const importInput = document.getElementById('importBackup');
    if (importInput && !importInput.dataset.bound) {
      importInput.dataset.bound = '1';
      importInput.addEventListener('change', async () => {
        const file = importInput.files?.[0];
        if (!file) return;
        try {
          const payload = JSON.parse(await file.text());
          if (payload.schema !== 'corrientes-ti-backup-v1' || !payload.localIntelligence) throw new Error('Formato no reconocido');
          if (!confirm('¿Reemplazar el análisis local actual por el respaldo seleccionado?')) return;
          store = {...initialStore(), ...payload.localIntelligence};
          localStorage.setItem(STORE_KEY, JSON.stringify(store));
          if (Array.isArray(payload.customRelations)) localStorage.setItem(CUSTOM_RELATIONS_KEY, JSON.stringify(payload.customRelations));
          persist('Respaldo importado', 'backup', file.name);
          toast('Respaldo importado.');
          renderData();renderGraph();renderTerritory();renderTimeline();
        } catch (error) {toast(`No se pudo importar: ${error.message}`);} finally {importInput.value = '';}
      });
    }
    const candidates = document.getElementById('exportCandidatesCsv');
    if (candidates && !candidates.dataset.bound) {candidates.dataset.bound = '1';candidates.addEventListener('click', exportCandidatesCsv);}
    const relations = document.getElementById('exportRelationsCsv');
    if (relations && !relations.dataset.bound) {relations.dataset.bound = '1';relations.addEventListener('click', exportRelationsCsv);}
    const reset = document.getElementById('resetLocalData');
    if (reset && !reset.dataset.bound) {
      reset.dataset.bound = '1';
      reset.addEventListener('click', () => {
        if (!confirm('¿Borrar todos los análisis, fuentes, eventos y relaciones guardados en este dispositivo?')) return;
        localStorage.removeItem(STORE_KEY);localStorage.removeItem(CUSTOM_RELATIONS_KEY);store = initialStore();persist('Datos locales reiniciados', 'system', '');toast('Análisis local borrado.');renderData();renderGraph();renderTerritory();renderTimeline();
      });
    }
  }

  function augmentExistingNetwork() {
    const results = document.getElementById('networkResults');
    if (results && !results.dataset.intelCapture) {
      results.dataset.intelCapture = '1';
      results.addEventListener('click', event => {
        const button = event.target.closest?.('[data-person-id]');
        if (!button) return;
        setTimeout(() => renderPersonDrawer(button.dataset.personId), 50);
      }, true);
    }
  }

  function enhanceMap() {
    const svg = document.getElementById('mapSvg');
    if (!svg || svg.dataset.intelTerritoryBound) return;
    svg.dataset.intelTerritoryBound = '1';
    svg.addEventListener('click', event => {
      const territory = event.target.closest?.('.territory');
      if (!territory) return;
      const name = territory.dataset.name;
      const match = (db.coverage || []).find(row => norm(row.jurisdiction) === norm(name));
      if (!match) return;
      setTimeout(() => {
        const mapDetail = document.getElementById('mapDetail');
        if (!mapDetail || mapDetail.querySelector('[data-open-territory]')) return;
        mapDetail.insertAdjacentHTML('beforeend', ` <button type="button" class="intel-btn small" data-open-territory="${escapeHtml(match.jurisdiction)}">Abrir perfil territorial</button>`);
        mapDetail.querySelector('[data-open-territory]')?.addEventListener('click', () => openTerritory(match.jurisdiction));
      }, 80);
    });
  }

  function openTerritory(jurisdiction) {
    const button = document.querySelector('nav [data-view="territories"]');
    activateSection('territories', button);
    const select = document.getElementById('territorySelect');
    if (select) select.value = jurisdiction;
    store.settings.lastTerritory = jurisdiction;
    persist('', '', '', '');
    renderTerritory();
  }

  function installSections() {
    addNavSection('graph', 'Grafo', graphHtml, initGraph);
    addNavSection('territories', 'Territorios', territoriesHtml, initTerritories);
    addNavSection('timeline', 'Actividad', timelineHtml, initTimeline);
    addNavSection('data', 'Datos', dataHtml, initData);
    augmentExistingNetwork();
    enhanceMap();

    const observer = new MutationObserver(() => {augmentExistingNetwork();enhanceMap();});
    observer.observe(document.querySelector('.app') || document.body, {childList: true, subtree: true});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installSections, {once: true});
  else installSections();
})();
