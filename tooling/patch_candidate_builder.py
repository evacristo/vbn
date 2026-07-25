#!/usr/bin/env python3
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')

replacements = [
    (
        r'(?:A\s+LOS?\s+SRES?\.?|A\s+LAS?\s+SRAS?\.?|AL\s+SR\.?|A\s+LA\s+SRA\.?|A|LOS?\s+SRES?\.?)',
        r'(?:A\s+LOS?\s+SRES?\.?|A\s+LAS?\s+SRAS?\.?|AL\s+SR\.?|A\s+LA\s+SRA\.?|LOS?\s+SRES?\.?)',
    ),
    (
        r'(?:A\s+LOS?\s+SRES?\.?|A\s+LAS?\s+SRAS?\.?|AL\s+SR\.?|A\s+LA\s+SRA\.?|A)',
        r'(?:A\s+LOS?\s+SRES?\.?|A\s+LAS?\s+SRAS?\.?|AL\s+SR\.?|A\s+LA\s+SRA\.?)',
    ),
    (
        'end_match = re.search(r"\\s2\\s*[°º]\\s*\\)\\s*(?:REGISTRESE|NOTIFIQUESE)", canonical_text[start:], flags=re.I)',
        'end_match = re.search(r"\\s[2-9]\\s*[°º]\\s*\\)", canonical_text[start:], flags=re.I)',
    ),
    (
        '    raw = raw.strip(" ;,.-")\n    raw = re.sub(r"^(?:Y\\s+)?',
        '    raw = raw.strip(" ;,.-")\n    raw = re.sub(r"^a\\s*:?\\s*", "", raw)\n    raw = re.sub(r"^(?:Y\\s+)?',
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f'Expected parser fragment not found: {old}')
    text = text.replace(old, new, 1)

old_jurisdiction = '''        jurisdiction = re.sub(r"^\\d+\\s*[–-]\\s*", "", label).strip()
        jurisdiction = re.sub(r"\\s*\\(1\\)\\s*$", "", jurisdiction).strip()
        if jurisdiction.upper().startswith("PROVINCIA"):
            jurisdiction = "Provincia de Corrientes"
'''
new_jurisdiction = '''        jurisdiction = re.sub(r"^\\d+\\s*[–-]\\s*", "", label).strip()
        jurisdiction = re.sub(r"\\s*\\(1\\)\\s*$", "", jurisdiction).strip()
        if jurisdiction.upper().startswith("PROVINCIA"):
            jurisdiction = "Provincia de Corrientes"
        else:
            jurisdiction_aliases = {
                "BERON DE ASTRADA": "San Antonio de Itatí",
                "CAPITAL": "Corrientes",
                "CARLOS PELLEGRINI": "Colonia Carlos Pellegrini",
                "CONCEPCION": "Concepción del Yaguareté Corá",
                "CURUZU": "Curuzú Cuatiá",
                "FELIPE YOFRE": "Felipe Yofré",
                "ITUZAINGO": "Ituzaingó",
                "MANTILLA": "Pedro R. Fernández",
                "SAN ANTONIO - APIPE GRANDE": "San Antonio Isla Apipé Grande",
                "SANTA ANA": "Santa Ana de los Guácaras",
                "SANTA ROSA": "Colonia Santa Rosa",
                "SANTO TOME": "Santo Tomé",
            }
            jurisdiction = jurisdiction_aliases.get(canonical(jurisdiction), smart_title(jurisdiction))
'''
if old_jurisdiction not in text:
    raise SystemExit('Expected jurisdiction block not found')
text = text.replace(old_jurisdiction, new_jurisdiction, 1)

path.write_text(text, encoding='utf-8')
print('Candidate builder patched successfully.')
