// Diet & Meal Planner Module
window.DietModule = {
  currentPlanData: null,

  loadPlan: async function() {
    try {
      const people = window.FitApp.peopleCount || 1;
      const data = await window.apiFetch(`api/diet/plan?people=${people}`);
      this.currentPlanData = data;
      this.renderWeeklyGrid();
      this.updateDashboardMacros();
    } catch (err) {
      console.error('Error loading diet plan:', err);
    }
  },

  renderWeeklyGrid: function() {
    const container = document.getElementById('weekly-meal-container');
    if (!container || !this.currentPlanData) return;

    const days = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
    const mealTypes = [
      { id: 'desayuno', label: 'Desayuno' },
      { id: 'almuerzo', label: 'Almuerzo' },
      { id: 'merienda', label: 'Merienda' },
      { id: 'cena', label: 'Cena' }
    ];

    let html = '';

    days.forEach(day => {
      const dayData = this.currentPlanData[day] || { meals: [], totalsPerPerson: { kcal: 0, protein: 0, carbs: 0, fat: 0 } };
      const peopleCount = window.FitApp.peopleCount || 1;

      html += `
        <div class="day-column">
          <div class="day-header">
            <div class="day-title">${day}</div>
            <div class="day-macros-summary">
              <strong>${dayData.totalsPerPerson.kcal}</strong> kcal/pers
            </div>
          </div>
      `;

      mealTypes.forEach(mt => {
        const meal = dayData.meals.find(m => m.meal_type === mt.id);

        if (meal) {
          html += `
            <div class="meal-slot has-recipe">
              <div class="meal-type-tag">${mt.label}</div>
              <div class="recipe-title-slot">${meal.recipe_title}</div>
              <div class="recipe-macro-pill">
                <span><strong>${meal.perPerson.kcal}</strong> kcal</span>
                <span><strong>${meal.perPerson.protein}g</strong> P</span>
                <span><strong>${meal.perPerson.carbs}g</strong> C</span>
              </div>
              
              <div style="margin-top: 8px; font-size: 0.72rem; color: var(--text-muted);">
                <span>Ingredientes para ${peopleCount} ${peopleCount === 1 ? 'persona' : 'personas'}:</span>
                <ul style="padding-left: 14px; margin-top: 4px;">
                  ${meal.ingredients.slice(0, 3).map(i => `<li>${i.scaledAmount} ${i.unit} ${i.name}</li>`).join('')}
                  ${meal.ingredients.length > 3 ? `<li>... (+${meal.ingredients.length - 3} más)</li>` : ''}
                </ul>
              </div>

              <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
                <button class="btn btn-secondary" onclick="window.DietModule.removeMeal(${meal.id})" style="padding: 4px 8px; font-size: 0.7rem; color: var(--accent-red); border-color: rgba(239,68,68,0.2);">
                  <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i> Quitar
                </button>
              </div>
            </div>
          `;
        } else {
          html += `
            <div class="meal-slot">
              <div class="meal-type-tag">${mt.label}</div>
              <p class="text-muted" style="font-size: 0.78rem;">Sin receta asignada</p>
              <button class="btn btn-secondary" onclick="window.DietModule.openAssignModal('${day}', '${mt.id}')" style="margin-top: 6px; padding: 4px 8px; font-size: 0.72rem; width: 100%;">
                + Asignar
              </button>
            </div>
          `;
        }
      });

      html += `</div>`;
    });

    container.innerHTML = html;
    if (window.lucide) lucide.createIcons();
  },

  updateDashboardMacros: function() {
    if (!this.currentPlanData || !window.FitApp.currentProfile) return;
    const profile = window.FitApp.currentProfile;

    // Use Monday's plan as representative day for daily target progress
    const mondayData = this.currentPlanData['lunes'] || { totalsPerPerson: { kcal: 0, protein: 0, carbs: 0, fat: 0 } };
    const totals = mondayData.totalsPerPerson;

    document.getElementById('macro-txt-kcal').textContent = `${totals.kcal} / ${profile.daily_kcal_target} kcal`;
    document.getElementById('macro-txt-protein').textContent = `${totals.protein} / ${profile.daily_protein_target} g`;
    document.getElementById('macro-txt-carbs').textContent = `${totals.carbs} / ${profile.daily_carbs_target} g`;
    document.getElementById('macro-txt-fat').textContent = `${totals.fat} / ${profile.daily_fat_target} g`;

    // Fill bars
    const fillKcal = Math.min(100, Math.round((totals.kcal / profile.daily_kcal_target) * 100));
    const fillProt = Math.min(100, Math.round((totals.protein / profile.daily_protein_target) * 100));
    const fillCarb = Math.min(100, Math.round((totals.carbs / profile.daily_carbs_target) * 100));
    const fillFat  = Math.min(100, Math.round((totals.fat / profile.daily_fat_target) * 100));

    document.getElementById('bar-fill-kcal').style.width = `${fillKcal}%`;
    document.getElementById('bar-fill-protein').style.width = `${fillProt}%`;
    document.getElementById('bar-fill-carbs').style.width = `${fillCarb}%`;
    document.getElementById('bar-fill-fat').style.width = `${fillFat}%`;
  },

  openAssignModal: function(day, mealType) {
    if (window.RecipeModule) {
      window.RecipeModule.targetDay = day;
      window.RecipeModule.targetMealType = mealType;
      document.getElementById('btn-tab-recipe-finder').click();
    }
  },

  removeMeal: async function(id) {
    try {
      await window.apiFetch(`api/diet/plan/${id}`, { method: 'DELETE' });
      this.loadPlan();
    } catch (err) {
      alert('Error al quitar comida: ' + err.message);
    }
  },

  bindShoppingListEvents: function() {
    const modal = document.getElementById('modal-shopping-list');
    document.getElementById('btn-open-shopping-list').addEventListener('click', async () => {
      try {
        const list = await window.apiFetch('api/diet/shopping-list');
        
        const container = document.getElementById('shopping-list-content');
        if (list.length === 0) {
          container.innerHTML = '<p class="text-muted">No hay ingredientes en el plan de comidas.</p>';
        } else {
          container.innerHTML = `
            <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px;">
              ${list.map(item => `
                <li style="display: flex; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius: 8px;">
                  <span style="font-weight: 600;">${item.name}</span>
                  <span style="color: var(--primary); font-weight: 700;">${item.displayAmount}</span>
                </li>
              `).join('')}
            </ul>
          `;
        }
        modal.classList.add('active');
      } catch (err) {
        alert('Error al obtener lista de la compra: ' + err.message);
      }
    });

    document.getElementById('btn-close-shopping-list').addEventListener('click', () => {
      modal.classList.remove('active');
    });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.DietModule.bindShoppingListEvents();
});
