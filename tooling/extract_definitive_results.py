#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import requests

API = "https://elecciones2025-api.corrientes.gob.ar"
SITE = "https://elecciones2025.corrientes.gob.ar"
ELECTION_DATE = "2025-08-31"
LLA = "LA LIBERTAD AVANZA"

JURISDICTION_ALIASES = {
    "BERON DE ASTRADA": "San Antonio de Itatí",
    "CAPITAL": "Corrientes",
    "CARLOS PELLEGRINI": "Colonia Carlos Pellegrini",
    "CONCEPCION": "Concepción del Yaguareté Corá",
    "CURUZU": "Curuzú Cuatiá",
    "MANTILLA": "Pedro R. Fernández",
    "SAN ANTONIO - APIPE GRANDE": "San Antonio Isla Apipé Grande",
    "SANTA ANA": "Santa Ana de los Guácaras",
    "SANTA ROSA": "Colonia Santa Rosa",
}


def canonical(value: str) -> str:
    normalized = unicodedata.normalize("NFD", str(value or ""))
    normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", normalized.upper()).strip()


def smart_title(value: str) -> str:
    lower = {"de", "del", "la", "las", "los", "y"}
    output = []
    for index, word in enumerate(value.lower().split()):
        output.append(word if index and word in lower else word[:1].upper() + word[1:])
    return " ".join(output)


def app_jurisdiction(value: str) -> str:
    key = canonical(value)
    return JURISDICTION_ALIASES.get(key, smart_title(value))


def source_url(kind: str, value: dict | None = None) -> str:
    if kind == "province":
        return f"{SITE}/escrutinio"
    assert value is not None
    return f"{SITE}/escrutinio/municipio/{value['valor']}/{value['descripcionParaUrl']}"


def request_result(session: requests.Session, payload: dict) -> dict:
    response = session.post(f"{API}/api/escrutinio/resultados/buscar", json=payload, timeout=120, verify=False)
    response.raise_for_status()
    body = response.json()
    if not body.get("isSuccess") or not body.get("data"):
        raise RuntimeError(f"Official results request failed: {payload} / {body.get('errors') or body.get('messages')}")
    return body


def parse_result(body: dict, jurisdiction_type: str, official_name: str, display_name: str, url: str, official_id: int | None) -> tuple[list[dict], dict]:
    data = body["data"]
    totals = {row["cargoDescripcion"]: row for row in data.get("totalVotos", [])}
    rows = []
    for alliance in data.get("alianzas", []):
        alliance_name = alliance.get("alianza") or "Sin alianza"
        for result in alliance.get("alianzaData", []) or []:
            category = result.get("titulo")
            total = totals.get(category, {})
            votes = int(result.get("votos") or 0)
            denominator = int(total.get("totalValido") or 0)
            official_percentage = float(result.get("porcentaje") or 0)
            calculated = (votes / denominator * 100) if denominator else None
            difference = abs(official_percentage - calculated) if calculated is not None else None
            rows.append({
                "jurisdictionType": jurisdiction_type,
                "jurisdiction": display_name,
                "officialJurisdiction": official_name,
                "officialJurisdictionId": official_id,
                "category": category,
                "alliance": alliance_name,
                "list": str(alliance.get("lista") or ""),
                "votes": votes,
                "percentage": round(official_percentage, 6),
                "percentageDisplayed": round(official_percentage, 2),
                "validVotes": denominator,
                "calculatedPercentage": round(calculated, 6) if calculated is not None else None,
                "calculationDifference": round(difference, 8) if difference is not None else None,
                "sourceUrl": url,
                "sourceDateTime": body.get("sourceDateTime"),
                "closed": bool(data.get("header", {}).get("estaCerrado")),
                "tables": data.get("header", {}).get("mesas"),
                "tablesCounted": data.get("header", {}).get("escrutadas"),
            })
    header = data.get("header") or {}
    metadata = {
        "jurisdictionType": jurisdiction_type,
        "jurisdiction": display_name,
        "officialJurisdiction": official_name,
        "officialJurisdictionId": official_id,
        "sourceUrl": url,
        "electors": header.get("electores"),
        "voters": header.get("votantes"),
        "tables": header.get("mesas"),
        "tablesCounted": header.get("escrutadas"),
        "closed": header.get("estaCerrado"),
        "lastSynchronization": (data.get("ultimaSincronizacion") or {}).get("fecha"),
        "validVotesByCategory": {category: int(row.get("totalValido") or 0) for category, row in totals.items()},
    }
    return rows, metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="definitive-results-2025.json")
    args = parser.parse_args()
    output = Path(args.out)

    requests.packages.urllib3.disable_warnings()  # type: ignore[attr-defined]
    session = requests.Session()
    session.headers.update({"User-Agent": "CorrientesTerritorialResultsBuilder/1.0", "Content-Type": "application/json"})

    filters_response = session.post(f"{API}/api/comun/filtroTipo", json={"esEleccionProvincial": True}, timeout=120, verify=False)
    filters_response.raise_for_status()
    filters = filters_response.json()
    municipality_filter = next(item for item in filters if item.get("filtroTipoId") == 3)
    municipalities = municipality_filter.get("datos") or []
    if len(municipalities) != 74:
        raise RuntimeError(f"Expected 74 municipalities, got {len(municipalities)}")

    all_rows: list[dict] = []
    jurisdictions: list[dict] = []
    warnings: list[str] = []

    province_payload = {"filtroTipoId": 1, "descripcion": "Provincia", "seleccionUnica": True, "valor": None, "valorDescripcion": None}
    province_body = request_result(session, province_payload)
    rows, meta = parse_result(province_body, "province", "PROVINCIA", "Provincia de Corrientes", source_url("province"), None)
    all_rows.extend(rows)
    jurisdictions.append(meta)

    for municipality in municipalities:
        payload = {
            "filtroTipoId": 3,
            "descripcion": "Municipio",
            "seleccionUnica": False,
            "valor": municipality["valor"],
            "valorDescripcion": municipality["descripcion"],
        }
        body = request_result(session, payload)
        display = app_jurisdiction(municipality["descripcion"])
        url = source_url("municipality", municipality)
        rows, meta = parse_result(body, "municipality", municipality["descripcion"], display, url, municipality["valor"])
        all_rows.extend(rows)
        jurisdictions.append(meta)

    bad_calculations = [row for row in all_rows if row["calculationDifference"] is not None and row["calculationDifference"] > 0.011]
    if bad_calculations:
        warnings.append(f"{len(bad_calculations)} rows differ by more than 0.011 percentage points from votes/validVotes")

    lla_rows = [row for row in all_rows if canonical(row["alliance"]) == LLA]
    lla_index = {}
    for row in lla_rows:
        key = f"{canonical(row['jurisdiction'])}|{canonical(row['category'])}"
        lla_index[key] = row

    categories = sorted({row["category"] for row in all_rows})
    report = {
        "jurisdictions": len(jurisdictions),
        "municipalities": len([row for row in jurisdictions if row["jurisdictionType"] == "municipality"]),
        "allianceResults": len(all_rows),
        "llaResults": len(lla_rows),
        "llaMunicipalMayorResults": len([row for row in lla_rows if row["jurisdictionType"] == "municipality" and row["category"] == "Intendente"]),
        "llaMunicipalCouncilResults": len([row for row in lla_rows if row["jurisdictionType"] == "municipality" and row["category"] == "Concejales"]),
        "categories": categories,
        "badCalculations": len(bad_calculations),
        "warnings": warnings,
    }

    payload = {
        "meta": {
            "title": "Escrutinio definitivo Corrientes 2025",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "electionDate": ELECTION_DATE,
            "sourceAuthority": "Junta Electoral de la Provincia de Corrientes",
            "sourceSite": SITE,
            "resultType": "definitive",
            "percentageDefinition": "Porcentaje de votos de la lista o alianza sobre votos válidos de la categoría en la jurisdicción.",
            "candidateInterpretation": "Las candidaturas de una misma fórmula o lista comparten el resultado electoral de esa lista; el porcentaje no es un atributo individual del candidato.",
        },
        "jurisdictions": jurisdictions,
        "results": all_rows,
        "llaResults": lla_rows,
        "llaIndex": lla_index,
        "report": report,
    }
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    Path(str(output) + ".js").write_text("window.CORRIENTES_DEFINITIVE_RESULTS_2025=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    Path(str(output) + ".report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
