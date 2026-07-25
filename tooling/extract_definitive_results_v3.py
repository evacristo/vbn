#!/usr/bin/env python3
from __future__ import annotations

import random
import time
from concurrent.futures import ThreadPoolExecutor

import requests

from tooling import extract_definitive_results_v2 as extractor

extractor.core.JURISDICTION_ALIASES.update({
    "CAA CATI (NUESTRA SENORA DEL ROSARIO DE CAA CATI)": "Caa Cati",
    "CAROLINA (COLONIA CAROLINA)": "Carolina",
    "CIUDAD DE CORRIENTES": "Corrientes",
    "CURUZU CUATIA": "Curuzú Cuatiá",
    "LAVALLE (PUERTO LAVALLE)": "Lavalle",
    "SAN ANTONIO - ISLA APIPE GRANDE": "San Antonio Isla Apipé Grande",
})

_original_fetch = extractor.fetch_task


class LimitedThreadPoolExecutor(ThreadPoolExecutor):
    def __init__(self, max_workers=None, *args, **kwargs):
        super().__init__(max_workers=5, *args, **kwargs)


def retry_fetch(task: dict):
    last_error = None
    for attempt in range(1, 6):
        try:
            return _original_fetch(task)
        except (requests.RequestException, RuntimeError) as exc:
            last_error = exc
            if attempt == 5:
                break
            delay = min(20, 2 ** attempt) + random.random()
            print(f"RETRY {attempt}/5 {task['type']} {task['display']} in {delay:.1f}s: {exc}", flush=True)
            time.sleep(delay)
    raise last_error or RuntimeError(f"Unknown extraction failure: {task}")


extractor.fetch_task = retry_fetch
extractor.ThreadPoolExecutor = LimitedThreadPoolExecutor

if __name__ == "__main__":
    extractor.main()
