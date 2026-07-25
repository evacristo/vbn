#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests

from tooling import extract_definitive_results as core

DEPARTMENT_ALIASES = {
    "BERON DE ASTRADA": "Berón de Astrada",
    "CAPITAL": "Capital",
    "CURUZU CUATIA": "Curuzú Cuatiá",
    "GENERAL ALVEAR": "General Alvear",
    "ITATI": "Itatí",
    "ITUZAINGO": "Ituzaingó",
    "MBURUCUYA": "Mburucuyá",
    "SAN MARTIN": "San Martín",
    "SANTO TOME": "Santo Tomé",
}


def department_name(value: str) -> str:
    key = core.canonical(value)
    return DEPARTMENT_ALIASES.get(key, core.smart_title(value))


def fetch_task(task: dict) -> tuple[list[dict], dict]:
    session = requests.Session()
    session.headers.update({"User-Agent": "CorrientesTerritorialResultsBuilder/2.0", "Content-Type": "application/json"})
    body = core.request_result(session, task["payload"])
    return core.parse_result(body, task["type"], task["official"], task["display"], task["url"], task.get("id"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="election-results-2025.json")
    args = parser.parse_args()
    output = Path(args.out)

    requests.packages.urllib3.disable_warnings()  # type: ignore[attr-defined]
    session = requests.Session()
    session.headers.update({"User-Agent": "CorrientesTerritorialResultsBuilder/2.0", "Content-Type": "application/json"})
    response = session.post(f"{core.API}/api/comun/filtroTipo", json={"esEleccionProvincial": True}, timeout=120, verify=False)
    response.raise_for_status()
    filters = response.json()
    departments = next(item for item in filters if item.get("filtroTipoId") == 2).get("datos") or []
    departments = [row for row in departments if core.canonical(row.get("descripcion")) != "SIN DATOS"]
    municipalities = next(item for item in filters if item.get("filtroTipoId") == 3).get("datos") or []
    if len(departments) != 25 or len(municipalities) != 74:
        raise RuntimeError(f"Unexpected official filters: {len(departments)} departments, {len(municipalities)} municipalities")

    tasks = [{
        "type": "province",
        "official": "PROVINCIA",
        "display": "Provincia de Corrientes",
        "id": None,
        "url": core.source_url("province"),
        "payload": {"filtroTipoId": 1, "descripcion": "Provincia", "seleccionUnica": True, "valor": None, "valorDescripcion": None},
    }]
    tasks.extend({
        "type": "department",
        "official": row["descripcion"],
        "display": department_name(row["descripcion"]),
        "id": row["valor"],
        "url": f"{core.SITE}/escrutinio/departamento/{row['valor']}/{row['descripcionParaUrl']}",
        "payload": {"filtroTipoId": 2, "descripcion": "Departamento", "seleccionUnica": False, "valor": row["valor"], "valorDescripcion": row["descripcion"]},
    } for row in departments)
    tasks.extend({
        "type": "municipality",
        "official": row["descripcion"],
        "display": core.app_jurisdiction(row["descripcion"]),
        "id": row["valor"],
        "url": core.source_url("municipality", row),
        "payload": {"filtroTipoId": 3, "descripcion": "Municipio", "seleccionUnica": False, "valor": row["valor"], "valorDescripcion": row["descripcion"]},
    } for row in municipalities)

    all_rows: list[dict] = []
    jurisdictions: list[dict] = []
    errors: list[dict] = []
    with ThreadPoolExecutor(max_workers=12) as executor:
        future_map = {executor.submit(fetch_task, task): task for task in tasks}
        for future in as_completed(future_map):
            task = future_map[future]
            try:
                rows, meta = future.result()
                all_rows.extend(rows)
                jurisdictions.append(meta)
                print("OK", task["type"], task["display"], len(rows), flush=True)
            except Exception as exc:  # noqa: BLE001
                errors.append({"type": task["type"], "jurisdiction": task["display"], "error": str(exc)})
                print("ERROR", task["type"], task["display"], exc, flush=True)

    if errors:
        raise RuntimeError(json.dumps(errors, ensure_ascii=False))

    type_rank = {"province": 0, "department": 1, "municipality": 2}
    jurisdictions.sort(key=lambda row: (type_rank.get(row["jurisdictionType"], 9), row["jurisdiction"]))
    all_rows.sort(key=lambda row: (type_rank.get(row["jurisdictionType"], 9), row["jurisdiction"], row["category"], -row["percentage"], row["alliance"]))
    bad = [row for row in all_rows if row["calculationDifference"] is not None and row["calculationDifference"] > 0.011]
    lla_rows = [row for row in all_rows if core.canonical(row["alliance"]) == core.LLA]
    lla_index = {
        f"{row['jurisdictionType']}|{core.canonical(row['jurisdiction'])}|{core.canonical(row['category'])}": row
        for row in lla_rows
    }

    report = {
        "jurisdictions": len(jurisdictions),
        "departments": sum(row["jurisdictionType"] == "department" for row in jurisdictions),
        "municipalities": sum(row["jurisdictionType"] == "municipality" for row in jurisdictions),
        "allianceResults": len(all_rows),
        "llaResults": len(lla_rows),
        "llaMunicipalMayorResults": sum(row["jurisdictionType"] == "municipality" and row["category"] == "Intendente" for row in lla_rows),
        "llaMunicipalCouncilResults": sum(row["jurisdictionType"] == "municipality" and row["category"] == "Concejales" for row in lla_rows),
        "categories": sorted({row["category"] for row in all_rows}),
        "badCalculations": len(bad),
        "errors": errors,
    }
    payload = {
        "meta": {
            "title": "Escrutinio definitivo Corrientes 2025",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "electionDate": core.ELECTION_DATE,
            "sourceAuthority": "Junta Electoral de la Provincia de Corrientes",
            "sourceSite": core.SITE,
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
    output.with_suffix(".js").write_text("window.CORRIENTES_DEFINITIVE_RESULTS_2025=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    output.with_suffix(".report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
