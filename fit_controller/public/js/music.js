// Workout Music Player & Playlist Manager Module (With YouTube postMessage Volume Control)
window.MusicModule = {
  playlists: [],
  videoVolume: 80,

  init: function() {
    this.bindWidgetEvents();
    this.bindSettingsEvents();
    this.bindVolumeEvents();
    this.loadPlaylists();
  },

  loadPlaylists: async function() {
    try {
      this.playlists = await window.apiFetch('api/music/playlists');
      this.renderWidgetDropdown();
      this.renderSettingsPlaylistTable();
    } catch (err) {
      console.error('Error loading playlists:', err);
    }
  },

  renderWidgetDropdown: function() {
    const select = document.getElementById('music-playlist-select');
    if (!select) return;

    select.innerHTML = `<option value="">-- Seleccionar Lista o Pegar Enlace --</option>` +
      this.playlists.map(p => `
        <option value="${p.url}">${p.title}</option>
      `).join('');
  },

  renderSettingsPlaylistTable: function() {
    const tableContainer = document.getElementById('settings-playlists-list');
    if (!tableContainer) return;

    if (this.playlists.length === 0) {
      tableContainer.innerHTML = `<p class="text-muted">No hay listas de reproducción configuradas aún.</p>`;
      return;
    }

    tableContainer.innerHTML = this.playlists.map(p => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: rgba(15,23,42,0.6); border-radius: 10px; margin-bottom: 8px; border: 1px solid var(--border-color);">
        <div style="flex: 1; padding-right: 12px;">
          <h4 style="font-size: 0.95rem; font-weight: 700; color: var(--primary);">${p.title}</h4>
          <span class="text-muted" style="font-size: 0.78rem; word-break: break-all;">${p.url}</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary" onclick="window.MusicModule.editPlaylistPrompt(${p.id})" style="font-size: 0.78rem; padding: 6px 10px;">
            <i data-lucide="edit-3" style="width: 12px; height: 12px;"></i> Editar
          </button>
          <button class="btn btn-secondary" onclick="window.MusicModule.deletePlaylist(${p.id})" style="font-size: 0.78rem; padding: 6px 10px; color: var(--accent-red); border-color: rgba(239,68,68,0.2);">
            <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
          </button>
        </div>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
  },

  bindVolumeEvents: function() {
    // 1. App Beeps Volume Slider
    const beepsSlider = document.getElementById('volume-beeps-slider');
    const beepsVal = document.getElementById('volume-beeps-val');

    if (beepsSlider && beepsVal) {
      beepsSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        beepsVal.textContent = `${val}%`;
        if (window.TrainerModule) {
          window.TrainerModule.beepVolume = val / 100;
        }
      });
    }

    // 2. Video Music Volume Slider (Using YouTube Iframe postMessage API)
    const musicSlider = document.getElementById('volume-music-slider');
    const musicVal = document.getElementById('volume-music-val');

    if (musicSlider && musicVal) {
      musicSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        musicVal.textContent = `${val}%`;
        this.videoVolume = val;
        this.applyVideoVolume(val);
      });
    }
  },

  applyVideoVolume: function(volumeLevel) {
    const iframe = document.getElementById('music-iframe');
    if (!iframe || !iframe.contentWindow) return;

    try {
      // Send setVolume command to YouTube iframe postMessage API
      const msg = JSON.stringify({
        event: 'command',
        func: 'setVolume',
        args: [volumeLevel]
      });
      iframe.contentWindow.postMessage(msg, '*');

      if (volumeLevel === 0) {
        iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: [] }), '*');
      } else {
        iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*');
      }
    } catch (err) {
      console.log('PostMessage volume control fallback', err);
    }
  },

  pauseMusic: function() {
    const iframe = document.getElementById('music-iframe');
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
      } catch (err) {}
    }
  },

  resumeMusic: function() {
    const iframe = document.getElementById('music-iframe');
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
      } catch (err) {}
    }
  },

  stopMusic: function() {
    this.pauseMusic();
    const iframe = document.getElementById('music-iframe');
    if (iframe) {
      iframe.src = 'about:blank';
      iframe.style.display = 'none';
    }
  },

  bindWidgetEvents: function() {
    const select = document.getElementById('music-playlist-select');
    const iframe = document.getElementById('music-iframe');
    const customInput = document.getElementById('music-custom-url');
    const btnCustom = document.getElementById('btn-play-custom-music');

    if (select && iframe) {
      select.addEventListener('change', (e) => {
        this.playUrl(e.target.value, true);
      });
    }

    if (btnCustom && customInput) {
      btnCustom.addEventListener('click', () => {
        this.playUrl(customInput.value, true);
      });
    }
  },

  bindSettingsEvents: function() {
    const formAdd = document.getElementById('form-add-music-playlist');
    if (formAdd) {
      formAdd.addEventListener('submit', async (e) => {
        e.preventDefault();
        const editId = document.getElementById('music-playlist-edit-id').value;
        const title = document.getElementById('music-playlist-title').value;
        const rawUrl = document.getElementById('music-playlist-url').value;

        const formattedUrl = this.formatEmbedUrl(rawUrl);

        try {
          if (editId) {
            await window.apiFetch(`api/music/playlists/${editId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, url: formattedUrl })
            });
          } else {
            await window.apiFetch('api/music/playlists', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, url: formattedUrl })
            });
          }

          document.getElementById('music-playlist-edit-id').value = '';
          formAdd.reset();
          await this.loadPlaylists();
        } catch (err) {
          alert('Error al guardar lista de música: ' + err.message);
        }
      });
    }
  },

  playRandomPlaylist: function() {
    if (!this.playlists || this.playlists.length === 0) return;

    const randomIndex = Math.floor(Math.random() * this.playlists.length);
    const randomPlaylist = this.playlists[randomIndex];

    const select = document.getElementById('music-playlist-select');
    if (select) {
      select.value = randomPlaylist.url;
    }

    this.playUrl(randomPlaylist.url, true);
  },

  editPlaylistPrompt: function(id) {
    const p = this.playlists.find(item => item.id === id);
    if (!p) return;

    document.getElementById('music-playlist-edit-id').value = p.id;
    document.getElementById('music-playlist-title').value = p.title;
    document.getElementById('music-playlist-url').value = p.url;
  },

  deletePlaylist: async function(id) {
    try {
      await window.apiFetch(`api/music/playlists/${id}`, { method: 'DELETE' });
      await this.loadPlaylists();
    } catch (err) {
      alert('Error al eliminar lista: ' + err.message);
    }
  },

  formatEmbedUrl: function(rawUrl) {
    if (!rawUrl || !rawUrl.trim()) return '';
    let url = rawUrl.trim();

    // Convert standard youtube / music.youtube / youtu.be to youtube-nocookie.com/embed/
    if (url.includes('youtube.com/playlist') || url.includes('music.youtube.com/playlist')) {
      const match = url.match(/[?&]list=([^&]+)/);
      if (match && match[1]) {
        return `https://www.youtube-nocookie.com/embed/videoseries?list=${match[1]}&enablejsapi=1`;
      }
    } else if (url.includes('youtu.be/')) {
      const id = url.split('youtu.be/')[1].split('?')[0];
      return `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1`;
    } else if (url.includes('youtube.com/watch') || url.includes('music.youtube.com/watch')) {
      const match = url.match(/[?&]v=([^&]+)/);
      if (match && match[1]) {
        return `https://www.youtube-nocookie.com/embed/${match[1]}?enablejsapi=1`;
      }
    } else if (url.includes('youtube.com/embed/') || url.includes('youtube-nocookie.com/embed/')) {
      let base = url.replace('youtube.com', 'youtube-nocookie.com');
      if (!base.includes('enablejsapi=1')) {
        const sep = base.includes('?') ? '&' : '?';
        base += `${sep}enablejsapi=1`;
      }
      return base;
    }

    return url;
  },

  playUrl: function(url, autoplay = true) {
    const iframe = document.getElementById('music-iframe');
    if (!iframe) return;

    let formatted = this.formatEmbedUrl(url);
    if (formatted) {
      if (autoplay && !formatted.includes('autoplay=1')) {
        const separator = formatted.includes('?') ? '&' : '?';
        formatted += `${separator}autoplay=1`;
      }
      if (!formatted.includes('enablejsapi=1')) {
        const separator = formatted.includes('?') ? '&' : '?';
        formatted += `${separator}enablejsapi=1`;
      }

      iframe.src = formatted;
      iframe.style.display = 'block';

      // Apply current volume setting after video loads
      setTimeout(() => {
        this.applyVideoVolume(this.videoVolume);
      }, 1000);
      setTimeout(() => {
        this.applyVideoVolume(this.videoVolume);
      }, 2500);
    } else {
      iframe.src = 'about:blank';
      iframe.style.display = 'none';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.MusicModule.init();
});
