import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000"


def log(msg):
    print(msg, flush=True)


def snapshot(page):
    return page.evaluate(
        """() => {
            const pb = document.getElementById('progressBar');
            const ll = document.querySelector('.live-line');
            const fill = document.getElementById('progressFill');
            const rootStyle = getComputedStyle(document.documentElement);
            const img = document.getElementById('albumArtImg');
            return {
                onDemand: !!window.onDemandPlaybackActive,
                bodyClass: document.body.className,
                progressBarDisplay: pb ? getComputedStyle(pb).display : null,
                progressFillWidth: fill ? fill.style.width : null,
                liveLineDisplay: ll ? getComputedStyle(ll).display : null,
                lyricsSong: document.getElementById('lyricsSong')?.textContent || '',
                lyricLines: document.querySelectorAll('#lyricsContent .lyric-line, #lyricsContent > *').length,
                c1: rootStyle.getPropertyValue('--c1').trim(),
                c3: rootStyle.getPropertyValue('--c3').trim(),
                artVisible: img ? !img.hidden && getComputedStyle(img).display !== 'none' : null,
                elapsed: document.getElementById('trackElapsed')?.textContent,
                duration: document.getElementById('trackDuration')?.textContent
            };
        }"""
    )


with sync_playwright() as p:
    browser = p.chromium.launch(
        channel="msedge",
        headless=True,
        args=["--mute-audio", "--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
    )
    page = browser.new_page(viewport={"width": 1200, "height": 900})
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_timeout(4000)

    log("LIVE_MODE = " + json.dumps(snapshot(page), indent=2))

    page.evaluate(
        """() => {
            const b = document.createElement('button');
            b.id = 'tp';
            b.addEventListener('click', () => window.startOnDemandSong({
                trackName: 'Perfect',
                artistName: 'Ed Sheeran',
                collectionName: 'Divide',
                trackTimeMillis: 264000
            }));
            document.body.appendChild(b);
        }"""
    )
    page.click("#tp")
    page.wait_for_timeout(14000)
    log("ON_DEMAND = " + json.dumps(snapshot(page), indent=2))

    # Return to live and confirm the old live bar + live lyrics come back.
    page.click("#returnToLiveButton")
    page.wait_for_timeout(6000)
    log("BACK_LIVE = " + json.dumps(snapshot(page), indent=2))

    browser.close()

sys.exit(0)