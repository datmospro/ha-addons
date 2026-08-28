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
      'diet': { title: 'Planificador Semanal de Dieta', subtitle: 'Control de comidas e ingredientes ajustados a las personas.' },
      'recipe-finder': { title: 'Buscador de Recetas Saludables', subtitle: 'Filtra por calorías, proteína y carbohidratos en bases abiertas.' },
      'workout': { title: 'Rutinas & Ejercicios', subtitle: 'Planifica tus entrenamientos con animaciones explicativas.' },
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
        if (tabKey === 'diet' && window.DietModule) window.DietModule.loadPlan();
        if (tabKey === 'recipe-finder' && window.RecipeModule) window.RecipeModule.search();
        if (tabKey === 'workout' && window.WorkoutModule) window.WorkoutModule.loadRoutinesAndCatalog();
        if (tabKey === 'history' && window.WorkoutModule) window.WorkoutModule.loadHistory();
      });
    });
  },

  bindPeopleScaler: function() {
    const scalerSelect = document.getElementById('global-people-scaler');
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

      document.getElementById('global-people-scaler').value = this.peopleCount;
      this.renderDashboardProfile();
    } catch (err) {
      console.error('Error loading profile:', err);
    }
  },

  renderDashboardProfile: function() {
    if (!this.currentProfile) return;
    const p = this.currentProfile;

    document.getElementById('dash-kcal-target').textContent = `${p.daily_kcal_target.toLocaleString()} kcal`;
    document.getElementById('dash-tdee-info').textContent = `Peso: ${p.weight_kg}kg | Déficit: ${p.weekly_weight_loss_kg}kg/sem`;
    document.getElementById('dash-current-weight').textContent = `${p.weight_kg.toFixed(1)} kg`;
    document.getElementById('dash-target-weight').textContent = `→ Meta: ${p.target_weight_kg.toFixed(1)} kg`;
    document.getElementById('dash-weekly-rate').textContent = `Ritmo: -${p.weekly_weight_loss_kg} kg por semana`;

    document.getElementById('macro-txt-kcal').textContent = `0 / ${p.daily_kcal_target} kcal`;
    document.getElementById('macro-txt-protein').textContent = `0 / ${p.daily_protein_target} g`;
    document.getElementById('macro-txt-carbs').textContent = `0 / ${p.daily_carbs_target} g`;
    document.getElementById('macro-txt-fat').textContent = `0 / ${p.daily_fat_target} g`;

    // Populate modal inputs
    document.getElementById('prof-age').value = p.age;
    document.getElementById('prof-gender').value = p.gender;
    document.getElementById('prof-weight').value = p.weight_kg;
    document.getElementById('prof-height').value = p.height_cm;
    document.getElementById('prof-target-weight').value = p.target_weight_kg;
    document.getElementById('prof-rate').value = p.weekly_weight_loss_kg;
    document.getElementById('prof-activity').value = p.activity_level;
  },

  bindProfileEvents: function() {
    const modal = document.getElementById('modal-profile');
    document.getElementById('btn-open-profile-modal').addEventListener('click', () => modal.classList.add('active'));
    document.getElementById('btn-close-profile').addEventListener('click', () => modal.classList.remove('active'));

    document.getElementById('form-profile-settings').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        age: document.getElementById('prof-age').value,
        gender: document.getElementById('prof-gender').value,
        weight_kg: document.getElementById('prof-weight').value,
        height_cm: document.getElementById('prof-height').value,
        target_weight_kg: document.getElementById('prof-target-weight').value,
        weekly_weight_loss_kg: document.getElementById('prof-rate').value,
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
        modal.classList.remove('active');
        if (window.DietModule) window.DietModule.loadPlan();
      } catch (err) {
        alert('Error al guardar el perfil: ' + err.message);
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.FitApp.init();
});
