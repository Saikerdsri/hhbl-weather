// HHBL Bike Center live camera.
// HHBL now self-hosts their stream as HLS (their server sends permissive CORS,
// so we can play it directly). Playback starts only when the card scrolls into
// view, so the ~3 Mbps stream doesn't tax every page load.

const CAM_SRC = 'https://www.hhblbikelane.com/live/hhbl/index.m3u8';

(function initCam() {
  const video = document.getElementById('cam-video');
  const offline = document.getElementById('cam-offline');
  if (!video) return;

  function camOffline() {
    video.classList.add('hidden');
    offline.classList.remove('hidden');
  }

  function start() {
    if (video.dataset.started) return;
    video.dataset.started = '1';

    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 12, liveSyncDurationCount: 3 });
      hls.loadSource(CAM_SRC);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (e, data) => {
        if (!data.fatal) return;
        // one recovery attempt for network blips, then give up gracefully
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !video.dataset.retried) {
          video.dataset.retried = '1';
          setTimeout(() => hls.startLoad(), 3000);
        } else {
          hls.destroy();
          camOffline();
        }
      });
      video.play().catch(() => {}); // muted autoplay; controls allow unmute
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari/iOS play HLS natively
      video.src = CAM_SRC;
      video.addEventListener('error', camOffline, { once: true });
      video.play().catch(() => {});
    } else {
      camOffline();
    }
  }

  new IntersectionObserver((entries, obs) => {
    if (entries.some((en) => en.isIntersecting)) {
      obs.disconnect();
      start();
    }
  }, { rootMargin: '300px' }).observe(video);
})();
