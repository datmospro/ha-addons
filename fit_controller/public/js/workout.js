// Workout Routine & Exercise Catalog Module
window.WorkoutModule = {
  currentRoutines: [],
  exerciseCatalog: [],
  selectedRoutineForDetails: null,

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
      this.renderRoutineCalendar();
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

  getCurrentDayOfWeekSpanish: function() {
    const daysMap = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    return daysMap[new Date().getDay()];
  },

  renderRoutineCalendar: function() {
    const calendarGrid = document.getElementById('workout-calendar-grid');
    if (!calendarGrid) return;

    const days = [
      { key: 'lunes', label: 'Lunes' },
      { key: 'martes', label: 'Martes' },
      { key: 'miercoles', label: 'Miércoles' },
      { key: 'jueves', label: 'Jueves' },
      { key: 'viernes', label: 'Viernes' },
      { key: 'sabado', label: 'Sábado' },
      { key: 'domingo', label: 'Domingo' }
    ];

    const todayKey = this.getCurrentDayOfWeekSpanish();

    calendarGrid.style.display = 'grid';
    calendarGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(280px, 1fr))';
    calendarGrid.style.gap = '16px';

    calendarGrid.innerHTML = days.map(d => {
      const isToday = d.key === todayKey;
      const routine = this.currentRoutines.find(r => (r.day_of_week || '').toLowerCase() === d.key);

      if (routine) {
        const exCount = routine.exercises ? routine.exercises.length : 0;

        return `
          <div class="card" style="background: rgba(30, 41, 59, 0.7); border: 1px solid ${isToday ? 'var(--primary)' : 'var(--border-color)'}; box-shadow: ${isToday ? '0 0 20px rgba(16,185,129,0.2)' : 'none'}; display: flex; flex-direction: column; justify-content: space-between; border-radius: 14px; padding: 16px;">
            <div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 1.1rem; font-weight: 900; text-transform: uppercase; color: ${isToday ? 'var(--primary)' : '#fff'};">${d.label}</span>
                  ${isToday ? `<span class="badge" style="background: var(--primary); color: #000; font-size: 0.68rem; font-weight: 900; padding: 2px 6px; border-radius: 4px;">HOY</span>` : ''}
                </div>
                <span class="badge" style="background: rgba(16,185,129,0.15); color: var(--primary); font-size: 0.72rem; font-weight: 700; padding: 3px 8px; border-radius: 6px;">
                  <i data-lucide="dumbbell" style="width: 10px; height: 10px;"></i> ${exCount} Ejercicios
                </span>
              </div>

              <h4 style="font-size: 1.15rem; font-weight: 800; color: var(--primary); margin-bottom: 4px;">${routine.name}</h4>
              <p class="text-muted" style="font-size: 0.8rem; margin-bottom: 12px;">${routine.description || 'Rutina asignada para este día'}</p>

              <!-- Exercises Preview Pills -->
              <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px;">
                ${(routine.exercises || []).slice(0, 4).map(e => `
                  <div style="font-size: 0.78rem; background: rgba(15,23,42,0.7); border: 1px solid rgba(255,255,255,0.05); padding: 6px 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 600; color: #e2e8f0;">${e.name}</span>
                    <strong style="color: var(--accent-cyan); font-size: 0.75rem;">${e.sets}x${e.reps}${e.is_isometric ? 's' : ''}</strong>
                  </div>
                `).join('')}
                ${(routine.exercises || []).length > 4 ? `<span class="text-muted" style="font-size: 0.72rem; text-align: center;">+ ${(routine.exercises || []).length - 4} ejercicios más...</span>` : ''}
              </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--border-color);">
              <div style="display: flex; gap: 6px;">
                <button class="btn btn-primary" onclick="window.TrainerModule.startRoutine(${routine.id})" style="flex: 1; font-size: 0.82rem; padding: 8px; font-weight: 800; justify-content: center;">
                  <i data-lucide="play" style="width: 14px; height: 14px;"></i> Entrenar
                </button>
                <button class="btn btn-secondary" onclick="window.WorkoutModule.openRoutineDetailsModal(${routine.id})" style="font-size: 0.82rem; padding: 8px;" title="Ver Animaciones y Vídeos">
                  <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
                </button>
              </div>

              <div style="display: flex; gap: 6px;">
                <button class="btn btn-secondary" onclick="window.WorkoutModule.openEditRoutineModal(${routine.id})" style="flex: 1; font-size: 0.78rem; padding: 6px; justify-content: center;">
                  <i data-lucide="edit-3" style="width: 12px; height: 12px;"></i> Editar
                </button>
                <button class="btn btn-secondary" onclick="window.WorkoutModule.openAddExerciseModal(${routine.id})" style="font-size: 0.78rem; padding: 6px; justify-content: center;" title="Añadir Ejercicio">
                  <i data-lucide="plus" style="width: 12px; height: 12px;"></i> Ejercicio
                </button>
                <button class="btn btn-secondary" onclick="window.WorkoutModule.deleteRoutine(${routine.id})" style="padding: 6px; font-size: 0.78rem; color: var(--accent-red); border-color: rgba(239,68,68,0.2);" title="Eliminar Rutina">
                  <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
                </button>
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="card" style="background: rgba(15, 23, 42, 0.4); border: 1px dashed var(--border-color); display: flex; flex-direction: column; justify-content: space-between; border-radius: 14px; padding: 16px; opacity: 0.85;">
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
              <span style="font-size: 1.1rem; font-weight: 900; text-transform: uppercase; color: ${isToday ? 'var(--primary)' : 'var(--text-muted)'};">${d.label}</span>
              ${isToday ? `<span class="badge" style="background: var(--primary); color: #000; font-size: 0.68rem; font-weight: 900; padding: 2px 6px; border-radius: 4px;">HOY</span>` : '<span class="text-muted" style="font-size: 0.75rem;">Descanso</span>'}
            </div>

            <div style="text-align: center; padding: 24px 0;">
              <i data-lucide="coffee" style="width: 32px; height: 32px; color: var(--text-muted); opacity: 0.5; margin-bottom: 8px;"></i>
              <p class="text-muted" style="font-size: 0.82rem;">Día de descanso o recuperación activa</p>
            </div>
          </div>

          <button class="btn btn-secondary" onclick="window.WorkoutModule.openCreateRoutineModalForDay('${d.key}')" style="width: 100%; font-size: 0.8rem; justify-content: center; margin-top: auto;">
            <i data-lucide="plus-circle" style="width: 14px; height: 14px;"></i> Asignar Rutina
          </button>
        </div>
      `;
    }).join('');

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

        <div style="display: flex; gap: 8px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border-color);">
          <button class="btn btn-secondary" onclick="window.WorkoutModule.openEditExerciseModal(${ex.id})" style="flex: 1; font-size: 0.78rem; padding: 6px; justify-content: center;">
            <i data-lucide="edit-3" style="width: 12px; height: 12px;"></i> Editar
          </button>
          <button class="btn btn-secondary" onclick="window.WorkoutModule.deleteExerciseFromCatalog(${ex.id})" style="padding: 6px; font-size: 0.78rem; color: var(--accent-red); border-color: rgba(239,68,68,0.2);" title="Eliminar del catálogo">
            <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
          </button>
        </div>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
  },

  getAnimationGraphicHtml: function(ex) {
    if (ex.animation_url && ex.animation_url.trim().length > 5) {
      const url = ex.animation_url.trim();
      
      // If the URL is an MP4 video (like GymVisual .mp4 links), render an HTML5 autoplay loop video tag!
      if (url.toLowerCase().endsWith('.mp4') || url.toLowerCase().includes('.mp4') || url.includes('/vid/')) {
        return `
          <video src="${url}" autoplay loop muted playsinline style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px;">
            Tu navegador no soporta vídeo HTML5.
          </video>
        `;
      }
      
      // Standard image/GIF tag
      return `<img src="${url}" alt="${ex.name}" onerror="this.onerror=null; this.parentNode.innerHTML=window.WorkoutModule.getSvgFallbackHtml('${ex.animation_data || ex.muscle_group}');">`;
    }
    return this.getSvgFallbackHtml(ex.animation_data || ex.muscle_group);
  },

  getSvgFallbackHtml: function(key) {
    const keyLower = String(key || '').toLowerCase();
    
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

    if (keyLower.includes('curl') || keyLower.includes('brazo') || keyLower.includes('bicep') || keyLower.includes('tricep')) {
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
    // 1. Create / Edit Routine Modal
    const modalCreateRoutine = document.getElementById('modal-create-routine');
    const btnOpenCreateRoutine = document.getElementById('btn-open-create-routine-modal');
    const btnCloseCreateRoutine = document.getElementById('btn-close-create-routine');

    if (btnOpenCreateRoutine) {
      btnOpenCreateRoutine.addEventListener('click', () => {
        document.getElementById('routine-edit-id').value = '';
        document.getElementById('form-create-routine').reset();
        document.getElementById('modal-routine-title-text').textContent = 'Crear Nueva Rutina';
        modalCreateRoutine.classList.add('active');
      });
    }
    if (btnCloseCreateRoutine) {
      btnCloseCreateRoutine.addEventListener('click', () => modalCreateRoutine.classList.remove('active'));
    }

    const formCreateRoutine = document.getElementById('form-create-routine');
    if (formCreateRoutine) {
      formCreateRoutine.addEventListener('submit', async (e) => {
        e.preventDefault();
        const editId = document.getElementById('routine-edit-id').value;
        const name = document.getElementById('routine-name-input').value;
        const day_of_week = document.getElementById('routine-day-select').value;
        const description = document.getElementById('routine-desc-input').value;

        try {
          if (editId) {
            await window.apiFetch(`api/workout/routines/${editId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, day_of_week, description })
            });
          } else {
            await window.apiFetch('api/workout/routines', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, day_of_week, description })
            });
          }
          modalCreateRoutine.classList.remove('active');
          formCreateRoutine.reset();
          this.loadRoutines();
        } catch (err) {
          alert('Error al guardar rutina: ' + err.message);
        }
      });
    }

    // 2. Routine Details Modal (Previews exercise videos at a glance)
    const modalDetails = document.getElementById('modal-routine-details');
    const btnCloseDetails = document.getElementById('btn-close-routine-details');
    if (btnCloseDetails) {
      btnCloseDetails.addEventListener('click', () => modalDetails.classList.remove('active'));
    }

    const btnStartFromDetails = document.getElementById('btn-start-from-details');
    if (btnStartFromDetails) {
      btnStartFromDetails.addEventListener('click', () => {
        if (this.selectedRoutineForDetails) {
          modalDetails.classList.remove('active');
          window.TrainerModule.startRoutine(this.selectedRoutineForDetails.id);
        }
      });
    }

    // 3. Add Exercise to Routine Modal
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

    // 4. Create / Edit Exercise Modal
    const modalCreateEx = document.getElementById('modal-create-exercise');
    const btnOpenCreateEx = document.getElementById('btn-open-create-exercise-modal');
    const btnCloseCreateEx = document.getElementById('btn-close-create-exercise');

    if (btnOpenCreateEx) {
      btnOpenCreateEx.addEventListener('click', () => {
        document.getElementById('edit-ex-id').value = '';
        document.getElementById('form-create-exercise').reset();
        document.getElementById('modal-create-exercise-title').innerHTML = `<i data-lucide="dumbbell"></i> Crear Ejercicio Personalizado`;
        modalCreateEx.classList.add('active');
      });
    }
    if (btnCloseCreateEx) {
      btnCloseCreateEx.addEventListener('click', () => modalCreateEx.classList.remove('active'));
    }

    const formCreateEx = document.getElementById('form-create-exercise');
    if (formCreateEx) {
      formCreateEx.addEventListener('submit', async (e) => {
        e.preventDefault();
        const editId = document.getElementById('edit-ex-id').value;

        const body = {
          name: document.getElementById('new-ex-name').value,
          muscle_group: document.getElementById('new-ex-muscle').value,
          equipment: document.getElementById('new-ex-equipment').value,
          instructions: document.getElementById('new-ex-instructions').value,
          animation_url: document.getElementById('new-ex-anim-url').value,
          cadence_sec: document.getElementById('new-ex-cadence').value || 3,
          is_isometric: document.getElementById('new-ex-isometric').checked ? 1 : 0,
          prep_sec: document.getElementById('new-ex-prep').value || 5,
          default_sets: 3,
          default_reps: 12,
          default_rest_sec: 60
        };

        try {
          if (editId) {
            await window.apiFetch(`api/workout/exercises/${editId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
          } else {
            await window.apiFetch('api/workout/exercises', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
          }
          modalCreateEx.classList.remove('active');
          formCreateEx.reset();
          this.loadExerciseCatalog();
          this.loadRoutines();
        } catch (err) {
          alert('Error al guardar ejercicio: ' + err.message);
        }
      });
    }
  },

  openCreateRoutineModalForDay: function(day) {
    document.getElementById('routine-edit-id').value = '';
    document.getElementById('form-create-routine').reset();
    document.getElementById('routine-day-select').value = day;
    document.getElementById('modal-routine-title-text').textContent = 'Crear Nueva Rutina';
    document.getElementById('modal-create-routine').classList.add('active');
  },

  openEditRoutineModal: function(routineId) {
    const routine = this.currentRoutines.find(r => r.id === routineId);
    if (!routine) return;

    document.getElementById('routine-edit-id').value = routine.id;
    document.getElementById('routine-name-input').value = routine.name;
    document.getElementById('routine-day-select').value = routine.day_of_week || 'lunes';
    document.getElementById('routine-desc-input').value = routine.description || '';
    document.getElementById('modal-routine-title-text').textContent = `Editar Rutina: ${routine.name}`;
    document.getElementById('modal-create-routine').classList.add('active');
  },

  openRoutineDetailsModal: function(routineId) {
    const routine = this.currentRoutines.find(r => r.id === routineId);
    if (!routine) return;

    this.selectedRoutineForDetails = routine;
    document.getElementById('details-routine-title').innerHTML = `<i data-lucide="activity"></i> ${routine.name}`;
    document.getElementById('details-routine-subtitle').textContent = `Ejercicios y vídeos para el ${routine.day_of_week} | ${routine.exercises ? routine.exercises.length : 0} Ejercicios`;

    const grid = document.getElementById('routine-details-exercises-grid');
    if (!routine.exercises || routine.exercises.length === 0) {
      grid.innerHTML = `<p class="text-muted" style="grid-column: 1/-1;">Esta rutina no tiene ejercicios asignados aún.</p>`;
    } else {
      grid.innerHTML = routine.exercises.map(ex => `
        <div style="background: rgba(15,23,42,0.8); border: 1px solid var(--border-color); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px;">
          <div style="width: 100%; height: 160px; background: #050811; border-radius: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
            ${this.getAnimationGraphicHtml(ex)}
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <h4 style="font-size: 1rem; font-weight: 800; color: var(--primary);">${ex.name}</h4>
              <span class="text-muted" style="font-size: 0.75rem;">${ex.muscle_group} | ${ex.equipment}</span>
            </div>
            <button class="btn btn-secondary" onclick="window.WorkoutModule.removeExerciseFromRoutine(${ex.routine_exercise_id})" style="padding: 4px 8px; font-size: 0.75rem; color: var(--accent-red); border-color: rgba(239,68,68,0.2);" title="Quitar de la rutina">
              <i data-lucide="x" style="width: 12px; height: 12px;"></i> Quitar
            </button>
          </div>
          <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 8px; font-size: 0.85rem; font-weight: 700; display: flex; justify-content: space-between;">
            <span>Series: <strong>${ex.sets}</strong></span>
            <span>Reps: <strong>${ex.reps}${ex.is_isometric ? 's' : ''}</strong></span>
            <span>Peso: <strong style="color: var(--accent-yellow);">${ex.weight_kg || 0}kg</strong></span>
          </div>
          <p class="text-muted" style="font-size: 0.78rem; margin-top: auto;">${ex.instructions || ''}</p>
        </div>
      `).join('');
    }

    document.getElementById('modal-routine-details').classList.add('active');
    if (window.lucide) lucide.createIcons();
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

  openEditExerciseModal: function(exerciseId) {
    const ex = this.exerciseCatalog.find(e => e.id === exerciseId);
    if (!ex) return;

    document.getElementById('edit-ex-id').value = ex.id;
    document.getElementById('new-ex-name').value = ex.name;
    document.getElementById('new-ex-muscle').value = ex.muscle_group;
    document.getElementById('new-ex-equipment').value = ex.equipment || '';
    document.getElementById('new-ex-instructions').value = ex.instructions || '';
    document.getElementById('new-ex-anim-url').value = ex.animation_url || '';
    document.getElementById('new-ex-cadence').value = ex.cadence_sec !== undefined ? ex.cadence_sec : 3;
    document.getElementById('new-ex-isometric').checked = !!ex.is_isometric;
    document.getElementById('new-ex-prep').value = ex.prep_sec !== undefined ? ex.prep_sec : 5;

    document.getElementById('modal-create-exercise-title').innerHTML = `<i data-lucide="edit-3"></i> Editar Ejercicio: ${ex.name}`;
    document.getElementById('modal-create-exercise').classList.add('active');
  },

  deleteExerciseFromCatalog: async function(exerciseId) {
    try {
      await window.apiFetch(`api/workout/exercises/${exerciseId}`, { method: 'DELETE' });
      this.loadExerciseCatalog();
      this.loadRoutines();
    } catch (err) {
      alert('Error al eliminar ejercicio: ' + err.message);
    }
  },

  removeExerciseFromRoutine: async function(routineExerciseId) {
    try {
      await window.apiFetch(`api/workout/routine-exercise/${routineExerciseId}`, { method: 'DELETE' });
      this.loadRoutines();
      if (this.selectedRoutineForDetails) {
        this.openRoutineDetailsModal(this.selectedRoutineForDetails.id);
      }
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
