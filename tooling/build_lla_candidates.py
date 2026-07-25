#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

OFFICIAL_PAGE = "https://www.juscorrientes.gov.ar/prensa/el-juzgado-electoral-dio-a-conocer-la-lista-completa-de-candidatos-para-las-elecciones-del-31-de-agosto/"
ESQUINA_PAGE = "https://www.juscorrientes.gov.ar/prensa/elecciones-municipales-en-esquina-se-oficializaron-cinco-listas-de-candidatos/"
ALLIANCE_ID = "org-lla-corrientes"

ROLE_LABELS = {
    "governor": "Gobernador",
    "vice_governor": "Vicegobernador",
    "senator_titular": "Senador provincial titular",
    "senator_suplente": "Senador provincial suplente",
    "deputy_titular": "Diputado provincial titular",
    "deputy_suplente": "Diputado provincial suplente",
    "mayor": "Intendente",
    "vice_mayor": "Viceintendente",
    "councillor_titular": "Concejal titular",
    "councillor_suplente": "Concejal suplente",
}

ROLE_BRANCH = {
    "governor": "Ejecutivo provincial",
    "vice_governor": "Ejecutivo provincial",
    "senator_titular": "Legislatura provincial · Senado",
    "senator_suplente": "Legislatura provincial · Senado",
    "deputy_titular": "Legislatura provincial · Diputados",
    "deputy_suplente": "Legislatura provincial · Diputados",
    "mayor": "Ejecutivo municipal",
    "vice_mayor": "Ejecutivo municipal",
    "councillor_titular": "Concejo Deliberante",
    "councillor_suplente": "Concejo Deliberante",
}

ROLE_LEVEL = {
    "governor": "provincial",
    "vice_governor": "provincial",
    "senator_titular": "provincial",
    "senator_suplente": "provincial",
    "deputy_titular": "provincial",
    "deputy_suplente": "provincial",
    "mayor": "municipal",
    "vice_mayor": "municipal",
    "councillor_titular": "municipal",
    "councillor_suplente": "municipal",
}

ROLE_PATTERN = re.compile(
    r"VICE\s*-?\s*GOBERNADOR|"
    r"SENADORES?\s+TITULARES|SENADORES?\s+SUPLENTES|"
    r"DIPUTAD(?:OS|ORES)\s+TITULARES|DIPUTAD(?:OS|ORES)\s+SUPLENTES|"
    r"VICE\s*INTENDENTE|VICEINTENDENTE|"
    r"CONCEJALES?\s+TITULARES|CONCEJALES?\s+SUPLENTES|"
    r"GOBERNADOR|INTENDENTE",
    re.IGNORECASE,
)


def canonical(value: str) -> str:
    table = str.maketrans({
        "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n",
        "Á": "A", "É": "E", "Í": "I", "Ó": "O", "Ú": "U", "Ü": "U", "Ñ": "N",
        "–": "-", "—": "-", "−": "-", "º": "°", "ª": "a", "\u00ad": "",
    })
    return value.translate(table).upper()


def slug(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()
    return normalized or "sin-id"


def clean_pdf_text(text: str) -> str:
    text = text.replace("\u00ad", "").replace("\x0c", "\n")
    text = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def smart_title(value: str) -> str:
    lower_words = {"de", "del", "la", "las", "los", "y", "da", "do", "dos"}
    words = []
    for index, word in enumerate(value.lower().split()):
        parts = re.split(r"([-'])", word)
        rendered = "".join(
            part if part in {"-", "'"} else (part if index > 0 and part in lower_words else part[:1].upper() + part[1:])
            for part in parts
        )
        words.append(rendered)
    return " ".join(words)


def candidate_name(raw: str) -> dict | None:
    raw = raw.strip(" ;,.-")
    raw = re.sub(r"^(?:Y\s+)?(?:A\s+LOS?\s+SRES?\.?|A\s+LAS?\s+SRAS?\.?|AL\s+SR\.?|A\s+LA\s+SRA\.?|A|LOS?\s+SRES?\.?)\s*:?[ ]*", "", raw, flags=re.I)
    raw = re.sub(r"\b(?:D\s*\.?\s*N\s*\.?\s*I\.?|DNI|M\s*\.?\s*I\.?)\s*(?:N\s*[°º.]*)?\s*[\d.]+.*$", "", raw, flags=re.I)
    raw = re.sub(r"\b(?:N\s*[°º.]*)\s*[\d.]+.*$", "", raw, flags=re.I)
    raw = re.sub(r"(?:;|,)?\s*(?:Y|PARA\s+LA\s+CATEGOR[IÍ]A\s+DE)\s*$", "", raw, flags=re.I)
    raw = raw.strip(" ;,.-")
    if not raw or len(raw) < 4 or re.search(r"REG[IÍ]STRESE|INS[EÉ]RTESE|NOTIF[IÍ]QUESE", raw, re.I):
        return None

    aliases = []
    for match in re.findall(r"[\"“”']([^\"“”']{2,40})[\"“”']", raw):
        aliases.append(smart_title(match.strip()))
    without_aliases = re.sub(r"[\"“”'][^\"“”']{2,40}[\"“”']", "", raw)
    without_aliases = re.sub(r"\b(?:SR|SRA|DR|DRA)\.?\b", "", without_aliases, flags=re.I)
    without_aliases = re.sub(r"\s+", " ", without_aliases).strip(" ;,.-")

    official_name = without_aliases
    display = without_aliases
    if display.count(",") == 1:
        surname, given = [part.strip() for part in display.split(",", 1)]
        if surname and given:
            display = f"{given} {surname}"
    display = smart_title(display)
    if not re.search(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]", display):
        return None
    return {
        "name": display,
        "officialName": official_name,
        "aliases": sorted(set(aliases)),
    }


def role_key(marker: str) -> str | None:
    value = canonical(marker)
    if "VICE" in value and "GOBERNADOR" in value:
        return "vice_governor"
    if value == "GOBERNADOR":
        return "governor"
    if "SENADOR" in value and "TITULAR" in value:
        return "senator_titular"
    if "SENADOR" in value and "SUPLENTE" in value:
        return "senator_suplente"
    if "DIPUT" in value and "TITULAR" in value:
        return "deputy_titular"
    if "DIPUT" in value and "SUPLENTE" in value:
        return "deputy_suplente"
    if "VICE" in value and "INTENDENTE" in value:
        return "vice_mayor"
    if value == "INTENDENTE":
        return "mayor"
    if "CONCEJAL" in value and "TITULAR" in value:
        return "councillor_titular"
    if "CONCEJAL" in value and "SUPLENTE" in value:
        return "councillor_suplente"
    return None


def split_candidates(block: str) -> list[tuple[int | None, str]]:
    block = re.sub(r"^\s*(?:A\s+LOS?\s+SRES?\.?|A\s+LAS?\s+SRAS?\.?|AL\s+SR\.?|A\s+LA\s+SRA\.?|A)\s*:?[ ]*", "", block, flags=re.I)
    block = re.sub(r"(?:;|,)?\s*(?:Y|PARA\s+LA\s+CATEGOR[IÍ]A\s+DE)\s*$", "", block, flags=re.I).strip()
    numbered = list(re.finditer(r"(?<!\d)(\d{1,2})\)\s*", block))
    output: list[tuple[int | None, str]] = []
    if numbered:
        for index, match in enumerate(numbered):
            end = numbered[index + 1].start() if index + 1 < len(numbered) else len(block)
            output.append((int(match.group(1)), block[match.end():end]))
    else:
        output.append((1, block))
    return output


def resolution_meta(full_text: str, section_start: int) -> tuple[str | None, str | None]:
    prefix = full_text[max(0, section_start - 1400):section_start]
    resolution_matches = list(re.finditer(r"N\s*[.°º]*\s*(\d{1,6})\s+Corrientes", prefix, flags=re.I))
    exp_matches = list(re.finditer(r"EXP\s*[-–]?\s*(\d{5,9}/25)", prefix, flags=re.I))
    resolution = resolution_matches[-1].group(1) if resolution_matches else None
    exp = exp_matches[-1].group(1) if exp_matches else None
    return resolution, exp


def parse_lla_sections(text: str, jurisdiction: str, source_url: str, election_date: str) -> tuple[list[dict], list[str]]:
    canonical_text = canonical(text)
    starts = list(re.finditer(r"1\s*[°º]\s*\)\s*OFICIALIZAR\s+LA\s+NOMINACION\s+DE\s+CANDIDATOS", canonical_text, flags=re.I))
    parsed: list[dict] = []
    warnings: list[str] = []

    for start_match in starts:
        start = start_match.start()
        end_match = re.search(r"\s2\s*[°º]\s*\)\s*(?:REGISTRESE|NOTIFIQUESE)", canonical_text[start:], flags=re.I)
        end = start + end_match.start() if end_match else min(len(text), start + 14000)
        section = text[start:end]
        section_canonical = canonical(section)
        if "LA LIBERTAD AVANZA" not in section_canonical:
            continue

        election_anchor = section_canonical.find("PARA LAS ELECCIONES")
        category_anchor = section_canonical.find("CATEGORIA", election_anchor if election_anchor >= 0 else 0)
        scan_start = category_anchor if category_anchor >= 0 else 0
        matches = list(ROLE_PATTERN.finditer(section_canonical, scan_start))
        if not matches:
            warnings.append(f"{jurisdiction}: sección LLA sin categorías reconocibles")
            continue

        resolution, exp = resolution_meta(text, start)
        for index, match in enumerate(matches):
            key = role_key(match.group(0))
            if not key:
                continue
            block_end = matches[index + 1].start() if index + 1 < len(matches) else len(section)
            block = section[match.end():block_end]
            for order, candidate_raw in split_candidates(block):
                candidate = candidate_name(candidate_raw)
                if not candidate:
                    continue
                parsed.append({
                    **candidate,
                    "roleKey": key,
                    "office": ROLE_LABELS[key],
                    "branch": ROLE_BRANCH[key],
                    "level": ROLE_LEVEL[key],
                    "listType": "suplente" if key.endswith("suplente") else "titular",
                    "order": order,
                    "jurisdiction": jurisdiction,
                    "electionDate": election_date,
                    "alliance": "La Libertad Avanza",
                    "sourceUrl": source_url,
                    "sourceResolution": resolution,
                    "sourceExpediente": exp,
                })

    deduped: dict[tuple, dict] = {}
    for item in parsed:
        key = (slug(item["name"]), item["roleKey"], slug(item["jurisdiction"]), item.get("order"))
        deduped[key] = item
    return list(deduped.values()), warnings


def download(session: requests.Session, url: str, path: Path) -> None:
    response = session.get(url, timeout=90, verify=False)
    response.raise_for_status()
    path.write_bytes(response.content)


def build(site: Path) -> dict:
    work = site / ".candidate-build"
    work.mkdir(exist_ok=True)
    session = requests.Session()
    session.headers.update({"User-Agent": "CorrientesTerritorialDataBuilder/1.0"})
    requests.packages.urllib3.disable_warnings()  # type: ignore[attr-defined]

    page_response = session.get(OFFICIAL_PAGE, timeout=90, verify=False)
    page_response.raise_for_status()
    soup = BeautifulSoup(page_response.text, "html.parser")

    pdf_links: list[tuple[str, str]] = []
    for anchor in soup.find_all("a", href=True):
        href = urljoin(OFFICIAL_PAGE, anchor["href"])
        label = " ".join(anchor.get_text(" ", strip=True).split())
        if "/wp-content/uploads/prensa/pdf/2025/" not in href or not href.lower().endswith(".pdf"):
            continue
        if not re.match(r"^\d+\s*[–-]\s*", label):
            continue
        jurisdiction = re.sub(r"^\d+\s*[–-]\s*", "", label).strip()
        jurisdiction = re.sub(r"\s*\(1\)\s*$", "", jurisdiction).strip()
        if jurisdiction.upper().startswith("PROVINCIA"):
            jurisdiction = "Provincia de Corrientes"
        pdf_links.append((jurisdiction, href))

    seen_urls = set()
    pdf_links = [(j, u) for j, u in pdf_links if not (u in seen_urls or seen_urls.add(u))]
    if len(pdf_links) < 70:
        raise RuntimeError(f"Se esperaban al menos 70 PDFs oficiales; se encontraron {len(pdf_links)}")

    all_candidates: list[dict] = []
    warnings: list[str] = []
    coverage: list[dict] = []

    for index, (jurisdiction, url) in enumerate(pdf_links):
        pdf_path = work / f"{index:02d}-{slug(jurisdiction)}.pdf"
        txt_path = pdf_path.with_suffix(".txt")
        download(session, url, pdf_path)
        subprocess.run(["pdftotext", "-layout", str(pdf_path), str(txt_path)], check=True)
        text = clean_pdf_text(txt_path.read_text(encoding="utf-8", errors="replace"))
        election_date = "2025-08-31"
        candidates, local_warnings = parse_lla_sections(text, jurisdiction, url, election_date)
        warnings.extend(local_warnings)
        all_candidates.extend(candidates)
        if jurisdiction != "Provincia de Corrientes":
            coverage.append({
                "jurisdiction": jurisdiction,
                "electionDate": election_date,
                "hasOfficialLLAList": bool(candidates),
                "candidateCount": len(candidates),
                "sourceUrl": url,
                "status": "lista_oficial_encontrada" if candidates else "sin_lista_lla_en_pdf_oficial",
            })

    coverage.append({
        "jurisdiction": "Esquina",
        "electionDate": "2025-10-26",
        "hasOfficialLLAList": False,
        "candidateCount": 0,
        "sourceUrl": ESQUINA_PAGE,
        "status": "sin_lista_lla_entre_las_cinco_listas_oficializadas",
    })

    people_by_key: dict[str, dict] = {}
    nominations: list[dict] = []
    nomination_keys = set()

    for item in sorted(all_candidates, key=lambda row: (row["level"], row["jurisdiction"], row["branch"], row.get("order") or 99, row["name"])):
        person_key = slug(item["name"])
        person_id = f"person-{person_key}"
        if person_key not in people_by_key:
            people_by_key[person_key] = {
                "id": person_id,
                "name": item["name"],
                "officialName": item["officialName"],
                "aliases": item["aliases"],
                "sourceType": "resolucion_electoral_oficial",
            }
        else:
            people_by_key[person_key]["aliases"] = sorted(set(people_by_key[person_key]["aliases"] + item["aliases"]))

        nomination_key = (person_id, item["roleKey"], item["jurisdiction"], item.get("order"), item["sourceUrl"])
        if nomination_key in nomination_keys:
            continue
        nomination_keys.add(nomination_key)
        nomination_id = "nom-" + hashlib.sha1("|".join(map(str, nomination_key)).encode("utf-8")).hexdigest()[:12]
        nominations.append({
            "id": nomination_id,
            "personId": person_id,
            "office": item["office"],
            "roleKey": item["roleKey"],
            "branch": item["branch"],
            "level": item["level"],
            "listType": item["listType"],
            "order": item.get("order"),
            "jurisdiction": item["jurisdiction"],
            "electionDate": item["electionDate"],
            "allianceId": ALLIANCE_ID,
            "alliance": item["alliance"],
            "status": "candidatura_oficializada",
            "verificationStatus": "fuente_oficial_extraccion_automatizada",
            "sourceUrl": item["sourceUrl"],
            "sourceResolution": item.get("sourceResolution"),
            "sourceExpediente": item.get("sourceExpediente"),
        })

    people = sorted(people_by_key.values(), key=lambda row: row["name"])
    relationships: list[dict] = []
    for person in people:
        relationships.append({
            "id": f"rel-{person['id']}-lla",
            "from": person["id"],
            "to": ALLIANCE_ID,
            "type": "candidato_de",
            "source": "derivado_de_candidatura_oficial",
        })
    for nomination in nominations:
        list_id = f"list-lla-{slug(nomination['jurisdiction'])}-{slug(nomination['branch'])}"
        relationships.append({
            "id": f"rel-{nomination['id']}-list",
            "from": nomination["personId"],
            "to": list_id,
            "type": "integra_lista",
            "office": nomination["office"],
            "order": nomination["order"],
            "source": nomination["sourceUrl"],
        })

    grouped = defaultdict(dict)
    for nomination in nominations:
        grouped[(nomination["jurisdiction"], nomination["electionDate"])][nomination["roleKey"]] = nomination
    for (jurisdiction, election_date), group in grouped.items():
        for lead_key, vice_key in (("governor", "vice_governor"), ("mayor", "vice_mayor")):
            if lead_key in group and vice_key in group:
                lead = group[lead_key]
                vice = group[vice_key]
                relationships.append({
                    "id": f"rel-formula-{slug(jurisdiction)}-{vice['personId']}-{lead['personId']}",
                    "from": vice["personId"],
                    "to": lead["personId"],
                    "type": "integra_formula_con",
                    "jurisdiction": jurisdiction,
                    "electionDate": election_date,
                    "source": lead["sourceUrl"],
                })

    organizations = [{
        "id": ALLIANCE_ID,
        "name": "La Libertad Avanza · Corrientes",
        "type": "alianza_electoral",
        "level": "provincial",
    }]
    list_nodes = {}
    for nomination in nominations:
        list_id = f"list-lla-{slug(nomination['jurisdiction'])}-{slug(nomination['branch'])}"
        list_nodes[list_id] = {
            "id": list_id,
            "name": f"LLA · {nomination['branch']} · {nomination['jurisdiction']}",
            "type": "lista_electoral",
            "jurisdiction": nomination["jurisdiction"],
            "branch": nomination["branch"],
            "electionDate": nomination["electionDate"],
            "parentOrganizationId": ALLIANCE_ID,
        }
    organizations.extend(sorted(list_nodes.values(), key=lambda row: row["name"]))

    municipal_with_list = sum(1 for row in coverage if row["hasOfficialLLAList"])
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "officialPage": OFFICIAL_PAGE,
        "municipalitiesReviewed": len(coverage),
        "municipalitiesWithLLAList": municipal_with_list,
        "people": len(people),
        "nominations": len(nominations),
        "relationships": len(relationships),
        "warnings": warnings,
    }
    if len(people) < 50 or len(nominations) < 60:
        raise RuntimeError(f"La extracción produjo pocos registros: {report}")

    data = {
        "meta": {
            "title": "Candidaturas La Libertad Avanza · Corrientes 2025",
            "generatedAt": report["generatedAt"],
            "electionDates": ["2025-08-31", "2025-10-26"],
            "sourcePage": OFFICIAL_PAGE,
            "sourceAuthority": "Juzgado Electoral de la Provincia de Corrientes",
            "scope": "Candidaturas provinciales y municipales oficializadas; incluye intendentes, viceintendentes, senadores, diputados y concejales titulares y suplentes.",
            "privacy": "Los números de documento fueron excluidos deliberadamente.",
            "verificationNote": "Extracción automatizada de resoluciones oficiales. Cada registro conserva su enlace de fuente para control humano antes de formular conclusiones sensibles.",
        },
        "organizations": organizations,
        "people": people,
        "nominations": nominations,
        "relationships": relationships,
        "coverage": sorted(coverage, key=lambda row: row["jurisdiction"]),
        "report": report,
    }

    (site / "lla-candidates-2025.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    (site / "lla-candidates-2025.js").write_text(
        "window.LLA_CANDIDATES_2025=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    (site / "lla-candidates-2025-report.txt").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return data


def patch_site(site: Path) -> None:
    page = site / "mobile-v2.html"
    text = page.read_text(encoding="utf-8")
    scripts = '<script src="lla-candidates-2025.js?v=1"></script>\n<script src="network-lla.js?v=1"></script>\n'
    if "network-lla.js" not in text:
        text = text.replace("</body>", scripts + "</body>")
    text = text.replace("Versión móvil local · sin caché anterior", "Mapa local · candidatos LLA 2025 incorporados")
    page.write_text(text, encoding="utf-8")

    fixer = site / "fix-mobile-map.html"
    if fixer.exists():
        fixer_text = fixer.read_text(encoding="utf-8")
        fixer_text = re.sub(r"mobile-v2\.html\?v=\d+", "mobile-v2.html?v=5", fixer_text)
        fixer.write_text(fixer_text, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", required=True, type=Path)
    args = parser.parse_args()
    site = args.site.resolve()
    data = build(site)
    patch_site(site)
    print(json.dumps(data["report"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
