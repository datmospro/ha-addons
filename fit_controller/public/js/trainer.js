// Interactive Guided Workout Engine ("Empezar Entrenamiento")
window.TrainerModule = {
  activeRoutine: null,
  currentExerciseIndex: 0,
  currentSetIndex: 1,
  totalSetsCompleted: 0,
  workoutSeconds: 0,
  workoutTimerInterval: null,
  restSeconds: 0,
  restTimerInterval: null,
  cadenceTimerInterval: null,
  repCounter: 0,
  audioCtx: null,
  soundEnabled: true,
  onRestCompleteCallback: null,

  init: function() {
    this.bindEvents();
  },

  bindEvents: function() {
    const btnQuickStart = document.getElementById('btn-quick-start-workout');
    if (btnQuickStart) {
      btnQuickStart.addEventListener('click', async () => {
        const routines = window.WorkoutModule.currentRoutines;
        if (!routines || routines.length === 0) {
          await window.WorkoutModule.loadRoutines();
        }
        if (window.WorkoutModule.currentRoutines.length > 0) {
          this.startRoutine(window.WorkoutModule.currentRoutines[0].id);
        } else {
          alert('Por favor crea una rutina en la pestaña "Rutinas & Ejercicios" primero.');
        }
      });
    }

    const btnClose = document.getElementById('btn-close-trainer');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.stopWorkout(false));
    }

    const btnCompleteSet = document.getElementById('btn-complete-set');
    if (btnCompleteSet) {
      btnCompleteSet.addEventListener('click', () => this.handleSetCompleted());
    }

    const btnSkipRest = document.getElementById('btn-skip-rest');
    if (btnSkipRest) {
      btnSkipRest.addEventListener('click', () => this.endRest(true));
    }

    const btnToday = document.getElementById('btn-start-today-routine');
    if (btnToday) {
      btnToday.addEventListener('click', () => {
        if (window.WorkoutModule.currentRoutines.length > 0) {
          this.startRoutine(window.WorkoutModule.currentRoutines[0].id);
        }
      });
    }
  },

  startRoutine: async function(routineId) {
    let routine = (window.WorkoutModule.currentRoutines || []).find(r => r.id === routineId);
    if (!routine) {
      const routines = await window.apiFetch('api/workout/routines');
      routine = routines.find(r => r.id === routineId);
    }

    if (!routine || !routine.exercises || routine.exercises.length === 0) {
      alert('Esta rutina no contiene ejercicios.');
      return;
    }

    this.activeRoutine = routine;
    this.currentExerciseIndex = 0;
    this.currentSetIndex = 1;
    this.totalSetsCompleted = 0;
    this.workoutSeconds = 0;

    document.getElementById('trainer-routine-name').textContent = routine.name;
    document.getElementById('modal-trainer').classList.add('active');

    // Start main workout clock
    clearInterval(this.workoutTimerInterval);
    this.workoutTimerInterval = setInterval(() => {
      this.workoutSeconds++;
      const m = String(Math.floor(this.workoutSeconds / 60)).padStart(2, '0');
      const s = String(this.workoutSeconds % 60).padStart(2, '0');
      document.getElementById('trainer-total-timer').textContent = `${m}:${s}`;
    }, 1000);

    this.renderCurrentExercise();
    this.renderUpcomingExercisesList();
  },

  renderCurrentExercise: function() {
    clearInterval(this.cadenceTimerInterval);
    const ex = this.activeRoutine.exercises[this.currentExerciseIndex];
    if (!ex) return;

    document.getElementById('trainer-exercise-progress').textContent = 
      `Ejercicio ${this.currentExerciseIndex + 1} de ${this.activeRoutine.exercises.length}`;

    document.getElementById('trainer-ex-name').textContent = ex.name;
    document.getElementById('trainer-ex-instructions').textContent = ex.instructions || 'Mantén la técnica correcta con respiración fluida.';

    document.getElementById('trainer-current-set').textContent = `${this.currentSetIndex} / ${ex.sets}`;
    document.getElementById('trainer-target-reps').textContent = ex.reps;
    document.getElementById('trainer-weight-kg').textContent = ex.weight_kg || 0;

    // Render animation graphic (video MP4 or SVG)
    const animBox = document.getElementById('trainer-anim-container');
    animBox.innerHTML = window.WorkoutModule.getAnimationGraphicHtml(ex);

    // Show set active view
    document.getElementById('view-set-active').style.display = 'block';
    document.getElementById('view-rest-active').style.display = 'none';

    // Start Audio Cadence Pacer or Isometric Hold Timer
    this.startCadenceOrIsometricPacer(ex);

    if (window.lucide) lucide.createIcons();
  },

  startCadenceOrIsometricPacer: function(ex) {
    clearInterval(this.cadenceTimerInterval);
    this.playAudioBeep(880, 0.2); // Start set chime

    const cadenceSec = parseInt(ex.cadence_sec || 3, 10);

    if (ex.is_isometric) {
      // Isometric Hold Exercise (e.g. Plank for X seconds)
      let secondsLeft = parseInt(ex.reps || 45, 10);
      document.getElementById('trainer-target-reps').textContent = `${secondsLeft}s`;

      this.cadenceTimerInterval = setInterval(() => {
        secondsLeft--;
        if (secondsLeft > 0) {
          document.getElementById('trainer-target-reps').textContent = `${secondsLeft}s`;
          if (secondsLeft <= 3) this.playAudioBeep(600, 0.15); // Countdown warning
        } else {
          document.getElementById('trainer-target-reps').textContent = `0s ¡Listo!`;
          clearInterval(this.cadenceTimerInterval);
          this.playAudioBeep(1046, 0.4); // Double success chime
        }
      }, 1000);

    } else if (cadenceSec > 0) {
      // Rep Cadence Pacer (Beeps on every rep cycle)
      this.repCounter = 0;
      const targetReps = parseInt(ex.reps || 12, 10);
      let stepInCadence = cadenceSec;

      this.cadenceTimerInterval = setInterval(() => {
        stepInCadence--;
        if (stepInCadence <= 0) {
          stepInCadence = cadenceSec;
          this.repCounter++;
          this.playAudioBeep(880, 0.2); // Rep cadence beep

          if (this.repCounter >= targetReps) {
            clearInterval(this.cadenceTimerInterval);
            this.playAudioBeep(1046, 0.4); // Series finish chime
          }
        }
      }, 1000);
    }
  },

  renderUpcomingExercisesList: function() {
    const container = document.getElementById('trainer-exercise-list');
    if (!container) return;

    container.innerHTML = this.activeRoutine.exercises.map((ex, idx) => {
      const isCurrent = idx === this.currentExerciseIndex;
      const isDone = idx < this.currentExerciseIndex;

      return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: ${isCurrent ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.03)'}; border-radius: 8px; border-left: 3px solid ${isCurrent ? 'var(--primary)' : isDone ? 'var(--text-muted)' : 'transparent'};">
          <span style="font-size: 0.85rem; font-weight: ${isCurrent ? '700' : '400'}; color: ${isCurrent ? 'var(--primary)' : '#fff'};">${ex.name}</span>
          <span style="font-size: 0.75rem;" class="text-muted">${ex.sets}x${ex.reps}${ex.is_isometric ? 's' : ''}</span>
        </div>
      `;
    }).join('');
  },

  handleSetCompleted: function() {
    clearInterval(this.cadenceTimerInterval);
    const ex = this.activeRoutine.exercises[this.currentExerciseIndex];
    this.totalSetsCompleted++;

    if (this.currentSetIndex < ex.sets) {
      // More sets left in this exercise -> Rest timer
      this.startRest(ex.rest_sec || 60, () => {
        this.currentSetIndex++;
        this.renderCurrentExercise();
      });
    } else {
      // Exercise complete! Move to next exercise or finish routine
      if (this.currentExerciseIndex < this.activeRoutine.exercises.length - 1) {
        this.startRest(ex.rest_sec || 60, () => {
          this.currentExerciseIndex++;
          this.currentSetIndex = 1;
          this.renderCurrentExercise();
          this.renderUpcomingExercisesList();
        });
      } else {
        // Routine completed!
        this.finishWorkout();
      }
    }
  },

  startRest: function(seconds, onComplete) {
    this.restSeconds = seconds;
    this.onRestCompleteCallback = onComplete;

    document.getElementById('view-set-active').style.display = 'none';
    document.getElementById('view-rest-active').style.display = 'block';
    document.getElementById('trainer-rest-seconds').textContent = `${this.restSeconds}s`;

    clearInterval(this.restTimerInterval);
    this.restTimerInterval = setInterval(() => {
      this.restSeconds--;
      document.getElementById('trainer-rest-seconds').textContent = `${this.restSeconds}s`;

      if (this.restSeconds <= 0) {
        this.playAudioBeep(1046, 0.3);
        this.endRest(true);
      }
    }, 1000);
  },

  endRest: function(shouldAdvance = true) {
    clearInterval(this.restTimerInterval);
    document.getElementById('view-set-active').style.display = 'block';
    document.getElementById('view-rest-active').style.display = 'none';

    if (shouldAdvance && this.onRestCompleteCallback) {
      const cb = this.onRestCompleteCallback;
      this.onRestCompleteCallback = null;
      cb();
    }
  },

  playAudioBeep: function(freq = 880, duration = 0.2) {
    if (!this.soundEnabled) return;
    try {
      if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + duration);
      osc.start();
      osc.stop(this.audioCtx.currentTime + duration);
    } catch (e) {
      console.log('Audio beep fallback');
    }
  },

  finishWorkout: async function() {
    this.stopWorkout(true);

    const kcalBurned = Math.round((this.workoutSeconds / 60) * 7.5);
    alert(`🎉 ¡Entrenamiento Completado con Éxito!\n\nDuración: ${Math.floor(this.workoutSeconds / 60)} min\nSeries totales: ${this.totalSetsCompleted}\nCalorías quemadas est.: ${kcalBurned} kcal`);

    try {
      await window.apiFetch('api/workout/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routine_id: this.activeRoutine.id,
          routine_name: this.activeRoutine.name,
          duration_sec: this.workoutSeconds,
          sets_completed: this.totalSetsCompleted,
          kcal_burned: kcalBurned
        })
      });
      if (window.WorkoutModule) window.WorkoutModule.loadHistory();
    } catch (err) {
      console.error('Error logging workout:', err);
    }
  },

  stopWorkout: function(isFinished = false) {
    clearInterval(this.workoutTimerInterval);
    clearInterval(this.restTimerInterval);
    clearInterval(this.cadenceTimerInterval);
    document.getElementById('modal-trainer').classList.remove('active');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.TrainerModule.init();
});
