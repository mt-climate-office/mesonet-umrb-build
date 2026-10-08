#!/usr/bin/env python3
"""
Regenerate assets/og-card.png (the og:image / twitter:image social card) as a
1200x630 screenshot of the live GitHub Pages site in the light theme.

Readiness is the same signal consumer-verify.mjs uses: the sr-only table twin
fills with one row per drawn cell once the status data has rendered. The page
is then given time for basemap and hillshade tiles to settle before capture.

Usage:
    pip install playwright
    playwright install --with-deps chromium
    python scripts/generate_preview.py
"""

from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).parent.parent / "assets" / "og-card.png"
# The Pages origin, loaded directly, so regenerating the card does not depend
# on the UMT reverse proxy that serves the canonical mesonet.climate.umt.edu/umrb/.
URL = "https://mt-climate-office.github.io/mesonet-umrb-build/"
QUERY = "theme=light"
# og:image:width/height in index.html declare these exact dimensions.
WIDTH, HEIGHT = 1200, 630


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": WIDTH, "height": HEIGHT},
            device_scale_factor=1,
            color_scheme="light",  # match the forced ?theme=light
        )
        # Suppress the first-visit intro modal, which would otherwise cover the
        # map. The key is the one app.js checks before auto-opening it.
        ctx.add_init_script("localStorage.setItem('mco-status-seen-intro', '1')")
        page = ctx.new_page()

        # Surface JS errors and console warnings for debugging.
        page.on("console", lambda msg: print(f"  [{msg.type}] {msg.text}") if msg.type != "log" else None)
        page.on("pageerror", lambda err: print(f"  [pageerror] {err}"))

        print(f"Loading {URL}?{QUERY} …")
        page.goto(f"{URL}?{QUERY}", wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_function(
            "() => document.querySelectorAll('#sr-cell-rows tr').length > 200",
            timeout=60_000,
        )
        page.wait_for_load_state("networkidle", timeout=30_000)
        page.wait_for_timeout(3_000)

        page.screenshot(path=str(OUT))
        print(f"Preview saved → {OUT}")

        browser.close()


if __name__ == "__main__":
    main()
