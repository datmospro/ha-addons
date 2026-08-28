// Workout Routine & Exercise Catalog Module
window.WorkoutModule = {
  currentRoutines: [],
  exerciseCatalog: [],

  init: function() {
    this.bindMuscleFilterEvents();
    this.bindCreateRoutine();
  },

  loadRoutinesAndCatalog: async function() {
    await this.loadRoutines();
    await this.loadExerciseCatalog();
  },

  loadRoutines: async function() {
    try {
      const res = await fetch('/api/workout/routines');
      this.currentRoutines = await res.json();
      this.renderRoutines();
    } catch (err) {
      console.error('Error loading routines:', err);
    }
  },

  loadExerciseCatalog: async function(muscle = 'all') {
    try {
      const res = await fetch(`/api/workout/exercises?muscle=${muscle}`);
      this.exerciseCatalog = await res.json();
      this.renderCatalog();
    } catch (err) {
      console.error('Error loading exercise catalog:', err);
    }
  },

  renderRoutines: function() {
    const container = document.getElementById('routines-list-container');
    if (!container) return;

    if (this.currentRoutines.length === 0) {
      container.innerHTML = '<p class="text-muted">No hay rutinas creadas. Crea una nueva rutina para comenzar.</p>';
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
              <div style="font-weight: 600;">
                ${e.sets} series x ${e.reps} reps ${e.weight_kg > 0 ? `| ${e.weight_kg}kg` : ''}
              </div>
            </div>
          `).join('')}
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center;">
          <button class="btn btn-secondary" onclick="window.WorkoutModule.addExerciseToRoutine(${r.id})" style="font-size: 0.8rem;">
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
    if (ex.animation_url && ex.animation_url.trim().length > 5) {
      return `<img src="${ex.animation_url}" alt="${ex.name}" onerror="this.onerror=null; this.parentNode.innerHTML=window.WorkoutModule.getSvgFallbackHtml('${ex.animation_data || 'squat'}');">`;
    }
    return this.getSvgFallbackHtml(ex.animation_data || ex.muscle_group);
  },

  getSvgFallbackHtml: function(key) {
    // Vector animations matching muscle groups / exercises
    const svgMap = {
      squat: `<svg viewBox="0 0 100 100" fill="none" stroke="#10b981" stroke-width="4"><circle cx="50" cy="20" r="10"/><path d="M50 30 v25 L35 75 L20 90 M50 55 L65 75 L80 90 M30 40 h40"/></svg>`,
      pushup: `<svg viewBox="0 0 100 100" fill="none" stroke="#06b6d4" stroke-width="4"><circle cx="20" cy="40" r="10"/><path d="M25 48 L75 55 L90 75 M35 50 L35 75 M55 52 L55 75"/></svg>`,
      benchpress: `<svg viewBox="0 0 100 100" fill="none" stroke="#06b6d4" stroke-width="4"><circle cx="30" cy="50" r="10"/><path d="M10 65 h80 M35 58 h35 M40 58 L40 30 M60 58 L60 30 M25 28 h50"/></svg>`,
      bicepcurl: `<svg viewBox="0 0 100 100" fill="none" stroke="#8b5cf6" stroke-width="4"><circle cx="50" cy="20" r="10"/><path d="M50 30 v30 M50 38 L30 35 M50 38 L70 30 L65 18"/><circle cx="65" cy="18" r="5" fill="#8b5cf6"/></svg>`,
      plank: `<svg viewBox="0 0 100 100" fill="none" stroke="#f97316" stroke-width="4"><circle cx="20" cy="45" r="10"/><path d="M25 52 L80 52 L90 70 M30 52 L30 70 M45 52 L45 70"/></svg>`,
      default: `<svg viewBox="0 0 100 100" fill="none" stroke="#10b981" stroke-width="4"><circle cx="50" cy="30" r="12"/><path d="M50 42 v30 L35 90 M50 72 L65 90 M30 55 h40"/></svg>`
    };
    return svgMap[key] || svgMap.default;
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

  bindCreateRoutine: function() {
    const btn = document.getElementById('btn-create-new-routine');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const name = prompt('Nombre de la nueva rutina (ej: Rutina de Espalda y Biceps):');
      if (!name) return;
      const day = prompt('Día preferido (lunes, martes, miercoles, etc.):', 'lunes');

      try {
        await fetch('/api/workout/routines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, day_of_week: day || 'lunes' })
        });
        this.loadRoutines();
      } catch (err) {
        alert('Error al crear rutina: ' + err.message);
      }
    });
  },

  addExerciseToRoutine: async function(routineId) {
    if (this.exerciseCatalog.length === 0) await this.loadExerciseCatalog();
    
    const exNames = this.exerciseCatalog.map((e, idx) => `${idx + 1}. ${e.name} (${e.muscle_group})`).join('\n');
    const choice = prompt(`Selecciona el número del ejercicio a añadir:\n${exNames}`);
    const index = parseInt(choice, 10) - 1;

    if (isNaN(index) || !this.exerciseCatalog[index]) return;

    const selectedEx = this.exerciseCatalog[index];
    const sets = prompt('Número de series:', selectedEx.default_sets || 3);
    const reps = prompt('Repeticiones por serie:', selectedEx.default_reps || 12);
    const weight = prompt('Peso en kg (0 para peso corporal):', '0');
    const rest = prompt('Segundos de descanso entre series:', selectedEx.default_rest_sec || 60);

    try {
      await fetch('/api/workout/routine-exercise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routine_id: routineId,
          exercise_id: selectedEx.id,
          sets: sets || 3,
          reps: reps || 12,
          weight_kg: weight || 0,
          rest_sec: rest || 60
        })
      });
      this.loadRoutines();
    } catch (err) {
      alert('Error al añadir ejercicio: ' + err.message);
    }
  },

  deleteRoutine: async function(id) {
    if (!confirm('¿Seguro que deseas eliminar esta rutina?')) return;
    try {
      await fetch(`/api/workout/routines/${id}`, { method: 'DELETE' });
      this.loadRoutines();
    } catch (err) {
      alert('Error al eliminar rutina: ' + err.message);
    }
  },

  loadHistory: async function() {
    try {
      const res = await fetch('/api/workout/logs');
      const logs = await res.json();
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
