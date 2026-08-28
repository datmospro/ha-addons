// Workout Music Player Module
window.MusicModule = {
  init: function() {
    const select = document.getElementById('music-playlist-select');
    const iframe = document.getElementById('music-iframe');

    if (select && iframe) {
      select.addEventListener('change', (e) => {
        iframe.src = e.target.value;
      });
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.MusicModule.init();
});
