#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from playwright.sync_api import sync_playwright

PAGES = [
    "https://elecciones2025.corrientes.gob.ar/escrutinio",
    "https://elecciones2025.corrientes.gob.ar/escrutinio/municipio/2/9-de-julio",
    "https://elecciones2025.corrientes.gob.ar/escrutinio/municipio/45/ramada-paso",
]


def main() -> None:
    out = Path("official-request-capture")
    out.mkdir(exist_ok=True)
    records: list[dict] = []
    pages: list[dict] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1100}, locale="es-AR", ignore_https_errors=True)
        page = context.new_page()

        def capture(request):
            if "elecciones2025-api.corrientes.gob.ar" not in request.url:
                return
            records.append({
                "url": request.url,
                "method": request.method,
                "postData": request.post_data,
                "postDataJSON": request.post_data_json if request.post_data else None,
                "headers": {key: value for key, value in request.headers.items() if key.lower() in {"content-type", "referer", "origin"}},
            })

        page.on("request", capture)
        for url in PAGES:
            entry = {"url": url}
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=120_000)
                page.wait_for_timeout(15_000)
                entry["finalUrl"] = page.url
                entry["title"] = page.title()
                entry["bodyText"] = page.locator("body").inner_text(timeout=30_000)[:20000]
            except Exception as exc:  # noqa: BLE001
                entry["error"] = str(exc)
            pages.append(entry)
        browser.close()

    payload = {"requests": records, "pages": pages}
    (out / "requests.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"requestCount": len(records), "postRequests": sum(1 for row in records if row["method"] == "POST")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
