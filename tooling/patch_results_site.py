#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

site = Path(sys.argv[1])
html_path = site / "mobile-v2.html"
html = html_path.read_text(encoding="utf-8")

html = html.replace('manifest-v2.webmanifest?v=6', 'manifest-v2.webmanifest?v=7')
if '<link rel="stylesheet" href="results-suite.css?v=1">' not in html:
    style_anchor = '<link rel="stylesheet" href="intelligence-suite.css?v=1">'
    if style_anchor not in html:
        raise SystemExit('Intelligence stylesheet anchor not found')
    html = html.replace(style_anchor, style_anchor + '\n<link rel="stylesheet" href="results-suite.css?v=1">')

for status in (
    'Mapa local · candidatos LLA 2025 incorporados',
    'Suite territorial · base LLA 2025 incorporada',
):
    html = html.replace(status, 'Escrutinio definitivo 2025 · resultados por lista y categoría')

old_select = '<select id="contest"><option value="2023-runoff">Balotaje presidencial 2023 · LLA</option><option value="2025-deputies">Diputados nacionales 2025 · LLA</option><option value="2025-mayor">Intendencia 2025 · LLA</option></select>'
new_select = '<select id="contest"><option value="2025-governor">Provinciales 2025 · Gobernador</option><option value="2025-senators">Provinciales 2025 · Senadores</option><option value="2025-deputies-provincial">Provinciales 2025 · Diputados</option><option value="2025-mayor">Municipales 2025 · Intendente</option><option value="2025-councillors">Municipales 2025 · Concejales</option></select>'
if old_select not in html and new_select not in html:
    raise SystemExit('Expected map contest selector was not found')
html = html.replace(old_select, new_select)

legacy_results = "const results={'2023-runoff':{type:'department',rows:{'capital':64.22,'empedrado':50.47,'bella vista':46.51,'san martin':46.68,'saladas':41.34,'san miguel':31.85}},'2025-deputies':{type:'department',rows:{'capital':40.83}},'2025-mayor':{type:'municipality',rows:{'monte caseros':14.87}}};"
if legacy_results in html:
    html = html.replace(legacy_results, 'const results={};', 1)
elif 'const results={};' not in html:
    raise SystemExit('Legacy map result block was not found')

legacy_state = "const state={level:'departments',contest:'2023-runoff'};"
if legacy_state in html:
    html = html.replace(legacy_state, "const state={level:'departments',contest:'2025-governor'};", 1)
elif "const state={level:'departments',contest:'2025-governor'};" not in html:
    raise SystemExit('Legacy map state was not found')

legacy_norm = "const norm=s=>(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().trim();"
verified_norm = "const norm=s=>(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\\s+/g,' ').trim();"
if legacy_norm in html:
    html = html.replace(legacy_norm, verified_norm, 1)
elif verified_norm not in html:
    raise SystemExit('Map normalizer fragment was not found')

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

suite_path = site / 'results-suite.js'
suite = suite_path.read_text(encoding='utf-8')
old_normalizer = ".toUpperCase().replace(/\\s+/g, ' ').trim()"
new_normalizer = ".toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\\s+/g, ' ').trim()"
if old_normalizer in suite:
    suite = suite.replace(old_normalizer, new_normalizer, 1)
elif new_normalizer not in suite:
    raise SystemExit('Result normalizer fragment not found')
suite_path.write_text(suite, encoding='utf-8')

fix_path = site / "fix-mobile-map.html"
fix = fix_path.read_text(encoding="utf-8")
for version in ('5', '6'):
    fix = fix.replace(f'mobile-v2.html?v={version}', 'mobile-v2.html?v=7')
fix = fix.replace('Actualizando el mapa móvil', 'Actualizando resultados electorales')
fix = fix.replace('Caché eliminado. Abriendo el mapa…', 'Caché eliminado. Abriendo resultados verificados…')
fix_path.write_text(fix, encoding="utf-8")

manifest_path = site / "manifest-v2.webmanifest"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest['start_url'] = './mobile-v2.html?v=7'
manifest['description'] = 'Mapa político, candidaturas y escrutinio definitivo por categoría de Corrientes.'
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n', encoding="utf-8")

print('PWA patched for definitive category-specific results.')
