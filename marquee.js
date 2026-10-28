const marqueeText = document.getElementById('nowPlaying');
const marqueeContainer = marqueeText?.closest('.tagline');

if (marqueeText && marqueeContainer) {
  const updateMarqueeVisibility = () => {
    const firstItem = marqueeText.children[0];
    const text = firstItem?.textContent || marqueeText.textContent.trim();
    const measure = document.createElement('span');
    measure.textContent = text;
    measure.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;display:inline-block;';
    marqueeContainer.appendChild(measure);
    const shouldMarquee = measure.offsetWidth > marqueeContainer.clientWidth;
    measure.remove();

    marqueeContainer.classList.toggle('marquee', shouldMarquee);
    if (marqueeText.children.length > 1) {
      marqueeText.children[1].style.display = shouldMarquee ? '' : 'none';
    }
  };

  const renderMarquee = () => {
    const source = marqueeText.children.length === 2
      ? marqueeText.children[0].textContent
      : marqueeText.textContent;
    const text = source.trim();
    if (!text) return;
    if (marqueeText.children.length === 2 && marqueeText.dataset.marqueeText === text) return;

    marqueeText.dataset.marqueeText = text;
    marqueeText.replaceChildren(
      createMarqueeItem(text),
      createMarqueeItem(text)
    );
    marqueeText.style.animation = 'none';
    void marqueeText.offsetWidth;
    marqueeText.style.animation = '';
    requestAnimationFrame(updateMarqueeVisibility);
  };

  const restartMarquee = () => {
    marqueeText.style.animation = 'none';
    void marqueeText.offsetWidth;
    marqueeText.style.animation = '';
  };

  const marqueeObserver = new MutationObserver(renderMarquee);

  const syncOnDemandMarqueePlaybackState = () => {
    const isPaused = Boolean(
      window.onDemandPlaybackActive && window.onDemandPlaying !== true
    );
    marqueeContainer.classList.toggle('paused', isPaused);

    // CSS pseudo-element animations can outrank animation-play-state rules
    // when their animation shorthand is marked !important. Pause the actual
    // title/artist animations as well, so transport pause always takes effect.
    document.getAnimations().forEach((animation) => {
      const target = animation.effect?.target;
      if (target !== marqueeText && target?.element !== marqueeText) return;
      if (isPaused) animation.pause();
      else if (animation.playState === 'paused') animation.play();
    });
  };
  const playbackModeObserver = new MutationObserver(syncOnDemandMarqueePlaybackState);

  function createMarqueeItem(text) {
    const item = document.createElement('span');
    item.className = 'marquee-item';
    item.textContent = text;
    return item;
  }

  marqueeObserver.observe(marqueeText, {
    childList: true,
    characterData: true,
    subtree: true
  });

  renderMarquee();
  syncOnDemandMarqueePlaybackState();
  playbackModeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('thaalam:on-demand-playback-state', syncOnDemandMarqueePlaybackState);
  window.addEventListener('pageshow', restartMarquee);
  window.addEventListener('resize', updateMarqueeVisibility);
  window.addEventListener('DOMContentLoaded', updateMarqueeVisibility);
}
