#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

BASE = "https://elecciones2025.corrientes.gob.ar/"
PAGES = [
    BASE,
    urljoin(BASE, "escrutinio"),
    urljoin(BASE, "escrutinio/municipio/2/9-de-julio"),
    urljoin(BASE, "escrutinio/municipio/45/ramada-paso"),
]


def safe_name(url: str, suffix: str = "") -> str:
    parsed = urlparse(url)
    stem = re.sub(r"[^a-zA-Z0-9._-]+", "-", f"{parsed.netloc}{parsed.path}").strip("-") or "root"
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return f"{stem}-{digest}{suffix}"


def static_audit(out: Path) -> dict:
    session = requests.Session()
    session.headers.update({"User-Agent": "CorrientesTerritorialAudit/1.0"})
    response = session.get(BASE, timeout=90, verify=False)
    response.raise_for_status()
    (out / "index-source.html").write_text(response.text, encoding="utf-8")
    soup = BeautifulSoup(response.text, "html.parser")
    assets = []
    for tag, attr in [("script", "src"), ("link", "href")]:
        for node in soup.find_all(tag):
            value = node.get(attr)
            if not value:
                continue
            url = urljoin(BASE, value)
            if urlparse(url).netloc != urlparse(BASE).netloc:
                continue
            assets.append(url)
    assets = sorted(set(assets))
    endpoint_hits = []
    downloaded = []
    asset_dir = out / "assets"
    asset_dir.mkdir(exist_ok=True)
    endpoint_pattern = re.compile(r"(?:https?://[^\"'\s)]+|/[a-zA-Z0-9_.~!$&()*+,;=:@%/-]*(?:api|escrutinio|resultado|cargo|municipio|departamento|circuito|mesa)[a-zA-Z0-9_.~!$&()*+,;=:@%/?-]*)", re.I)
    for url in assets:
        try:
            item = session.get(url, timeout=90, verify=False)
            item.raise_for_status()
            body = item.text
            path = asset_dir / safe_name(url, ".txt")
            path.write_text(body, encoding="utf-8", errors="replace")
            downloaded.append({"url": url, "status": item.status_code, "bytes": len(item.content), "file": str(path.relative_to(out))})
            if url.lower().endswith(".js") or "javascript" in item.headers.get("content-type", ""):
                for match in endpoint_pattern.findall(body):
                    if len(match) > 4:
                        endpoint_hits.append({"asset": url, "value": match[:500]})
        except Exception as exc:  # noqa: BLE001
            downloaded.append({"url": url, "error": str(exc)})
    result = {"assets": downloaded, "endpointHits": endpoint_hits[:5000]}
    (out / "static-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def browser_audit(out: Path) -> dict:
    network_dir = out / "network"
    network_dir.mkdir(exist_ok=True)
    results = {"pages": [], "responses": [], "console": [], "errors": []}
    seen_bodies: set[str] = set()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1440, "height": 1100},
            locale="es-AR",
            ignore_https_errors=True,
        )
        page = context.new_page()
        page.on("console", lambda msg: results["console"].append({"type": msg.type, "text": msg.text}))
        page.on("pageerror", lambda exc: results["errors"].append(str(exc)))

        def capture(response):
            content_type = response.headers.get("content-type", "")
            url = response.url
            record = {"url": url, "status": response.status, "contentType": content_type}
            interesting = (
                "json" in content_type.lower()
                or any(token in url.lower() for token in ("api", "result", "escrutinio", "cargo", "municip", "depart", "circuit", "mesa"))
            )
            if interesting:
                try:
                    body = response.body()
                    digest = hashlib.sha256(body).hexdigest()
                    record["bytes"] = len(body)
                    record["sha256"] = digest
                    if body and digest not in seen_bodies:
                        seen_bodies.add(digest)
                        ext = ".json" if "json" in content_type.lower() else ".bin"
                        filename = safe_name(url, ext)
                        (network_dir / filename).write_bytes(body)
                        record["file"] = str((network_dir / filename).relative_to(out))
                except Exception as exc:  # noqa: BLE001
                    record["bodyError"] = str(exc)
            results["responses"].append(record)

        page.on("response", capture)

        for index, url in enumerate(PAGES):
            entry = {"url": url}
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=120_000)
                page.wait_for_timeout(12_000)
                entry["title"] = page.title()
                entry["finalUrl"] = page.url
                entry["bodyText"] = page.locator("body").inner_text(timeout=30_000)[:100_000]
                entry["selects"] = page.locator("select").evaluate_all(
                    "els => els.map((el, i) => ({i, id: el.id, name: el.name, value: el.value, options: [...el.options].map(o => ({value:o.value,text:o.text,selected:o.selected}))}))"
                )
                entry["buttons"] = page.locator("button").evaluate_all(
                    "els => els.map((el, i) => ({i, id: el.id, text: el.innerText, aria: el.getAttribute('aria-label')}))"
                )
                entry["links"] = page.locator("a").evaluate_all(
                    "els => els.map(el => ({text:el.innerText,href:el.href})).filter(x => x.href)"
                )
                entry["resources"] = page.evaluate(
                    "performance.getEntriesByType('resource').map(r => ({name:r.name, initiatorType:r.initiatorType, duration:r.duration}))"
                )
                html = page.content()
                (out / f"page-{index}.html").write_text(html, encoding="utf-8")
                page.screenshot(path=str(out / f"page-{index}.png"), full_page=True)
            except Exception as exc:  # noqa: BLE001
                entry["error"] = str(exc)
            results["pages"].append(entry)

        browser.close()

    (out / "browser-audit.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="official-results-audit")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    requests.packages.urllib3.disable_warnings()  # type: ignore[attr-defined]
    static = static_audit(out)
    browser = browser_audit(out)
    summary = {
        "base": BASE,
        "staticAssets": len(static.get("assets", [])),
        "endpointHits": len(static.get("endpointHits", [])),
        "responses": len(browser.get("responses", [])),
        "capturedBodies": len(list((out / "network").glob("*"))),
        "errors": browser.get("errors", []),
    }
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
