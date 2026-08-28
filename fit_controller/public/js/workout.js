// Workout Routine & Exercise Catalog Module
window.WorkoutModule = {
  currentRoutines: [],
  exerciseCatalog: [],

  init: function() {
    this.bindMuscleFilterEvents();
    this.bindModals();
  },

  loadRoutinesAndCatalog: async function() {
    await this.loadRoutines();
    await this.loadExerciseCatalog();
  },

  loadRoutines: async function() {
    try {
      this.currentRoutines = await window.apiFetch('api/workout/routines');
      this.renderRoutines();
    } catch (err) {
      console.error('Error loading routines:', err);
    }
  },

  loadExerciseCatalog: async function(muscle = 'all') {
    try {
      this.exerciseCatalog = await window.apiFetch(`api/workout/exercises?muscle=${muscle}`);
      this.renderCatalog();
    } catch (err) {
      console.error('Error loading exercise catalog:', err);
    }
  },

  renderRoutines: function() {
    const container = document.getElementById('routines-list-container');
    if (!container) return;

    if (this.currentRoutines.length === 0) {
      container.innerHTML = '<p class="text-muted">No hay rutinas creadas. Haz clic en "Nueva Rutina" para comenzar.</p>';
      return;
    }

    container.innerHTML = this.currentRoutines.map(r => `
      <div class="card">
        <div class="card-header">
          <div>
            <h4 style="font-size: 1.1rem; font-weight: 700;">${r.name}</h4>
            <span class="text-muted" style="font-size: 0.8rem; text-transform: capitalize;">Día habitual: ${r.day_of_week || 'Sin asignar'}</span>
          </div>
          <button class="btn btn-primary" onclick="window.TrainerModule.startRoutine(${r.id})">
            <i data-lucide="play"></i> Entrenar
          </button>
        </div>
        <p class="text-muted" style="font-size: 0.85rem; margin-bottom: 14px;">${r.description || 'Sin descripción'}</p>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;">
          ${r.exercises.map(e => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(15,23,42,0.6); border-radius: 8px; font-size: 0.85rem;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-weight: 700; color: var(--primary);">${e.name}</span>
                <span class="text-muted">(${e.muscle_group})</span>
              </div>
              <div style="display: flex; align-items: center; gap: 12px;">
                <span style="font-weight: 600;">
                  ${e.sets} series x ${e.reps} reps ${e.weight_kg > 0 ? `| ${e.weight_kg}kg` : ''}
                </span>
                <button onclick="window.WorkoutModule.removeExerciseFromRoutine(${e.routine_exercise_id})" style="background: transparent; border: none; color: var(--accent-red); cursor: pointer;" title="Quitar ejercicio">
                  <i data-lucide="x" style="width: 14px; height: 14px;"></i>
                </button>
              </div>
            </div>
          `).join('')}
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <button class="btn btn-secondary" onclick="window.WorkoutModule.openAddExerciseModal(${r.id})" style="font-size: 0.8rem;">
            <i data-lucide="plus"></i> Añadir Ejercicio
          </button>
          <button class="btn btn-secondary" onclick="window.WorkoutModule.deleteRoutine(${r.id})" style="font-size: 0.8rem; color: var(--accent-red); border-color: rgba(239,68,68,0.2);">
            <i data-lucide="trash-2"></i> Eliminar Rutina
          </button>
        </div>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
  },

  renderCatalog: function() {
    const grid = document.getElementById('exercise-catalog-grid');
    if (!grid) return;

    if (this.exerciseCatalog.length === 0) {
      grid.innerHTML = '<p class="text-muted" style="grid-column: 1/-1;">No hay ejercicios en esta categoría.</p>';
      return;
    }

    grid.innerHTML = this.exerciseCatalog.map(ex => `
      <div class="exercise-card">
        <div class="exercise-anim-box">
          ${this.getAnimationGraphicHtml(ex)}
        </div>
        <div>
          <h4 style="font-size: 1rem; font-weight: 700;">${ex.name}</h4>
          <span class="badge" style="background: rgba(16,185,129,0.15); color: var(--primary); font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">${ex.muscle_group}</span>
          <span class="text-muted" style="font-size: 0.75rem; margin-left: 6px;">${ex.equipment}</span>
        </div>
        <p class="text-muted" style="font-size: 0.8rem; flex: 1;">${ex.instructions || ''}</p>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
  },

  getAnimationGraphicHtml: function(ex) {
    if (ex.animation_url && ex.animation_url.trim().length > 5 && !ex.animation_url.includes('gymvisual.com')) {
      return `<img src="${ex.animation_url}" alt="${ex.name}" onerror="this.onerror=null; this.parentNode.innerHTML=window.WorkoutModule.getSvgFallbackHtml('${ex.animation_data || ex.muscle_group}');">`;
    }
    return this.getSvgFallbackHtml(ex.animation_data || ex.muscle_group);
  },

  getSvgFallbackHtml: function(key) {
    const keyLower = String(key || '').toLowerCase();
    
    // Rich SVG Vector Animations with smooth CSS Keyframes
    if (keyLower.includes('squat') || keyLower.includes('sentadilla') || keyLower.includes('pierna')) {
      return `
        <svg viewBox="0 0 100 100" style="width: 100%; height: 100%; max-height: 160px;">
          <style>
            @keyframes animSquat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(18px); } }
            .squat-move { animation: animSquat 1.8s infinite ease-in-out; }
          </style>
          <g class="squat-move">
            <circle cx="50" cy="20" r="8" fill="#10b981"/>
            <path d="M50 28 v22 M50 36 L34 48 M50 36 L66 48 M50 50 L36 74 L24 88 M50 50 L64 74 L76 88 M25 34 h50" stroke="#10b981" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
          </g>
          <path d="M10 88 h80" stroke="#334155" stroke-width="3"/>
        </svg>
      `;
    }

    if (keyLower.includes('pushup') || keyLower.includes('flexio') || keyLower.includes('pecho')) {
      return `
        <svg viewBox="0 0 100 100" style="width: 100%; height: 100%; max-height: 160px;">
          <style>
            @keyframes animPushup { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(12px); } }
            .pushup-move { animation: animPushup 1.6s infinite ease-in-out; }
          </style>
          <g class="pushup-move">
            <circle cx="22" cy="42" r="8" fill="#06b6d4"/>
            <path d="M28 48 L78 54 L90 74 M36 52 L36 74 M58 54 L58 74" stroke="#06b6d4" stroke-width="4" stroke-linecap="round"/>
          </g>
          <path d="M10 74 h80" stroke="#334155" stroke-width="3"/>
        </svg>
      `;
    }

    if (keyLower.includes('curl') || keyLower.includes('brazo') || keyLower.includes('bicep')) {
      return `
        <svg viewBox="0 0 100 100" style="width: 100%; height: 100%; max-height: 160px;">
          <style>
            @keyframes animCurl { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-75deg); } }
            .curl-arm { animation: animCurl 1.5s infinite ease-in-out; transform-origin: 50px 42px; }
          </style>
          <circle cx="50" cy="20" r="8" fill="#8b5cf6"/>
          <path d="M50 28 v32 M50 60 L36 86 M50 60 L64 86" stroke="#8b5cf6" stroke-width="4" stroke-linecap="round"/>
          <g class="curl-arm">
            <path d="M50 42 L70 42 L70 20" stroke="#8b5cf6" stroke-width="4" stroke-linecap="round"/>
            <circle cx="70" cy="20" r="6" fill="#f97316"/>
          </g>
        </svg>
      `;
    }

    if (keyLower.includes('plank') || keyLower.includes('plancha') || keyLower.includes('core')) {
      return `
        <svg viewBox="0 0 100 100" style="width: 100%; height: 100%; max-height: 160px;">
          <style>
            @keyframes animPlank { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
            .plank-glow { animation: animPlank 1.2s infinite ease-in-out; }
          </style>
          <g class="plank-glow">
            <circle cx="22" cy="46" r="8" fill="#f97316"/>
            <path d="M28 52 L80 52 L90 70 M32 52 L32 70 M48 52 L48 70" stroke="#f97316" stroke-width="4" stroke-linecap="round"/>
          </g>
          <path d="M10 70 h80" stroke="#334155" stroke-width="3"/>
        </svg>
      `;
    }

    // Default general exercise SVG animation
    return `
      <svg viewBox="0 0 100 100" style="width: 100%; height: 100%; max-height: 160px;">
        <style>
          @keyframes animGen { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(10px); } }
          .gen-move { animation: animGen 1.8s infinite ease-in-out; }
        </style>
        <g class="gen-move">
          <circle cx="50" cy="24" r="9" fill="#10b981"/>
          <path d="M50 33 v28 M50 42 L32 30 M50 42 L68 30 M50 61 L36 86 M50 61 L64 86" stroke="#10b981" stroke-width="4" stroke-linecap="round"/>
        </g>
      </svg>
    `;
  },

  bindMuscleFilterEvents: function() {
    const btns = document.querySelectorAll('.filter-muscle-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const muscle = btn.getAttribute('data-muscle');
        this.loadExerciseCatalog(muscle);
      });
    });
  },

  bindModals: function() {
    // 1. Create Routine Modal
    const modalCreateRoutine = document.getElementById('modal-create-routine');
    const btnOpenCreateRoutine = document.getElementById('btn-open-create-routine-modal');
    const btnCloseCreateRoutine = document.getElementById('btn-close-create-routine');

    if (btnOpenCreateRoutine) {
      btnOpenCreateRoutine.addEventListener('click', () => modalCreateRoutine.classList.add('active'));
    }
    if (btnCloseCreateRoutine) {
      btnCloseCreateRoutine.addEventListener('click', () => modalCreateRoutine.classList.remove('active'));
    }

    const formCreateRoutine = document.getElementById('form-create-routine');
    if (formCreateRoutine) {
      formCreateRoutine.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('routine-name-input').value;
        const day_of_week = document.getElementById('routine-day-select').value;
        const description = document.getElementById('routine-desc-input').value;

        try {
          await window.apiFetch('api/workout/routines', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, day_of_week, description })
          });
          modalCreateRoutine.classList.remove('active');
          formCreateRoutine.reset();
          this.loadRoutines();
        } catch (err) {
          alert('Error al crear rutina: ' + err.message);
        }
      });
    }

    // 2. Add Exercise to Routine Modal
    const modalAddEx = document.getElementById('modal-add-exercise-to-routine');
    const btnCloseAddEx = document.getElementById('btn-close-add-ex-routine');
    if (btnCloseAddEx) {
      btnCloseAddEx.addEventListener('click', () => modalAddEx.classList.remove('active'));
    }

    const formAddEx = document.getElementById('form-add-ex-routine');
    if (formAddEx) {
      formAddEx.addEventListener('submit', async (e) => {
        e.preventDefault();
        const routine_id = document.getElementById('add-ex-routine-id').value;
        const exercise_id = document.getElementById('add-ex-select').value;
        const sets = document.getElementById('add-ex-sets').value;
        const reps = document.getElementById('add-ex-reps').value;
        const weight_kg = document.getElementById('add-ex-weight').value;
        const rest_sec = document.getElementById('add-ex-rest').value;

        try {
          await window.apiFetch('api/workout/routine-exercise', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ routine_id, exercise_id, sets, reps, weight_kg, rest_sec })
          });
          modalAddEx.classList.remove('active');
          this.loadRoutines();
        } catch (err) {
          alert('Error al añadir ejercicio: ' + err.message);
        }
      });
    }

    // 3. Create Custom Exercise Modal
    const modalCreateEx = document.getElementById('modal-create-exercise');
    const btnOpenCreateEx = document.getElementById('btn-open-create-exercise-modal');
    const btnCloseCreateEx = document.getElementById('btn-close-create-exercise');

    if (btnOpenCreateEx) {
      btnOpenCreateEx.addEventListener('click', () => modalCreateEx.classList.add('active'));
    }
    if (btnCloseCreateEx) {
      btnCloseCreateEx.addEventListener('click', () => modalCreateEx.classList.remove('active'));
    }

    const formCreateEx = document.getElementById('form-create-exercise');
    if (formCreateEx) {
      formCreateEx.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
          name: document.getElementById('new-ex-name').value,
          muscle_group: document.getElementById('new-ex-muscle').value,
          equipment: document.getElementById('new-ex-equipment').value,
          instructions: document.getElementById('new-ex-instructions').value,
          animation_url: document.getElementById('new-ex-anim-url').value,
          default_sets: 3,
          default_reps: 12,
          default_rest_sec: 60
        };

        try {
          await window.apiFetch('api/workout/exercises', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          modalCreateEx.classList.remove('active');
          formCreateEx.reset();
          this.loadExerciseCatalog();
        } catch (err) {
          alert('Error al crear ejercicio: ' + err.message);
        }
      });
    }
  },

  openAddExerciseModal: async function(routineId) {
    if (this.exerciseCatalog.length === 0) await this.loadExerciseCatalog();

    document.getElementById('add-ex-routine-id').value = routineId;
    const select = document.getElementById('add-ex-select');
    
    select.innerHTML = this.exerciseCatalog.map(e => `
      <option value="${e.id}">${e.name} (${e.muscle_group} - ${e.equipment})</option>
    `).join('');

    document.getElementById('modal-add-exercise-to-routine').classList.add('active');
  },

  removeExerciseFromRoutine: async function(routineExerciseId) {
    try {
      await window.apiFetch(`api/workout/routine-exercise/${routineExerciseId}`, { method: 'DELETE' });
      this.loadRoutines();
    } catch (err) {
      alert('Error al quitar ejercicio: ' + err.message);
    }
  },

  deleteRoutine: async function(id) {
    try {
      await window.apiFetch(`api/workout/routines/${id}`, { method: 'DELETE' });
      this.loadRoutines();
    } catch (err) {
      alert('Error al eliminar rutina: ' + err.message);
    }
  },

  loadHistory: async function() {
    try {
      const logs = await window.apiFetch('api/workout/logs');
      const container = document.getElementById('workout-history-list');

      if (logs.length === 0) {
        container.innerHTML = '<p class="text-muted">No has completado ninguna sesión de entrenamiento aún.</p>';
        return;
      }

      container.innerHTML = logs.map(l => `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: rgba(15,23,42,0.6); border-radius: 10px; margin-bottom: 10px;">
          <div>
            <h4 style="font-size: 1rem; font-weight: 700; color: var(--primary);">${l.routine_name}</h4>
            <span class="text-muted" style="font-size: 0.8rem;">${new Date(l.completed_at).toLocaleString('es-ES')}</span>
          </div>
          <div style="display: flex; gap: 20px; font-size: 0.9rem;">
            <span>Duración: <strong>${Math.floor(l.duration_sec / 60)}m ${l.duration_sec % 60}s</strong></span>
            <span>Series: <strong>${l.sets_completed}</strong></span>
            <span>Kcal Quemadas: <strong style="color: var(--accent-orange);">${l.kcal_burned} kcal</strong></span>
          </div>
        </div>
      `).join('');
    } catch (err) {
      console.error('Error loading history:', err);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.WorkoutModule.init();
});
