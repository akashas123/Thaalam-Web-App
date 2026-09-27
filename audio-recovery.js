(() => {
  const radio = document.getElementById('radio');
  if (!radio) return;

  const retryDelays = [2000, 4000, 8000, 15000];
  let stallTimer;
  let retryTimer;
  let retryCount = 0;
  let reconnecting = false;

  function clearStallTimer() {
    clearTimeout(stallTimer);
    stallTimer = undefined;
  }

  function scheduleReconnect() {
    clearStallTimer();
    if (radio.paused || reconnecting || retryTimer) return;

    const delay = retryDelays[Math.min(retryCount, retryDelays.length - 1)];
    retryCount += 1;
    retryTimer = setTimeout(async () => {
      retryTimer = undefined;
      if (radio.paused || !navigator.onLine) return;

      reconnecting = true;
      try {
        if (typeof startLiveStream === 'function') {
          await startLiveStream();
        } else {
          radio.load();
          await radio.play();
        }
      } catch (_) {
        // The next sustained stall will schedule another attempt.
      } finally {
        reconnecting = false;
      }
    }, delay);
  }

  function watchForStall() {
    clearStallTimer();
    if (radio.paused) return;
    stallTimer = setTimeout(scheduleReconnect, 12000);
  }

  radio.addEventListener('waiting', watchForStall);
  radio.addEventListener('stalled', watchForStall);
  radio.addEventListener('playing', () => {
    clearStallTimer();
    clearTimeout(retryTimer);
    retryTimer = undefined;
    retryCount = 0;
  });
  radio.addEventListener('pause', () => {
    clearStallTimer();
    clearTimeout(retryTimer);
    retryTimer = undefined;
  });
  radio.addEventListener('error', scheduleReconnect);
  window.addEventListener('online', () => {
    if (!radio.paused && radio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      scheduleReconnect();
    }
  });
})();
