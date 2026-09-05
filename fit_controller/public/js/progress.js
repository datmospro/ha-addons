// Body Progress, Measurements & Photo Comparison Module
window.ProgressModule = {
  people: [],
  selectedPersonId: null,
  progressLogs: [],
  weightChart: null,
  measurementsChart: null,
  selectedPose: 'front', // 'front', 'side', 'back'
  comparePhotoAId: null,
  comparePhotoBId: null,
  compareMode: 'split', // 'split', 'opacity', 'side'
  splitPercent: 50,
  opacityPercent: 50,

  // Temporary base64 / URL storage during modal editing
  uploadedPhotos: {
    front: '',
    side: '',
    back: ''
  },

  init: async function() {
    this.bindEvents();
    await this.loadPeople();
  },

  loadAll: async function() {
    await this.loadPeople();
  },

  bindEvents: function() {
    // Person switcher dropdown in progress header
    const personSelect = document.getElementById('progress-person-select');
    if (personSelect) {
      personSelect.addEventListener('change', (e) => {
        this.switchPerson(e.target.value);
      });
    }

    // Modal Add Progress close
    const btnCloseModal = document.getElementById('btn-close-add-progress');
    const modalAddProg = document.getElementById('modal-add-progress');
    if (btnCloseModal && modalAddProg) {
      btnCloseModal.addEventListener('click', () => {
        modalAddProg.style.display = 'none';
        modalAddProg.classList.remove('active');
      });
    }

    // Modal Add Person close
    const btnClosePerson = document.getElementById('btn-close-add-person');
    const modalAddPerson = document.getElementById('modal-add-person');
    if (btnClosePerson && modalAddPerson) {
      btnClosePerson.addEventListener('click', () => {
        modalAddPerson.style.display = 'none';
        modalAddPerson.classList.remove('active');
      });
    }

    // Progress Form Submit
    const formProgress = document.getElementById('form-add-progress');
    if (formProgress) {
      formProgress.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveProgress();
      });
    }

    // Person Form Submit
    const formPerson = document.getElementById('form-add-person');
    if (formPerson) {
      formPerson.addEventListener('submit', (e) => {
        e.preventDefault();
        this.savePerson();
      });
    }
  },

  loadPeople: async function() {
    try {
      this.people = await window.apiFetch('api/people');
      const select = document.getElementById('progress-person-select');
      if (!select) return;

      if (!this.people || this.people.length === 0) {
        select.innerHTML = '<option value="">No hay personas registradas</option>';
        return;
      }

      select.innerHTML = this.people.map(p => `
        <option value="${p.id}">${p.name} (${p.gender === 'female' ? 'Mujer' : 'Hombre'})</option>
      `).join('');

      if (!this.selectedPersonId || !this.people.some(p => Number(p.id) === Number(this.selectedPersonId))) {
        this.selectedPersonId = this.people[0].id;
      }

      select.value = this.selectedPersonId;
      await this.loadProgressForCurrentPerson();
    } catch (err) {
      console.error('Error loading people:', err);
    }
  },

  switchPerson: async function(personId) {
    this.selectedPersonId = personId;
    await this.loadProgressForCurrentPerson();
  },

  loadProgressForCurrentPerson: async function() {
    if (!this.selectedPersonId) return;

    try {
      this.progressLogs = await window.apiFetch(`api/progress?person_id=${this.selectedPersonId}`);
      this.renderSummaryKPIs();
      this.renderCharts();
      this.renderComparator();
      this.renderHistoryTable();
      if (window.lucide) lucide.createIcons();
    } catch (err) {
      console.error('Error loading progress logs:', err);
    }
  },

  getCurrentPerson: function() {
    return (this.people || []).find(p => Number(p.id) === Number(this.selectedPersonId));
  },

  renderSummaryKPIs: function() {
    const person = this.getCurrentPerson();
    const logs = this.progressLogs || [];

    const kpiCurrentWeight = document.getElementById('kpi-current-weight');
    const kpiWeightChange = document.getElementById('kpi-weight-change');
    const kpiWaistChange = document.getElementById('kpi-waist-change');
    const kpiTargetWeight = document.getElementById('kpi-target-weight');

    if (person && kpiTargetWeight) {
      kpiTargetWeight.textContent = `${person.target_weight_kg ? Number(person.target_weight_kg).toFixed(1) : '--'} kg`;
    }

    if (logs.length === 0) {
      if (kpiCurrentWeight) kpiCurrentWeight.textContent = '-- kg';
      if (kpiWeightChange) kpiWeightChange.textContent = '0.0 kg';
      if (kpiWaistChange) kpiWaistChange.textContent = '-- cm';
      return;
    }

    const firstLog = logs[0];
    const latestLog = logs[logs.length - 1];

    if (kpiCurrentWeight) {
      kpiCurrentWeight.textContent = `${Number(latestLog.weight_kg).toFixed(1)} kg`;
    }

    if (kpiWeightChange) {
      const diff = Number(latestLog.weight_kg) - Number(firstLog.weight_kg);
      const sign = diff > 0 ? '+' : '';
      kpiWeightChange.textContent = `${sign}${diff.toFixed(1)} kg`;
      kpiWeightChange.style.color = diff <= 0 ? 'var(--primary)' : 'var(--accent-orange)';
    }

    if (kpiWaistChange) {
      const logsWithWaist = logs.filter(l => l.waist_cm);
      if (logsWithWaist.length >= 2) {
        const firstW = logsWithWaist[0].waist_cm;
        const lastW = logsWithWaist[logsWithWaist.length - 1].waist_cm;
        const diffW = lastW - firstW;
        const signW = diffW > 0 ? '+' : '';
        kpiWaistChange.textContent = `${signW}${diffW.toFixed(1)} cm`;
        kpiWaistChange.style.color = diffW <= 0 ? 'var(--primary)' : 'var(--accent-orange)';
      } else if (logsWithWaist.length === 1) {
        kpiWaistChange.textContent = `${logsWithWaist[0].waist_cm} cm (inicial)`;
      } else {
        kpiWaistChange.textContent = '-- cm';
      }
    }
  },

  renderCharts: function() {
    const logs = this.progressLogs || [];
    const person = this.getCurrentPerson();

    const weightCanvas = document.getElementById('chart-progress-weight');
    const measureCanvas = document.getElementById('chart-progress-measurements');

    if (!weightCanvas || !measureCanvas || typeof Chart === 'undefined') return;

    const labels = logs.map(l => l.date);
    const weights = logs.map(l => Number(l.weight_kg));
    const targetWeights = logs.map(() => person ? person.target_weight_kg : null);

    // 1. Weight Evolution Chart
    if (this.weightChart) {
      this.weightChart.destroy();
    }

    this.weightChart = new Chart(weightCanvas, {
      type: 'line',
      data: {
        labels: labels.length > 0 ? labels : ['Sin datos'],
        datasets: [
          {
            label: 'Peso Registrado (kg)',
            data: weights.length > 0 ? weights : [0],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#10b981',
            pointRadius: 5,
            pointHoverRadius: 7
          },
          ...(person && person.target_weight_kg ? [{
            label: 'Meta de Peso (kg)',
            data: targetWeights,
            borderColor: '#06b6d4',
            borderDash: [6, 6],
            pointRadius: 0,
            fill: false
          }] : [])
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { family: 'Outfit', size: 12 } } },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } }
        }
      }
    });

    // 2. Measurements Evolution Chart
    if (this.measurementsChart) {
      this.measurementsChart.destroy();
    }

    const waists = logs.map(l => l.waist_cm || null);
    const chests = logs.map(l => l.chest_cm || null);
    const hips = logs.map(l => l.hips_cm || null);
    const arms = logs.map(l => l.arm_cm || null);
    const thighs = logs.map(l => l.thigh_cm || null);

    this.measurementsChart = new Chart(measureCanvas, {
      type: 'line',
      data: {
        labels: labels.length > 0 ? labels : ['Sin datos'],
        datasets: [
          { label: 'Cintura (cm)', data: waists, borderColor: '#f59e0b', backgroundColor: '#f59e0b', tension: 0.2, pointRadius: 4 },
          { label: 'Pecho (cm)', data: chests, borderColor: '#3b82f6', backgroundColor: '#3b82f6', tension: 0.2, pointRadius: 4 },
          { label: 'Cadera (cm)', data: hips, borderColor: '#ec4899', backgroundColor: '#ec4899', tension: 0.2, pointRadius: 4 },
          { label: 'Brazo (cm)', data: arms, borderColor: '#8b5cf6', backgroundColor: '#8b5cf6', tension: 0.2, pointRadius: 4 },
          { label: 'Muslo (cm)', data: thighs, borderColor: '#10b981', backgroundColor: '#10b981', tension: 0.2, pointRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } } }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } }
        }
      }
    });
  },

  // -------------------------------------------------------------------
  // INTERACTIVE PHOTO COMPARATOR ENGINE
  // -------------------------------------------------------------------

  setComparatorPose: function(pose) {
    this.selectedPose = pose;

    // Update active tab buttons
    document.querySelectorAll('.btn-pose-tab').forEach(b => {
      if (b.getAttribute('data-pose') === pose) {
        b.classList.add('active');
        b.style.background = 'var(--primary)';
        b.style.color = '#000';
      } else {
        b.classList.remove('active');
        b.style.background = 'rgba(255,255,255,0.05)';
        b.style.color = 'var(--text-muted)';
      }
    });

    this.renderComparator();
  },

  setComparatorMode: function(mode) {
    this.compareMode = mode;

    document.querySelectorAll('.btn-comp-mode').forEach(b => {
      if (b.getAttribute('data-mode') === mode) {
        b.classList.add('active');
        b.style.background = 'var(--accent-cyan)';
        b.style.color = '#000';
      } else {
        b.classList.remove('active');
        b.style.background = 'rgba(255,255,255,0.05)';
        b.style.color = 'var(--text-muted)';
      }
    });

    this.renderComparisonVisual();
  },

  renderComparator: function() {
    const logs = this.progressLogs || [];
    const photoKey = this.selectedPose === 'front' ? 'photo_front' : this.selectedPose === 'side' ? 'photo_side' : 'photo_back';

    // Filter only logs that have a photo for the selected pose
    const validLogs = logs.filter(l => l[photoKey] && l[photoKey].trim().length > 3);

    const selectA = document.getElementById('compare-select-a');
    const selectB = document.getElementById('compare-select-b');
    const container = document.getElementById('photo-comparison-viewport');

    if (!selectA || !selectB || !container) return;

    if (validLogs.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
          <i data-lucide="camera-off" style="width: 48px; height: 48px; opacity: 0.3; margin-bottom: 10px;"></i>
          <h4 style="font-size: 1.1rem; color: #fff; margin-bottom: 6px;">No hay fotos registradas en pose ${this.selectedPose === 'front' ? 'Frontal' : this.selectedPose === 'side' ? 'Perfil' : 'Espalda'}</h4>
          <p style="font-size: 0.85rem; max-width: 420px; margin: 0 auto 16px auto;">Añade registros con fotos en el botón "+ Registrar Progreso" para comparar tu cambio físico.</p>
          <button class="btn btn-primary" onclick="window.ProgressModule.openAddProgressModal()" style="margin: auto; font-size: 0.85rem;">
            <i data-lucide="camera"></i> Subir Fotos Ahora
          </button>
        </div>
      `;
      selectA.innerHTML = '<option value="">Sin fotos</option>';
      selectB.innerHTML = '<option value="">Sin fotos</option>';
      return;
    }

    // Populate Selectors
    selectA.innerHTML = validLogs.map(l => `
      <option value="${l.id}">${l.date} (${l.weight_kg} kg)</option>
    `).join('');

    selectB.innerHTML = validLogs.map(l => `
      <option value="${l.id}">${l.date} (${l.weight_kg} kg)</option>
    `).join('');

    // Default: Photo A is the oldest, Photo B is the latest
    if (!this.comparePhotoAId || !validLogs.some(l => Number(l.id) === Number(this.comparePhotoAId))) {
      this.comparePhotoAId = validLogs[0].id;
    }

    if (!this.comparePhotoBId || !validLogs.some(l => Number(l.id) === Number(this.comparePhotoBId))) {
      this.comparePhotoBId = validLogs[validLogs.length - 1].id;
    }

    selectA.value = this.comparePhotoAId;
    selectB.value = this.comparePhotoBId;

    selectA.onchange = (e) => {
      this.comparePhotoAId = e.target.value;
      this.renderComparisonVisual();
    };

    selectB.onchange = (e) => {
      this.comparePhotoBId = e.target.value;
      this.renderComparisonVisual();
    };

    this.renderComparisonVisual();
  },

  renderComparisonVisual: function() {
    const container = document.getElementById('photo-comparison-viewport');
    if (!container) return;

    const photoKey = this.selectedPose === 'front' ? 'photo_front' : this.selectedPose === 'side' ? 'photo_side' : 'photo_back';
    const logA = (this.progressLogs || []).find(l => Number(l.id) === Number(this.comparePhotoAId));
    const logB = (this.progressLogs || []).find(l => Number(l.id) === Number(this.comparePhotoBId));

    if (!logA || !logB || !logA[photoKey] || !logB[photoKey]) {
      container.innerHTML = `<p class="text-muted" style="text-align: center; padding: 30px;">Selecciona dos fotos válidas para comparar.</p>`;
      return;
    }

    let urlA = logA[photoKey].trim();
    if (urlA.startsWith('/')) urlA = urlA.substring(1);

    let urlB = logB[photoKey].trim();
    if (urlB.startsWith('/')) urlB = urlB.substring(1);

    const diffWeight = (Number(logB.weight_kg) - Number(logA.weight_kg)).toFixed(1);
    const weightBadge = diffWeight <= 0 
      ? `<span style="color: var(--primary); font-weight: 800;">${diffWeight} kg</span>` 
      : `<span style="color: var(--accent-orange); font-weight: 800;">+${diffWeight} kg</span>`;

    if (this.compareMode === 'split') {
      // 1. SPLIT SLIDER MODE (Cortinilla interactiva)
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 600px; margin: auto;">
          <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 700; color: #fff; background: rgba(15,23,42,0.6); padding: 8px 14px; border-radius: 8px;">
            <span><strong style="color: var(--accent-orange);">Antes (A):</strong> ${logA.date} • ${logA.weight_kg}kg</span>
            <span>Diferencia: ${weightBadge}</span>
            <span><strong style="color: var(--primary);">Después (B):</strong> ${logB.date} • ${logB.weight_kg}kg</span>
          </div>

          <!-- Interactive Split Frame -->
          <div id="split-slider-container" style="position: relative; width: 100%; height: 460px; border-radius: 12px; overflow: hidden; background: #050811; border: 1px solid var(--border-color); user-select: none;">
            <!-- Base Image A (Antes) -->
            <img src="${urlA}" alt="Foto Antes" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain;">

            <!-- Overlay Image B (Después) with clip-path or width -->
            <div id="split-overlay-b" style="position: absolute; top: 0; left: 0; width: ${this.splitPercent}%; height: 100%; overflow: hidden; border-right: 3px solid var(--primary); box-shadow: 2px 0 15px rgba(16,185,129,0.5);">
              <img src="${urlB}" alt="Foto Después" style="position: absolute; top: 0; left: 0; width: ${container.clientWidth || 500}px; height: 100%; object-fit: contain; max-width: none;">
            </div>

            <!-- Draggable Divider Line & Handle -->
            <div id="split-handle" style="position: absolute; top: 50%; left: ${this.splitPercent}%; transform: translate(-50%, -50%); width: 34px; height: 34px; border-radius: 50%; background: var(--primary); color: #000; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 900; box-shadow: 0 0 15px rgba(0,0,0,0.8); pointer-events: none;">
              ↔
            </div>

            <!-- Floating Badges -->
            <span style="position: absolute; bottom: 12px; left: 12px; background: rgba(0,0,0,0.7); color: var(--primary); font-size: 0.75rem; font-weight: 800; padding: 4px 8px; border-radius: 6px;">Después (${logB.date})</span>
            <span style="position: absolute; bottom: 12px; right: 12px; background: rgba(0,0,0,0.7); color: var(--accent-orange); font-size: 0.75rem; font-weight: 800; padding: 4px 8px; border-radius: 6px;">Antes (${logA.date})</span>
          </div>

          <!-- Slider Control Bar -->
          <div style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: rgba(15,23,42,0.8); border-radius: 10px; border: 1px solid var(--border-color);">
            <span style="font-size: 0.75rem; color: var(--primary); font-weight: 700;">Deslizar Cortinilla:</span>
            <input type="range" id="split-range-input" min="0" max="100" value="${this.splitPercent}" style="flex: 1; accent-color: var(--primary); cursor: pointer;" oninput="window.ProgressModule.updateSplitSlider(this.value)">
            <span id="split-percent-val" style="font-size: 0.8rem; font-weight: 800; color: #fff; min-width: 40px; text-align: right;">${this.splitPercent}%</span>
          </div>
        </div>
      `;

      // Update inner image width on resize
      setTimeout(() => {
        const frame = document.getElementById('split-slider-container');
        const overlayImg = document.querySelector('#split-overlay-b img');
        if (frame && overlayImg) {
          overlayImg.style.width = `${frame.clientWidth}px`;
        }
      }, 50);

    } else if (this.compareMode === 'opacity') {
      // 2. OPACITY / OVERLAY TRANSPARENCY MODE (Solapado con transparencia)
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 600px; margin: auto;">
          <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 700; color: #fff; background: rgba(15,23,42,0.6); padding: 8px 14px; border-radius: 8px;">
            <span><strong style="color: var(--accent-orange);">Fondo (Foto A):</strong> ${logA.date} • ${logA.weight_kg}kg</span>
            <span>Diferencia: ${weightBadge}</span>
            <span><strong style="color: var(--accent-cyan);">Superpuesta (Foto B):</strong> ${logB.date} • ${logB.weight_kg}kg</span>
          </div>

          <!-- Transparency Layer Stack -->
          <div style="position: relative; width: 100%; height: 460px; border-radius: 12px; overflow: hidden; background: #050811; border: 1px solid var(--border-color);">
            <!-- Base Image A -->
            <img src="${urlA}" alt="Foto Base" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain;">

            <!-- Superimposed Image B with Opacity -->
            <img id="opacity-overlay-img" src="${urlB}" alt="Foto Solapada" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; opacity: ${this.opacityPercent / 100}; transition: opacity 0.05s linear;">

            <div style="position: absolute; top: 12px; left: 12px; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">
              Transparencia Foto B: <span id="opacity-badge-val" style="color: var(--accent-cyan); font-weight: 800;">${this.opacityPercent}%</span>
            </div>
          </div>

          <!-- Opacity Slider Bar -->
          <div style="display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: rgba(15,23,42,0.8); border-radius: 10px; border: 1px solid var(--border-color);">
            <span style="font-size: 0.75rem; color: var(--accent-cyan); font-weight: 700;">Transparencia:</span>
            <input type="range" min="0" max="100" value="${this.opacityPercent}" style="flex: 1; accent-color: var(--accent-cyan); cursor: pointer;" oninput="window.ProgressModule.updateOpacitySlider(this.value)">
            <span style="font-size: 0.75rem; color: var(--text-muted);">0% (Solo Foto A) → 100% (Solo Foto B)</span>
          </div>
        </div>
      `;

    } else {
      // 3. SIDE BY SIDE MODE (Lado a lado)
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px; width: 100%;">
          <div style="text-align: center; font-size: 0.85rem; font-weight: 700; color: #fff;">
            Comparativa directa lado a lado • Diferencia: ${weightBadge}
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
            <!-- Card A -->
            <div style="background: rgba(15,23,42,0.8); border: 1px solid var(--border-color); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 700;">
                <span style="color: var(--accent-orange);">Foto A (Antes)</span>
                <span class="badge" style="background: rgba(249,115,22,0.15); color: var(--accent-orange);">${logA.date}</span>
              </div>
              <div style="width: 100%; height: 380px; background: #050811; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                <img src="${urlA}" alt="Foto A" style="width: 100%; height: 100%; object-fit: contain;">
              </div>
              <div style="font-size: 0.82rem; color: var(--text-muted); display: flex; justify-content: space-between;">
                <span>Peso: <strong>${logA.weight_kg} kg</strong></span>
                <span>Cintura: <strong>${logA.waist_cm ? logA.waist_cm + ' cm' : '--'}</strong></span>
              </div>
            </div>

            <!-- Card B -->
            <div style="background: rgba(15,23,42,0.8); border: 1px solid var(--primary); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 0 15px rgba(16,185,129,0.15);">
              <div style="display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 700;">
                <span style="color: var(--primary);">Foto B (Después)</span>
                <span class="badge" style="background: rgba(16,185,129,0.15); color: var(--primary);">${logB.date}</span>
              </div>
              <div style="width: 100%; height: 380px; background: #050811; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                <img src="${urlB}" alt="Foto B" style="width: 100%; height: 100%; object-fit: contain;">
              </div>
              <div style="font-size: 0.82rem; color: var(--text-muted); display: flex; justify-content: space-between;">
                <span>Peso: <strong style="color: var(--primary);">${logB.weight_kg} kg</strong></span>
                <span>Cintura: <strong>${logB.waist_cm ? logB.waist_cm + ' cm' : '--'}</strong></span>
              </div>
            </div>
          </div>
        </div>
      `;
    }
  },

  updateSplitSlider: function(val) {
    this.splitPercent = val;
    const overlay = document.getElementById('split-overlay-b');
    const handle = document.getElementById('split-handle');
    const valText = document.getElementById('split-percent-val');
    if (overlay) overlay.style.width = `${val}%`;
    if (handle) handle.style.left = `${val}%`;
    if (valText) valText.textContent = `${val}%`;
  },

  updateOpacitySlider: function(val) {
    this.opacityPercent = val;
    const img = document.getElementById('opacity-overlay-img');
    const valText = document.getElementById('opacity-badge-val');
    if (img) img.style.opacity = val / 100;
    if (valText) valText.textContent = `${val}%`;
  },

  // -------------------------------------------------------------------
  // PROGRESS HISTORY TABLE
  // -------------------------------------------------------------------

  renderHistoryTable: function() {
    const tableBody = document.getElementById('progress-history-tbody');
    if (!tableBody) return;

    const logs = [...(this.progressLogs || [])].reverse(); // Most recent first

    if (logs.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No hay registros de progreso para esta persona.</td></tr>`;
      return;
    }

    tableBody.innerHTML = logs.map(l => {
      const frontThumb = l.photo_front ? `<img src="${l.photo_front.replace(/^\//, '')}" onclick="window.open('${l.photo_front.replace(/^\//, '')}', '_blank')" style="width: 38px; height: 48px; object-fit: cover; border-radius: 4px; cursor: pointer; border: 1px solid var(--border-color);" title="Frontal">` : '<span class="text-muted" style="font-size: 0.72rem;">-</span>';
      const sideThumb = l.photo_side ? `<img src="${l.photo_side.replace(/^\//, '')}" onclick="window.open('${l.photo_side.replace(/^\//, '')}', '_blank')" style="width: 38px; height: 48px; object-fit: cover; border-radius: 4px; cursor: pointer; border: 1px solid var(--border-color);" title="Perfil">` : '<span class="text-muted" style="font-size: 0.72rem;">-</span>';
      const backThumb = l.photo_back ? `<img src="${l.photo_back.replace(/^\//, '')}" onclick="window.open('${l.photo_back.replace(/^\//, '')}', '_blank')" style="width: 38px; height: 48px; object-fit: cover; border-radius: 4px; cursor: pointer; border: 1px solid var(--border-color);" title="Espalda">` : '<span class="text-muted" style="font-size: 0.72rem;">-</span>';

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 12px 10px; font-weight: 700; color: #fff;">${l.date}</td>
          <td style="padding: 12px 10px; font-weight: 800; color: var(--primary);">${l.weight_kg} kg</td>
          <td style="padding: 12px 10px; font-size: 0.82rem; color: #e2e8f0;">
            ${l.waist_cm ? `Cintura: <strong>${l.waist_cm}cm</strong>` : ''} 
            ${l.chest_cm ? `| Pecho: <strong>${l.chest_cm}cm</strong>` : ''}
            ${l.hips_cm ? `| Cadera: <strong>${l.hips_cm}cm</strong>` : ''}
            ${!l.waist_cm && !l.chest_cm && !l.hips_cm ? '<span class="text-muted">Sin medidas</span>' : ''}
          </td>
          <td style="padding: 12px 10px;">
            <div style="display: flex; gap: 4px; align-items: center;">
              ${frontThumb} ${sideThumb} ${backThumb}
            </div>
          </td>
          <td style="padding: 12px 10px; font-size: 0.8rem; color: var(--text-muted); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${l.notes || '-'}
          </td>
          <td style="padding: 12px 10px; text-align: right;">
            <div style="display: flex; gap: 6px; justify-content: flex-end;">
              <button class="btn btn-secondary" onclick="window.ProgressModule.openEditProgressModal(${l.id})" style="padding: 6px 8px; font-size: 0.75rem;" title="Editar">
                <i data-lucide="edit-3" style="width: 13px; height: 13px;"></i>
              </button>
              <button class="btn btn-secondary" onclick="window.ProgressModule.deleteProgress(${l.id})" style="padding: 6px 8px; font-size: 0.75rem; color: var(--accent-red); border-color: rgba(239,68,68,0.2);" title="Eliminar">
                <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  // -------------------------------------------------------------------
  // MODALS & CRUD (ADD / EDIT PROGRESS & PEOPLE)
  // -------------------------------------------------------------------

  openAddProgressModal: function() {
    this.uploadedPhotos = { front: '', side: '', back: '' };

    document.getElementById('prog-edit-id').value = '';
    document.getElementById('prog-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('prog-weight').value = '';
    document.getElementById('prog-chest').value = '';
    document.getElementById('prog-waist').value = '';
    document.getElementById('prog-hips').value = '';
    document.getElementById('prog-arm').value = '';
    document.getElementById('prog-thigh').value = '';
    document.getElementById('prog-notes').value = '';

    // Clear previews
    this.updatePhotoPreview('front', '');
    this.updatePhotoPreview('side', '');
    this.updatePhotoPreview('back', '');

    document.getElementById('modal-progress-title-text').textContent = 'Nuevo Registro de Progreso';

    const modal = document.getElementById('modal-add-progress');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
    }
  },

  openEditProgressModal: function(id) {
    const log = (this.progressLogs || []).find(l => Number(l.id) === Number(id));
    if (!log) return;

    this.uploadedPhotos = {
      front: log.photo_front || '',
      side: log.photo_side || '',
      back: log.photo_back || ''
    };

    document.getElementById('prog-edit-id').value = log.id;
    document.getElementById('prog-date').value = log.date;
    document.getElementById('prog-weight').value = log.weight_kg;
    document.getElementById('prog-chest').value = log.chest_cm || '';
    document.getElementById('prog-waist').value = log.waist_cm || '';
    document.getElementById('prog-hips').value = log.hips_cm || '';
    document.getElementById('prog-arm').value = log.arm_cm || '';
    document.getElementById('prog-thigh').value = log.thigh_cm || '';
    document.getElementById('prog-notes').value = log.notes || '';

    this.updatePhotoPreview('front', log.photo_front || '');
    this.updatePhotoPreview('side', log.photo_side || '');
    this.updatePhotoPreview('back', log.photo_back || '');

    document.getElementById('modal-progress-title-text').textContent = 'Editar Registro de Progreso';

    const modal = document.getElementById('modal-add-progress');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
    }
  },

  handlePhotoFileSelect: function(pose, event) {
    const file = event.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById(`photo-status-${pose}`);
    if (statusEl) {
      statusEl.textContent = '⏳ Subiendo foto...';
      statusEl.style.color = 'var(--accent-yellow)';
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const base64 = e.target.result;
        const res = await window.apiFetch('api/upload-progress-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64,
            filename: file.name,
            pose,
            person_id: this.selectedPersonId
          })
        });

        this.uploadedPhotos[pose] = res.url;
        this.updatePhotoPreview(pose, res.url);

        if (statusEl) {
          statusEl.textContent = '✅ Subida con éxito';
          statusEl.style.color = 'var(--primary)';
        }
      } catch (err) {
        console.error('Error uploading photo:', err);
        if (statusEl) {
          statusEl.textContent = '❌ Error al subir';
          statusEl.style.color = 'var(--accent-red)';
        }
      }
    };
    reader.readAsDataURL(file);
  },

  updatePhotoPreview: function(pose, url) {
    const previewBox = document.getElementById(`photo-preview-${pose}`);
    if (!previewBox) return;

    if (url && url.trim().length > 3) {
      const cleanUrl = url.replace(/^\//, '');
      previewBox.innerHTML = `
        <img src="${cleanUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 6px;">
      `;
    } else {
      previewBox.innerHTML = `
        <span style="font-size: 0.72rem; color: var(--text-muted);">Sin foto</span>
      `;
    }
  },

  saveProgress: async function() {
    const editId = document.getElementById('prog-edit-id').value;
    const date = document.getElementById('prog-date').value;
    const weightVal = document.getElementById('prog-weight').value;

    const parseNum = (val) => {
      if (typeof val === 'string') val = val.replace(',', '.');
      const p = parseFloat(val);
      return isNaN(p) ? null : p;
    };

    const weight_kg = parseNum(weightVal);
    if (!weight_kg) {
      alert('Por favor introduce un peso válido.');
      return;
    }

    const body = {
      person_id: this.selectedPersonId,
      date,
      weight_kg,
      chest_cm: parseNum(document.getElementById('prog-chest').value),
      waist_cm: parseNum(document.getElementById('prog-waist').value),
      hips_cm: parseNum(document.getElementById('prog-hips').value),
      arm_cm: parseNum(document.getElementById('prog-arm').value),
      thigh_cm: parseNum(document.getElementById('prog-thigh').value),
      photo_front: this.uploadedPhotos.front,
      photo_side: this.uploadedPhotos.side,
      photo_back: this.uploadedPhotos.back,
      notes: document.getElementById('prog-notes').value
    };

    try {
      if (editId) {
        await window.apiFetch(`api/progress/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } else {
        await window.apiFetch('api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      }

      const modal = document.getElementById('modal-add-progress');
      if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
      }

      await this.loadProgressForCurrentPerson();
    } catch (err) {
      alert('Error al guardar registro: ' + err.message);
    }
  },

  deleteProgress: async function(id) {
    if (!confirm('¿Seguro que deseas eliminar este registro de progreso?')) return;

    try {
      await window.apiFetch(`api/progress/${id}`, { method: 'DELETE' });
      await this.loadProgressForCurrentPerson();
    } catch (err) {
      alert('Error al eliminar registro: ' + err.message);
    }
  },

  // Person CRUD
  openAddPersonModal: function() {
    document.getElementById('person-name-input').value = '';
    document.getElementById('person-gender-select').value = 'female';
    document.getElementById('person-height-input').value = 170;
    document.getElementById('person-target-weight-input').value = 65;

    const modal = document.getElementById('modal-add-person');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
    }
  },

  savePerson: async function() {
    const name = document.getElementById('person-name-input').value.trim();
    if (!name) {
      alert('El nombre es obligatorio.');
      return;
    }

    const parseNum = (val) => {
      if (typeof val === 'string') val = val.replace(',', '.');
      const p = parseFloat(val);
      return isNaN(p) ? null : p;
    };

    const body = {
      name,
      gender: document.getElementById('person-gender-select').value,
      height_cm: parseNum(document.getElementById('person-height-input').value) || 170,
      target_weight_kg: parseNum(document.getElementById('person-target-weight-input').value) || 65
    };

    try {
      const res = await window.apiFetch('api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      this.selectedPersonId = res.id;

      const modal = document.getElementById('modal-add-person');
      if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
      }

      await this.loadPeople();
    } catch (err) {
      alert('Error al crear persona: ' + err.message);
    }
  },

  deleteCurrentPerson: async function() {
    const person = this.getCurrentPerson();
    if (!person) return;

    if (!confirm(`¿Seguro que deseas eliminar el perfil de "${person.name}" y todos sus registros de progreso y fotos asociadas?`)) {
      return;
    }

    try {
      await window.apiFetch(`api/people/${person.id}`, { method: 'DELETE' });
      this.selectedPersonId = null;
      await this.loadPeople();
    } catch (err) {
      alert('Error al eliminar persona: ' + err.message);
    }
  }
};
