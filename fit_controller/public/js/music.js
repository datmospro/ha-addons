// Workout Music Player Module (Lazy-loaded to avoid telemetry console errors)
window.MusicModule = {
  init: function() {
    const select = document.getElementById('music-playlist-select');
    const iframe = document.getElementById('music-iframe');

    if (select && iframe) {
      select.addEventListener('change', (e) => {
        if (e.target.value) {
          iframe.src = e.target.value;
          iframe.style.display = 'block';
        } else {
          iframe.src = 'about:blank';
          iframe.style.display = 'none';
        }
      });
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.MusicModule.init();
});
