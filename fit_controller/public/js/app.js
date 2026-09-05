// Core Application State & Global Helper Module

// Robust fetch helper for HA Ingress relative routing
window.apiFetch = async function(endpoint, options = {}) {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
  const res = await fetch(cleanEndpoint, options);
  
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Error ${res.status}: ${errorText}`);
  }
  
  return res.json();
};

window.FitApp = {
  currentProfile: null,
  peopleCount: 1,

  init: async function() {
    this.bindNavigation();
    this.bindProfileEvents();
    this.bindPeopleScaler();
    await this.loadProfile();

    if (window.ProgressModule) {
      window.ProgressModule.init();
    }

    if (window.lucide) {
      lucide.createIcons();
    }
  },

  bindNavigation: function() {
    const navButtons = document.querySelectorAll('.nav-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');
    const titleEl = document.getElementById('tab-title');
    const subtitleEl = document.getElementById('tab-subtitle');

    const tabMeta = {
      'dashboard': { title: 'Dashboard Fit', subtitle: 'Resumen de déficit calórico, macros y rutina de hoy.' },
      'diet': { title: 'Planificador Semanal de Dieta & Mis Platos', subtitle: 'Control de comidas, catálogo de recetas e ingredientes ajustados a las personas.' },
      'workout': { title: 'Rutinas & Ejercicios', subtitle: 'Planifica tus entrenamientos con animaciones explicativas.' },
      'progress': { title: 'Seguimiento de Progreso & Fotos', subtitle: 'Evolución de peso, medidas corporales y comparador visual de fotos antes vs después.' },
      'history': { title: 'Historial de Entrenos', subtitle: 'Registro de tus entrenamientos completados y calorías quemadas.' },
      'settings': { title: 'Configuración & Música', subtitle: 'Administra tus listas de reproducción de música para entrenar y preferencias.' }
    };

    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabKey = btn.getAttribute('data-tab');

        navButtons.forEach(b => b.classList.remove('active'));
        tabPanels.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const targetPanel = document.getElementById(`panel-${tabKey}`);
        if (targetPanel) targetPanel.classList.add('active');

        if (tabMeta[tabKey]) {
          titleEl.textContent = tabMeta[tabKey].title;
          subtitleEl.textContent = tabMeta[tabKey].subtitle;
        }

        // Trigger tab specific loads
        if (tabKey === 'diet' && window.DietModule) window.DietModule.loadPlanAndRecipes();
        if (tabKey === 'workout' && window.WorkoutModule) window.WorkoutModule.loadRoutinesAndCatalog();
        if (tabKey === 'progress' && window.ProgressModule) window.ProgressModule.loadAll();
        if (tabKey === 'history' && window.WorkoutModule) window.WorkoutModule.loadHistory();
      });
    });
  },

  bindPeopleScaler: function() {
    const scalerSelect = document.getElementById('global-people-scaler');
    if (!scalerSelect) return;

    scalerSelect.addEventListener('change', async (e) => {
      this.peopleCount = parseInt(e.target.value, 10);
      
      try {
        await window.apiFetch('api/diet/people-count', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ people_count: this.peopleCount })
        });
      } catch (err) {
        console.error('Error saving people count:', err);
      }

      // Refresh current tab data
      if (window.DietModule) window.DietModule.loadPlan();
    });
  },

  loadProfile: async function() {
    try {
      const data = await window.apiFetch('api/profile');
      this.currentProfile = data;
      this.peopleCount = data.default_people_count || 1;

      const scalerSelect = document.getElementById('global-people-scaler');
      if (scalerSelect) scalerSelect.value = this.peopleCount;

      this.renderDashboardProfile();
    } catch (err) {
      console.error('Error loading profile:', err);
    }
  },

  renderDashboardProfile: function() {
    if (!this.currentProfile) return;
    const p = this.currentProfile;

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val !== undefined && val !== null ? val : '';
    };

    setTxt('dash-kcal-target', `${(p.daily_kcal_target || 1850).toLocaleString()} kcal`);
    setTxt('dash-tdee-info', `Peso: ${p.weight_kg || 80}kg | Déficit: ${p.weekly_weight_loss_kg || 0.5}kg/sem`);
    setTxt('dash-current-weight', `${p.weight_kg ? Number(p.weight_kg).toFixed(1) : '80.0'} kg`);
    setTxt('dash-target-weight', `→ Meta: ${p.target_weight_kg ? Number(p.target_weight_kg).toFixed(1) : '70.0'} kg`);
    setTxt('dash-weekly-rate', `Ritmo: -${p.weekly_weight_loss_kg || 0.5} kg por semana`);

    setTxt('macro-txt-kcal', `0 / ${p.daily_kcal_target || 1850} kcal`);
    setTxt('macro-txt-protein', `0 / ${p.daily_protein_target || 140} g`);
    setTxt('macro-txt-carbs', `0 / ${p.daily_carbs_target || 160} g`);
    setTxt('macro-txt-fat', `0 / ${p.daily_fat_target || 55} g`);

    // Populate modal inputs safely
    setVal('prof-age', p.age);
    setVal('prof-gender', p.gender);
    setVal('prof-weight', p.weight_kg);
    setVal('prof-height', p.height_cm);
    setVal('prof-target-weight', p.target_weight_kg);
    setVal('prof-rate', p.weekly_weight_loss_kg);
    setVal('prof-activity', p.activity_level);
  },

  bindProfileEvents: function() {
    const modal = document.getElementById('modal-profile');
    const btnOpen = document.getElementById('btn-open-profile-modal');
    if (btnOpen && modal) {
      btnOpen.addEventListener('click', () => {
        modal.style.display = 'flex';
        modal.classList.add('active');
      });
    }
    const btnClose = document.getElementById('btn-close-profile');
    if (btnClose && modal) {
      btnClose.addEventListener('click', () => {
        modal.style.display = 'none';
        modal.classList.remove('active');
      });
    }

    const formProfile = document.getElementById('form-profile-settings');
    if (formProfile) {
      formProfile.addEventListener('submit', async (e) => {
        e.preventDefault();

        const parseNum = (val) => {
          if (typeof val === 'string') val = val.replace(',', '.');
          const p = parseFloat(val);
          return isNaN(p) ? null : p;
        };

        const body = {
          age: parseNum(document.getElementById('prof-age').value),
          gender: document.getElementById('prof-gender').value,
          weight_kg: parseNum(document.getElementById('prof-weight').value),
          height_cm: parseNum(document.getElementById('prof-height').value),
          target_weight_kg: parseNum(document.getElementById('prof-target-weight').value),
          weekly_weight_loss_kg: parseNum(document.getElementById('prof-rate').value),
          activity_level: document.getElementById('prof-activity').value
        };

        try {
          const updated = await window.apiFetch('api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          this.currentProfile = updated;
          this.renderDashboardProfile();
          if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('active');
          }
          if (window.DietModule) window.DietModule.loadPlan();
        } catch (err) {
          alert('Error al guardar el perfil: ' + err.message);
        }
      });
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.FitApp.init();
});
