(() => {
  'use strict';

  const empty = {
    meta: {title: 'Resultados no disponibles'},
    jurisdictions: [],
    results: [],
    llaResults: [],
    llaIndex: {},
    report: {jurisdictions: 0, departments: 0, municipalities: 0, errors: ['No se pudo cargar la base electoral.']},
  };

  try {
    const request = new XMLHttpRequest();
    request.open('GET', './election-results-2025.json?v=8', false);
    request.setRequestHeader('Cache-Control', 'no-cache');
    request.send(null);

    if (request.status < 200 || request.status >= 300) {
      throw new Error(`HTTP ${request.status}`);
    }

    const data = JSON.parse(request.responseText);
    if (!Array.isArray(data.results) || !Array.isArray(data.llaResults) || !data.llaIndex) {
      throw new Error('La estructura de resultados es inválida.');
    }

    window.CORRIENTES_DEFINITIVE_RESULTS_2025 = data;
    window.CORRIENTES_RESULTS_LOAD_ERROR = '';
  } catch (error) {
    window.CORRIENTES_DEFINITIVE_RESULTS_2025 = empty;
    window.CORRIENTES_RESULTS_LOAD_ERROR = String(error?.message || error || 'Error desconocido');
    console.error('No se pudo cargar el escrutinio definitivo:', error);
  }
})();
