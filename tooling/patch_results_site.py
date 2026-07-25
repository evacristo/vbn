#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

site = Path(sys.argv[1])
html_path = site / "mobile-v2.html"
html = html_path.read_text(encoding="utf-8")

html = html.replace('manifest-v2.webmanifest?v=6', 'manifest-v2.webmanifest?v=7')
html = html.replace(
    '<link rel="stylesheet" href="intelligence-suite.css?v=1">',
    '<link rel="stylesheet" href="intelligence-suite.css?v=1">\n<link rel="stylesheet" href="results-suite.css?v=1">',
)
html = html.replace(
    'Mapa local · candidatos LLA 2025 incorporados',
    'Escrutinio definitivo 2025 · resultados por lista y categoría',
)
old_select = '<select id="contest"><option value="2023-runoff">Balotaje presidencial 2023 · LLA</option><option value="2025-deputies">Diputados nacionales 2025 · LLA</option><option value="2025-mayor">Intendencia 2025 · LLA</option></select>'
new_select = '<select id="contest"><option value="2025-governor">Provinciales 2025 · Gobernador</option><option value="2025-senators">Provinciales 2025 · Senadores</option><option value="2025-deputies-provincial">Provinciales 2025 · Diputados</option><option value="2025-mayor">Municipales 2025 · Intendente</option><option value="2025-councillors">Municipales 2025 · Concejales</option></select>'
if old_select not in html and new_select not in html:
    raise SystemExit('Expected map contest selector was not found')
html = html.replace(old_select, new_select)

map_anchor = '<script src="map-routes.js?v=4"></script>'
if '<script src="election-results-2025.js?v=1"></script>' not in html:
    if map_anchor not in html:
        raise SystemExit('Map script anchor not found')
    html = html.replace(map_anchor, map_anchor + '\n<script src="election-results-2025.js?v=1"></script>')

suite_anchor = '<script src="intelligence-suite.js?v=1"></script>'
if '<script src="results-suite.js?v=1"></script>' not in html:
    if suite_anchor not in html:
        raise SystemExit('Intelligence suite anchor not found')
    html = html.replace(suite_anchor, suite_anchor + '\n<script src="results-suite.js?v=1"></script>')

html_path.write_text(html, encoding="utf-8")

fix_path = site / "fix-mobile-map.html"
fix = fix_path.read_text(encoding="utf-8")
fix = fix.replace('mobile-v2.html?v=6', 'mobile-v2.html?v=7')
fix = fix.replace('mobile-v2.html?v=5', 'mobile-v2.html?v=7')
fix = fix.replace('Actualizando el mapa móvil', 'Actualizando resultados electorales')
fix = fix.replace('Caché eliminado. Abriendo el mapa…', 'Caché eliminado. Abriendo resultados verificados…')
fix_path.write_text(fix, encoding="utf-8")

manifest_path = site / "manifest-v2.webmanifest"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest['start_url'] = './mobile-v2.html?v=7'
manifest['description'] = 'Mapa político, candidaturas y escrutinio definitivo por categoría de Corrientes.'
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n', encoding="utf-8")

print('PWA patched for definitive category-specific results.')
