// Workout Music Player Module (Privacy-enhanced with youtube-nocookie to prevent Error 153 & adblock issues)
window.MusicModule = {
  init: function() {
    const select = document.getElementById('music-playlist-select');
    const iframe = document.getElementById('music-iframe');
    const customInput = document.getElementById('music-custom-url');
    const btnCustom = document.getElementById('btn-play-custom-music');

    if (select && iframe) {
      select.addEventListener('change', (e) => {
        this.playUrl(e.target.value);
      });
    }

    if (btnCustom && customInput) {
      btnCustom.addEventListener('click', () => {
        this.playUrl(customInput.value);
      });
    }
  },

  formatEmbedUrl: function(rawUrl) {
    if (!rawUrl || !rawUrl.trim()) return '';
    let url = rawUrl.trim();

    // Convert standard youtube / music.youtube / youtu.be to youtube-nocookie.com/embed/
    if (url.includes('youtube.com/playlist') || url.includes('music.youtube.com/playlist')) {
      const match = url.match(/[?&]list=([^&]+)/);
      if (match && match[1]) {
        return `https://www.youtube-nocookie.com/embed/videoseries?list=${match[1]}`;
      }
    } else if (url.includes('youtu.be/')) {
      const id = url.split('youtu.be/')[1].split('?')[0];
      return `https://www.youtube-nocookie.com/embed/${id}`;
    } else if (url.includes('youtube.com/watch') || url.includes('music.youtube.com/watch')) {
      const match = url.match(/[?&]v=([^&]+)/);
      if (match && match[1]) {
        return `https://www.youtube-nocookie.com/embed/${match[1]}`;
      }
    } else if (url.includes('youtube.com/embed/') || url.includes('youtube-nocookie.com/embed/')) {
      return url.replace('youtube.com', 'youtube-nocookie.com');
    }

    return url;
  },

  playUrl: function(url) {
    const iframe = document.getElementById('music-iframe');
    if (!iframe) return;

    const formatted = this.formatEmbedUrl(url);
    if (formatted) {
      iframe.src = formatted;
      iframe.style.display = 'block';
    } else {
      iframe.src = 'about:blank';
      iframe.style.display = 'none';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.MusicModule.init();
});
