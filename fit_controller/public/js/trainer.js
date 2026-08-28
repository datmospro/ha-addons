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
  prepTimerInterval: null,
  repCounter: 0,
  audioCtx: null,
  soundEnabled: true,
  beepVolume: 0.70,
  isPaused: false,
  onRestCompleteCallback: null,

  init: function() {
    this.bindEvents();

    // Unlock AudioContext on user interaction in browser/webview
    document.addEventListener('click', () => {
      this.initAudio();
    }, { once: false });
  },

  initAudio: function() {
    try {
      if (!this.audioCtx) {
        const AudioClass = window.AudioContext || window.webkitAudioContext;
        if (AudioClass) {
          this.audioCtx = new AudioClass();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    } catch (e) {
      console.log('Audio init fallback');
    }
  },

  playAudioBeep: function(freq = 880, duration = 0.2) {
    if (!this.soundEnabled || this.isPaused) return;
    this.initAudio();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      const vol = this.beepVolume !== undefined ? this.beepVolume : 0.70;
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {
      console.error('Audio beep failed:', e);
    }
  },

  // Distinctive 3-tone victory chord for completing a series/set
  playVictoryChime: function() {
    if (!this.soundEnabled || this.isPaused) return;
    this.initAudio();
    if (!this.audioCtx) return;

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 triad
    notes.forEach((freq, idx) => {
      setTimeout(() => {
        if (!this.isPaused) this.playAudioBeep(freq, 0.25);
      }, idx * 120);
    });
  },

  toggleMasterPause: function() {
    this.isPaused = !this.isPaused;

    const overlay = document.getElementById('trainer-pause-overlay');
    const pauseTxt = document.getElementById('btn-pause-text');
    const pauseBtn = document.getElementById('btn-pause-workout');

    if (this.isPaused) {
      if (overlay) overlay.style.display = 'flex';
      if (pauseTxt) pauseTxt.textContent = 'Reanudar';
      if (pauseBtn) {
        pauseBtn.style.background = 'var(--primary)';
        pauseBtn.style.color = '#000';
      }
      if (window.MusicModule) {
        window.MusicModule.pauseMusic();
      }
    } else {
      if (overlay) overlay.style.display = 'none';
      if (pauseTxt) pauseTxt.textContent = 'Pausar';
      if (pauseBtn) {
        pauseBtn.style.background = 'rgba(245,158,11,0.2)';
        pauseBtn.style.color = 'var(--accent-yellow)';
      }
      if (window.MusicModule) {
        window.MusicModule.resumeMusic();
      }
    }
  },

  bindEvents: function() {
    const btnQuickStart = document.getElementById('btn-quick-start-workout');
    if (btnQuickStart) {
      btnQuickStart.addEventListener('click', async () => {
        this.initAudio();
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
      btnCompleteSet.addEventListener('click', () => {
        this.initAudio();
        this.handleSetCompleted();
      });
    }

    const btnSkipRest = document.getElementById('btn-skip-rest');
    if (btnSkipRest) {
      btnSkipRest.addEventListener('click', () => {
        this.initAudio();
        this.endRest(true);
      });
    }

    const btnToday = document.getElementById('btn-start-today-routine');
    if (btnToday) {
      btnToday.addEventListener('click', () => {
        this.initAudio();
        if (window.WorkoutModule.currentRoutines.length > 0) {
          this.startRoutine(window.WorkoutModule.currentRoutines[0].id);
        }
      });
    }
  },

  startRoutine: async function(routineId) {
    this.initAudio();
    this.isPaused = false;

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

    const overlay = document.getElementById('trainer-pause-overlay');
    if (overlay) overlay.style.display = 'none';

    // Auto-select a random workout music playlist and play automatically!
    if (window.MusicModule) {
      window.MusicModule.playRandomPlaylist();
    }

    // Start main workout clock
    clearInterval(this.workoutTimerInterval);
    this.workoutTimerInterval = setInterval(() => {
      if (this.isPaused) return;
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
    clearInterval(this.restTimerInterval);
    clearInterval(this.prepTimerInterval);

    const ex = this.activeRoutine.exercises[this.currentExerciseIndex];
    if (!ex) return;

    const totalEx = this.activeRoutine.exercises.length;
    const setsCount = parseInt(ex.sets || 3, 10);

    document.getElementById('trainer-exercise-progress').textContent = 
      `Ejercicio ${this.currentExerciseIndex + 1} de ${totalEx}`;

    document.getElementById('trainer-ex-name').textContent = ex.name;
    document.getElementById('trainer-ex-instructions').textContent = ex.instructions || 'Mantén la técnica correcta con respiración fluida.';

    document.getElementById('trainer-current-set').textContent = `${this.currentSetIndex} / ${setsCount}`;
    document.getElementById('trainer-target-reps').textContent = `0 / ${ex.reps}`;
    document.getElementById('trainer-weight-kg').textContent = ex.weight_kg || 0;

    // Render animation graphic (video MP4 or SVG)
    const animBox = document.getElementById('trainer-anim-container');
    animBox.innerHTML = window.WorkoutModule.getAnimationGraphicHtml(ex);

    // Show set active view
    document.getElementById('view-set-active').style.display = 'block';
    document.getElementById('view-rest-active').style.display = 'none';

    // Start 5-second preparation countdown before active set
    this.startPrepCountdown(ex);

    if (window.lucide) lucide.createIcons();
  },

  startPrepCountdown: function(ex) {
    const overlay = document.getElementById('trainer-prep-overlay');
    const prepSecondsEl = document.getElementById('trainer-prep-seconds');
    let prepTime = parseInt(ex.prep_sec !== undefined ? ex.prep_sec : 5, 10);

    if (prepTime <= 0) {
      if (overlay) overlay.style.display = 'none';
      this.startCadenceOrIsometricPacer(ex);
      return;
    }

    if (overlay) {
      overlay.style.display = 'flex';
      if (prepSecondsEl) prepSecondsEl.textContent = prepTime;
    }

    this.playAudioBeep(600, 0.15); // Prep tick

    clearInterval(this.prepTimerInterval);
    this.prepTimerInterval = setInterval(() => {
      if (this.isPaused) return;

      prepTime--;
      if (prepTime > 0) {
        if (prepSecondsEl) prepSecondsEl.textContent = prepTime;
        this.playAudioBeep(600, 0.15);
      } else {
        if (prepSecondsEl) prepSecondsEl.textContent = "¡VAMOS!";
        this.playAudioBeep(950, 0.3); // Start active set chime
        clearInterval(this.prepTimerInterval);

        setTimeout(() => {
          if (overlay) overlay.style.display = 'none';
          this.startCadenceOrIsometricPacer(ex);
        }, 600);
      }
    }, 1000);
  },

  startCadenceOrIsometricPacer: function(ex) {
    clearInterval(this.cadenceTimerInterval);
    const cadenceSec = parseInt(ex.cadence_sec !== undefined ? ex.cadence_sec : 3, 10);
    const targetReps = parseInt(ex.reps || 12, 10);

    if (ex.is_isometric) {
      // Isometric Hold Exercise (e.g. Plank for X seconds)
      let secondsLeft = targetReps;
      document.getElementById('trainer-target-reps').textContent = `${secondsLeft}s`;

      this.cadenceTimerInterval = setInterval(() => {
        if (this.isPaused) return;

        secondsLeft--;
        if (secondsLeft > 0) {
          document.getElementById('trainer-target-reps').textContent = `${secondsLeft}s`;
          if (secondsLeft <= 3) this.playAudioBeep(600, 0.15); // Warning chime
        } else {
          document.getElementById('trainer-target-reps').textContent = `0s ¡Completado!`;
          clearInterval(this.cadenceTimerInterval);
          this.playVictoryChime();

          // Auto-advance to rest or next set/exercise!
          setTimeout(() => {
            if (!this.isPaused) this.handleSetCompleted();
          }, 800);
        }
      }, 1000);

    } else if (cadenceSec > 0) {
      // Rep Cadence Pacer (Beeps on every rep cycle)
      this.repCounter = 1;
      document.getElementById('trainer-target-reps').textContent = `Rep ${this.repCounter} / ${targetReps}`;
      this.playAudioBeep(880, 0.2); // First rep beep

      let stepInCadence = cadenceSec;

      this.cadenceTimerInterval = setInterval(() => {
        if (this.isPaused) return;

        stepInCadence--;
        if (stepInCadence <= 0) {
          stepInCadence = cadenceSec;
          this.repCounter++;

          if (this.repCounter <= targetReps) {
            document.getElementById('trainer-target-reps').textContent = `Rep ${this.repCounter} / ${targetReps}`;
            this.playAudioBeep(880, 0.2); // Beep on each rep increase!
          }

          if (this.repCounter >= targetReps) {
            clearInterval(this.cadenceTimerInterval);
            this.playVictoryChime();

            // Auto-advance to rest or next set/exercise!
            setTimeout(() => {
              if (!this.isPaused) this.handleSetCompleted();
            }, 800);
          }
        }
      }, 1000);
    }
  },

  handleSetCompleted: function() {
    this.initAudio();
    clearInterval(this.cadenceTimerInterval);
    clearInterval(this.prepTimerInterval);

    const ex = this.activeRoutine.exercises[this.currentExerciseIndex];
    if (!ex) return;

    this.totalSetsCompleted++;
    const setsCount = parseInt(ex.sets || 3, 10);

    if (this.currentSetIndex < setsCount) {
      // More sets left in this exercise -> Rest timer then next set
      this.startRest(ex.rest_sec || 60, () => {
        this.currentSetIndex++;
        this.renderCurrentExercise();
      });
    } else {
      // All sets complete for this exercise! Advance to next exercise
      this.nextExercise();
    }
  },

  nextExercise: function() {
    this.initAudio();
    clearInterval(this.cadenceTimerInterval);
    clearInterval(this.restTimerInterval);
    clearInterval(this.prepTimerInterval);

    if (!this.activeRoutine || !this.activeRoutine.exercises) return;

    if (this.currentExerciseIndex < this.activeRoutine.exercises.length - 1) {
      this.currentExerciseIndex++;
      this.currentSetIndex = 1;
      this.renderCurrentExercise();
      this.renderUpcomingExercisesList();
    } else {
      // Final exercise complete!
      this.finishWorkout();
    }
  },

  prevExercise: function() {
    this.initAudio();
    clearInterval(this.cadenceTimerInterval);
    clearInterval(this.restTimerInterval);
    clearInterval(this.prepTimerInterval);

    if (!this.activeRoutine || !this.activeRoutine.exercises) return;

    if (this.currentExerciseIndex > 0) {
      this.currentExerciseIndex--;
      this.currentSetIndex = 1;
      this.renderCurrentExercise();
      this.renderUpcomingExercisesList();
    }
  },

  renderUpcomingExercisesList: function() {
    const container = document.getElementById('trainer-exercise-list');
    if (!container || !this.activeRoutine) return;

    container.innerHTML = this.activeRoutine.exercises.map((ex, idx) => {
      const isCurrent = idx === this.currentExerciseIndex;
      const isDone = idx < this.currentExerciseIndex;

      return `
        <div onclick="window.TrainerModule.jumpToExercise(${idx})" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: ${isCurrent ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.03)'}; border-radius: 8px; border-left: 3px solid ${isCurrent ? 'var(--primary)' : isDone ? 'var(--text-muted)' : 'transparent'};">
          <span style="font-size: 0.85rem; font-weight: ${isCurrent ? '700' : '400'}; color: ${isCurrent ? 'var(--primary)' : '#fff'};">${ex.name}</span>
          <span style="font-size: 0.75rem;" class="text-muted">${ex.sets}x${ex.reps}${ex.is_isometric ? 's' : ''}</span>
        </div>
      `;
    }).join('');
  },

  jumpToExercise: function(index) {
    this.initAudio();
    clearInterval(this.cadenceTimerInterval);
    clearInterval(this.restTimerInterval);
    clearInterval(this.prepTimerInterval);

    if (index >= 0 && index < this.activeRoutine.exercises.length) {
      this.currentExerciseIndex = index;
      this.currentSetIndex = 1;
      this.renderCurrentExercise();
      this.renderUpcomingExercisesList();
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
      if (this.isPaused) return;

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
    this.isPaused = false;
    clearInterval(this.workoutTimerInterval);
    clearInterval(this.restTimerInterval);
    clearInterval(this.cadenceTimerInterval);
    clearInterval(this.prepTimerInterval);

    const overlayPrep = document.getElementById('trainer-prep-overlay');
    if (overlayPrep) overlayPrep.style.display = 'none';

    const overlayPause = document.getElementById('trainer-pause-overlay');
    if (overlayPause) overlayPause.style.display = 'none';

    document.getElementById('modal-trainer').classList.remove('active');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.TrainerModule.init();
});
