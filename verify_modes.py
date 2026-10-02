import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000"


def log(msg):
    print(msg, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(
        channel="msedge",
        headless=True,
        args=["--mute-audio", "--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
    )
    page = browser.new_page(viewport={"width": 1200, "height": 800})
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_timeout(3500)

    def state():
        return page.evaluate(
            """() => {
                const pb = document.getElementById('progressBar');
                const ll = document.querySelector('.live-line');
                const lt = document.querySelector('.live-text');
                const fill = document.getElementById('progressFill');
                return {
                    onDemand: !!window.onDemandPlaybackActive,
                    progressBarDisplay: pb ? getComputedStyle(pb).display : null,
                    progressFillWidth: fill ? fill.style.width : null,
                    liveLineDisplay: ll ? getComputedStyle(ll).display : null,
                    liveText: lt ? lt.textContent.trim() : null,
                    liveTextDisplay: lt ? getComputedStyle(lt).display : null
                };
            }"""
        )

    log("LIVE MODE   -> " + str(state()))

    page.evaluate(
        """() => {
            const b = document.createElement('button');
            b.id = 'tp';
            b.addEventListener('click', () => window.startOnDemandSong({
                trackName: 'Perfect', artistName: 'Ed Sheeran', trackTimeMillis: 264000
            }));
            document.body.appendChild(b);
        }"""
    )
    page.click("#tp")
    page.wait_for_timeout(11000)
    log("ON-DEMAND   -> " + str(state()))

    browser.close()

sys.exit(0)