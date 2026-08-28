// Diet & Meal Planner Module (7-Day Calendar & Custom Recipes Catalog)
window.DietModule = {
  currentPlanData: null,
  recipeCatalog: [],
  selectedCategoryFilter: 'all',
  selectedDayForDetails: null,

  init: function() {
    this.bindEvents();
    this.bindModals();
    this.bindCategoryFilterEvents();
    this.loadPlanAndRecipes();
  },

  loadPlanAndRecipes: async function() {
    await this.loadPlan();
    await this.loadRecipeCatalog();
  },

  loadPlan: async function() {
    try {
      const people = (window.FitApp && window.FitApp.peopleCount) || 1;
      const data = await window.apiFetch(`api/diet/plan?people=${people}`);
      this.currentPlanData = data;
      this.renderWeeklyGrid();
      this.updateDashboardMacros();
    } catch (err) {
      console.error('Error loading diet plan:', err);
    }
  },

  loadRecipeCatalog: async function() {
    try {
      const data = await window.apiFetch('api/recipes');
      this.recipeCatalog = Array.isArray(data) ? data : (data.local || []);
      this.renderRecipeCatalog();
      this.populateAssignModalDropdown();
    } catch (err) {
      console.error('Error loading recipe catalog:', err);
    }
  },

  getCurrentDayOfWeekSpanish: function() {
    const daysMap = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    return daysMap[new Date().getDay()];
  },

  renderWeeklyGrid: function() {
    const container = document.getElementById('weekly-meal-container');
    if (!container || !this.currentPlanData) return;

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

    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'repeat(auto-fit, minmax(280px, 1fr))';
    container.style.gap = '16px';

    container.innerHTML = days.map(d => {
      const isToday = d.key === todayKey;
      const dayData = this.currentPlanData[d.key] || { meals: [], totalsPerPerson: { kcal: 0, protein: 0, carbs: 0, fat: 0 } };

      const mealTypes = [
        { id: 'desayuno', label: 'Desayuno' },
        { id: 'almuerzo', label: 'Almuerzo' },
        { id: 'merienda', label: 'Merienda' },
        { id: 'cena', label: 'Cena' }
      ];

      return `
        <div class="card" style="background: rgba(30, 41, 59, 0.7); border: 1px solid ${isToday ? 'var(--primary)' : 'var(--border-color)'}; box-shadow: ${isToday ? '0 0 20px rgba(16,185,129,0.2)' : 'none'}; display: flex; flex-direction: column; justify-content: space-between; border-radius: 14px; padding: 16px;">
          <div>
            <!-- Day Card Header -->
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.1rem; font-weight: 900; text-transform: uppercase; color: ${isToday ? 'var(--primary)' : '#fff'};">${d.label}</span>
                ${isToday ? `<span class="badge" style="background: var(--primary); color: #000; font-size: 0.68rem; font-weight: 900; padding: 2px 6px; border-radius: 4px;">HOY</span>` : ''}
              </div>
              <span class="badge" style="background: rgba(249,115,22,0.15); color: var(--accent-orange); font-size: 0.75rem; font-weight: 800; padding: 3px 8px; border-radius: 6px;">
                ${dayData.totalsPerPerson.kcal} kcal
              </span>
            </div>

            <!-- Macro Summary Bar -->
            <div style="background: rgba(15,23,42,0.6); padding: 6px 10px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; display: flex; justify-content: space-between; margin-bottom: 14px; border: 1px solid rgba(255,255,255,0.05);">
              <span style="color: var(--primary);">${dayData.totalsPerPerson.protein}g P</span>
              <span style="color: var(--accent-yellow);">${dayData.totalsPerPerson.carbs}g C</span>
              <span style="color: var(--accent-purple);">${dayData.totalsPerPerson.fat}g F</span>
            </div>

            <!-- Meals Slots List -->
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
              ${mealTypes.map(mt => {
                const meal = dayData.meals.find(m => m.meal_type === mt.id);
                if (meal) {
                  return `
                    <div style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); padding: 8px 10px; border-radius: 8px;">
                      <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted);">${mt.label}</span>
                        <button onclick="window.DietModule.removeMeal('${meal.id}')" style="background: none; border: none; color: var(--accent-red); cursor: pointer; padding: 0;" title="Quitar plato">
                          <i data-lucide="x" style="width: 12px; height: 12px;"></i>
                        </button>
                      </div>
                      <h5 style="font-size: 0.85rem; font-weight: 700; color: #fff; margin: 2px 0 4px 0;">${meal.recipe_title}</h5>
                      <div style="font-size: 0.72rem; color: var(--accent-cyan); font-weight: 700;">
                        ${meal.perPerson.kcal} kcal | ${meal.perPerson.protein}g P
                      </div>
                    </div>
                  `;
                }
                return `
                  <div style="background: rgba(15,23,42,0.3); border: 1px dashed var(--border-color); padding: 6px 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted);">${mt.label}</span>
                    <button class="btn btn-secondary" onclick="window.DietModule.openAssignModal('${d.key}', '${mt.id}')" style="padding: 2px 6px; font-size: 0.68rem;">
                      + Añadir
                    </button>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Day Card Footer Actions -->
          <div style="display: flex; flex-direction: column; gap: 6px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border-color);">
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-primary" onclick="window.DietModule.openDayMealDetailsModal('${d.key}')" style="flex: 1; font-size: 0.8rem; padding: 7px; font-weight: 800; justify-content: center;">
                <i data-lucide="eye" style="width: 13px; height: 13px;"></i> Ver Menú & Recetas
              </button>
              <button class="btn btn-secondary" onclick="window.DietModule.openAssignModal('${d.key}', 'almuerzo')" style="font-size: 0.8rem; padding: 7px;" title="Asignar Plato">
                <i data-lucide="plus" style="width: 13px; height: 13px;"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  },

  renderRecipeCatalog: function() {
    const grid = document.getElementById('my-recipes-catalog-grid');
    if (!grid) return;

    let filtered = this.recipeCatalog;
    if (this.selectedCategoryFilter !== 'all') {
      filtered = this.recipeCatalog.filter(r => (r.category || '').toLowerCase() === this.selectedCategoryFilter);
    }

    if (filtered.length === 0) {
      grid.innerHTML = '<p class="text-muted" style="grid-column: 1/-1;">No hay platos guardados en esta categoría.</p>';
      return;
    }

    grid.innerHTML = filtered.map(r => `
      <div class="recipe-card">
        <div style="width: 100%; height: 160px; background: #090d16; border-radius: 10px; overflow: hidden; display: flex; align-items: center; justify-content: center; position: relative;">
          ${r.image_url && r.image_url.length > 5 ? `
            <img src="${r.image_url}" alt="${r.title}" style="width: 100%; height: 100%; object-fit: cover;">
          ` : `
            <div style="text-align: center; padding: 20px; color: var(--primary);">
              <i data-lucide="utensils" style="width: 48px; height: 48px; opacity: 0.6;"></i>
            </div>
          `}
          <span class="badge" style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); color: var(--primary); text-transform: uppercase; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 6px;">
            ${r.category || 'Almuerzo'}
          </span>
        </div>

        <div class="recipe-body">
          <h4 style="font-size: 1rem; font-weight: 800; color: #fff;">${r.title}</h4>
          <p class="text-muted" style="font-size: 0.8rem; margin: 4px 0 10px 0;">${r.description || 'Plato saludable personalizado'}</p>

          <div style="background: rgba(15,23,42,0.8); border: 1px solid var(--border-color); padding: 8px 10px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; text-align: center; margin-bottom: 12px;">
            <div>
              <span style="font-size: 0.65rem; color: var(--text-muted); display: block;">KCAL</span>
              <strong style="color: var(--accent-orange);">${r.kcal}</strong>
            </div>
            <div>
              <span style="font-size: 0.65rem; color: var(--text-muted); display: block;">PROT</span>
              <strong style="color: var(--primary);">${r.protein}g</strong>
            </div>
            <div>
              <span style="font-size: 0.65rem; color: var(--text-muted); display: block;">CARB</span>
              <strong style="color: var(--accent-yellow);">${r.carbs}g</strong>
            </div>
            <div>
              <span style="font-size: 0.65rem; color: var(--text-muted); display: block;">GRAS</span>
              <strong style="color: var(--accent-purple);">${r.fat}g</strong>
            </div>
          </div>

          <div style="display: flex; gap: 8px; margin-top: auto;">
            <button class="btn btn-secondary" onclick="window.DietModule.openEditRecipeModal('${r.id}')" style="flex: 1; font-size: 0.78rem; padding: 6px; justify-content: center;">
              <i data-lucide="edit-3" style="width: 12px; height: 12px;"></i> Editar
            </button>
            <button class="btn btn-secondary" onclick="window.DietModule.deleteRecipe('${r.id}')" style="padding: 6px; font-size: 0.78rem; color: var(--accent-red); border-color: rgba(239,68,68,0.2);" title="Eliminar plato">
              <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
            </button>
          </div>
        </div>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
  },

  bindCategoryFilterEvents: function() {
    const btns = document.querySelectorAll('.filter-recipe-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedCategoryFilter = btn.getAttribute('data-cat') || 'all';
        this.renderRecipeCatalog();
      });
    });
  },

  bindEvents: function() {},

  bindModals: function() {
    // 1. Create / Edit Recipe Modal Form Handler
    const modalCreateR = document.getElementById('modal-create-recipe');
    const btnCloseCreateR = document.getElementById('btn-close-create-recipe');

    if (btnCloseCreateR && modalCreateR) {
      btnCloseCreateR.addEventListener('click', () => {
        modalCreateR.style.display = 'none';
        modalCreateR.classList.remove('active');
      });
    }

    const formCreateR = document.getElementById('form-create-recipe');
    if (formCreateR) {
      formCreateR.addEventListener('submit', async (e) => {
        e.preventDefault();
        const editId = document.getElementById('edit-recipe-id').value;

        const rawIngredients = document.getElementById('new-recipe-ingredients').value;
        const ingredientsList = rawIngredients.split('\n').filter(line => line.trim().length > 0).map(line => {
          const parts = line.split(':');
          if (parts.length > 1) {
            return { name: parts[0].trim(), amount: parts[1].trim(), unit: '' };
          }
          return { name: line.trim(), amount: 'al gusto', unit: '' };
        });

        const rawInstructions = document.getElementById('new-recipe-instructions').value;
        const instructionsList = rawInstructions.split('\n').filter(line => line.trim().length > 0);

        const body = {
          title: document.getElementById('new-recipe-title').value,
          category: document.getElementById('new-recipe-category').value,
          prep_time_min: document.getElementById('new-recipe-prep-time').value || 15,
          kcal: document.getElementById('new-recipe-kcal').value,
          protein: document.getElementById('new-recipe-protein').value,
          carbs: document.getElementById('new-recipe-carbs').value,
          fat: document.getElementById('new-recipe-fat').value,
          ingredients: ingredientsList,
          instructions: instructionsList,
          image_url: document.getElementById('new-recipe-image-url').value
        };

        try {
          if (editId) {
            await window.apiFetch(`api/recipes/${editId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
          } else {
            await window.apiFetch('api/recipes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
          }
          if (modalCreateR) {
            modalCreateR.style.display = 'none';
            modalCreateR.classList.remove('active');
          }
          formCreateR.reset();
          await this.loadRecipeCatalog();
          await this.loadPlan();
        } catch (err) {
          alert('Error al guardar plato: ' + err.message);
        }
      });
    }

    // 2. Assign Meal Modal Form Handler
    const modalAssign = document.getElementById('modal-assign-meal-to-day');
    const btnCloseAssign = document.getElementById('btn-close-assign-meal');

    if (btnCloseAssign && modalAssign) {
      btnCloseAssign.addEventListener('click', () => {
        modalAssign.style.display = 'none';
        modalAssign.classList.remove('active');
      });
    }

    const formAssign = document.getElementById('form-assign-meal');
    if (formAssign) {
      formAssign.addEventListener('submit', async (e) => {
        e.preventDefault();
        const day_of_week = document.getElementById('assign-meal-day').value;
        const selectMealType = document.getElementById('diet-assign-meal-type');
        const meal_type = selectMealType ? selectMealType.value : 'almuerzo';
        const recipe_id = document.getElementById('assign-meal-recipe-id').value;

        try {
          await window.apiFetch('api/diet/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ day_of_week, meal_type, recipe_id })
          });
          if (modalAssign) {
            modalAssign.style.display = 'none';
            modalAssign.classList.remove('active');
          }
          await this.loadPlan();
        } catch (err) {
          alert('Error al asignar plato: ' + err.message);
        }
      });
    }

    // 3. Day Meal Details Modal Close
    const modalDayDetails = document.getElementById('modal-day-meal-details');
    const btnCloseDayDetails = document.getElementById('btn-close-day-meal-details');
    if (btnCloseDayDetails && modalDayDetails) {
      btnCloseDayDetails.addEventListener('click', () => {
        modalDayDetails.style.display = 'none';
        modalDayDetails.classList.remove('active');
      });
    }

    // 4. Shopping List Modal Close
    const modalShop = document.getElementById('modal-shopping-list');
    const btnCloseShop = document.getElementById('btn-close-shopping-list');
    if (btnCloseShop && modalShop) {
      btnCloseShop.addEventListener('click', () => {
        modalShop.style.display = 'none';
        modalShop.classList.remove('active');
      });
    }
  },

  openShoppingListModal: async function() {
    const modal = document.getElementById('modal-shopping-list');
    if (!modal) return;

    try {
      const items = await window.apiFetch('api/diet/shopping-list');
      const container = document.getElementById('shopping-list-content');
      if (container) {
        if (!items || items.length === 0) {
          container.innerHTML = '<p class="text-muted" style="padding: 16px;">No hay ingredientes asignados en el plan semanal.</p>';
        } else {
          container.innerHTML = `
            <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px;">
              ${items.map(item => `
                <li style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(15,23,42,0.8); border: 1px solid var(--border-color); border-radius: 8px;">
                  <span style="font-weight: 700; color: #fff; font-size: 0.9rem;">${item.name}</span>
                  <span class="badge" style="background: rgba(16,185,129,0.15); color: var(--primary); font-weight: 800; font-size: 0.82rem; padding: 4px 10px;">${item.displayAmount}</span>
                </li>
              `).join('')}
            </ul>
          `;
        }
      }
    } catch (err) {
      console.error('Error fetching shopping list:', err);
    }

    modal.style.display = 'flex';
    modal.style.zIndex = '99999';
    modal.classList.add('active');
    if (window.lucide) lucide.createIcons();
  },

  openCreateRecipeModal: function() {
    const modal = document.getElementById('modal-create-recipe');
    if (!modal) return;

    const elEditId = document.getElementById('edit-recipe-id');
    if (elEditId) elEditId.value = '';

    const form = document.getElementById('form-create-recipe');
    if (form) form.reset();

    const titleEl = document.getElementById('modal-create-recipe-title');
    if (titleEl) titleEl.innerHTML = `<i data-lucide="utensils"></i> Crear Nuevo Plato Personalizado`;

    modal.style.display = 'flex';
    modal.style.zIndex = '99999';
    modal.classList.add('active');
    if (window.lucide) lucide.createIcons();
  },

  populateAssignModalDropdown: function() {
    const select = document.getElementById('assign-meal-recipe-id');
    if (!select) return;

    select.innerHTML = this.recipeCatalog.map(r => `
      <option value="${r.id}">${r.title} (${r.kcal} kcal | ${r.protein}g P)</option>
    `).join('');
  },

  openAssignModal: function(day = 'lunes', mealType = 'almuerzo') {
    const modal = document.getElementById('modal-assign-meal-to-day');
    if (!modal) return;

    const elDay = document.getElementById('assign-meal-day');
    if (elDay) elDay.value = day || 'lunes';

    const selectMealType = document.getElementById('diet-assign-meal-type');
    if (selectMealType) selectMealType.value = mealType || 'almuerzo';

    this.populateAssignModalDropdown();

    modal.style.display = 'flex';
    modal.style.zIndex = '99999';
    modal.classList.add('active');
    if (window.lucide) lucide.createIcons();
  },

  openEditRecipeModal: function(recipeId) {
    const modal = document.getElementById('modal-create-recipe');
    if (!modal) return;

    const r = this.recipeCatalog.find(item => Number(item.id) === Number(recipeId));
    if (!r) return;

    document.getElementById('edit-recipe-id').value = r.id;
    document.getElementById('new-recipe-title').value = r.title;
    document.getElementById('new-recipe-category').value = r.category || 'almuerzo';
    document.getElementById('new-recipe-prep-time').value = r.prep_time_min || 15;
    document.getElementById('new-recipe-kcal').value = r.kcal;
    document.getElementById('new-recipe-protein').value = r.protein;
    document.getElementById('new-recipe-carbs').value = r.carbs;
    document.getElementById('new-recipe-fat').value = r.fat;
    document.getElementById('new-recipe-image-url').value = r.image_url || '';

    // Parse ingredients
    let ingredientsArr = [];
    try {
      ingredientsArr = JSON.parse(r.ingredients_json || '[]');
    } catch (e) {}
    document.getElementById('new-recipe-ingredients').value = ingredientsArr.map(ing => `${ing.name}: ${ing.amount} ${ing.unit || ''}`.trim()).join('\n');

    // Parse instructions
    let instructionsArr = [];
    try {
      instructionsArr = JSON.parse(r.instructions_json || '[]');
    } catch (e) {}
    document.getElementById('new-recipe-instructions').value = instructionsArr.join('\n');

    document.getElementById('modal-create-recipe-title').innerHTML = `<i data-lucide="edit-3"></i> Editar Plato: ${r.title}`;
    modal.style.display = 'flex';
    modal.classList.add('active');
    if (window.lucide) lucide.createIcons();
  },

  deleteRecipe: async function(recipeId) {
    try {
      await window.apiFetch(`api/recipes/${recipeId}`, { method: 'DELETE' });
      await this.loadRecipeCatalog();
      await this.loadPlan();
    } catch (err) {
      alert('Error al eliminar plato: ' + err.message);
    }
  },

  removeMeal: async function(mealId) {
    try {
      await window.apiFetch(`api/diet/plan/${mealId}`, { method: 'DELETE' });
      await this.loadPlan();
    } catch (err) {
      alert('Error al quitar plato: ' + err.message);
    }
  },

  openDayMealDetailsModal: function(dayKey) {
    const modal = document.getElementById('modal-day-meal-details');
    if (!modal) return;

    const dayData = (this.currentPlanData && this.currentPlanData[dayKey]) ? this.currentPlanData[dayKey] : null;

    const peopleCount = (window.FitApp && window.FitApp.peopleCount) || 1;
    document.getElementById('day-details-title').innerHTML = `<i data-lucide="utensils"></i> Menú Completo del ${dayKey.toUpperCase()}`;
    document.getElementById('day-details-subtitle').textContent = dayData ? `Total del Día: ${dayData.totalsPerPerson.kcal} kcal/persona | Ingredientes multiplicados para ${peopleCount} ${peopleCount === 1 ? 'persona' : 'personas'}` : 'Sin datos';

    const grid = document.getElementById('day-meal-details-grid');
    if (!dayData || !dayData.meals || dayData.meals.length === 0) {
      grid.innerHTML = `<p class="text-muted" style="padding: 16px;">No hay platos asignados a este día aún.</p>`;
    } else {
      grid.innerHTML = dayData.meals.map(m => `
        <div style="background: rgba(15,23,42,0.8); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span class="badge" style="background: rgba(16,185,129,0.15); color: var(--primary); text-transform: uppercase; font-size: 0.75rem; font-weight: 800;">
              ${m.meal_type}
            </span>
            <span style="font-size: 0.82rem; font-weight: 800; color: var(--accent-orange);">
              ${m.perPerson.kcal} kcal / persona
            </span>
          </div>

          <h4 style="font-size: 1.1rem; font-weight: 800; color: #fff; margin-bottom: 8px;">${m.recipe_title}</h4>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 12px;">
            <div>
              <span style="font-size: 0.8rem; font-weight: 700; color: var(--primary);">Ingredientes (${peopleCount} pers.):</span>
              <ul style="font-size: 0.82rem; color: #e2e8f0; padding-left: 16px; margin-top: 4px;">
                ${(m.ingredients || []).map(ing => `<li><strong>${ing.scaledAmount} ${ing.unit}</strong> ${ing.name}</li>`).join('')}
              </ul>
            </div>
            <div>
              <span style="font-size: 0.8rem; font-weight: 700; color: var(--accent-cyan);">Instrucciones de Prep.:</span>
              <ol style="font-size: 0.8rem; color: var(--text-muted); padding-left: 16px; margin-top: 4px;">
                ${(m.instructions || []).map(ins => `<li>${ins}</li>`).join('')}
              </ol>
            </div>
          </div>
        </div>
      `).join('');
    }

    modal.style.display = 'flex';
    modal.classList.add('active');
    if (window.lucide) lucide.createIcons();
  },

  updateDashboardMacros: function() {
    if (!this.currentPlanData) return;

    const todayKey = this.getCurrentDayOfWeekSpanish();
    const dayData = this.currentPlanData[todayKey] || { totalsPerPerson: { kcal: 0, protein: 0, carbs: 0, fat: 0 } };

    const targetKcal = (window.FitApp && window.FitApp.currentProfile) ? window.FitApp.currentProfile.daily_kcal_target : 1850;
    const targetProtein = (window.FitApp && window.FitApp.currentProfile) ? window.FitApp.currentProfile.daily_protein_target : 140;
    const targetCarbs = (window.FitApp && window.FitApp.currentProfile) ? window.FitApp.currentProfile.daily_carbs_target : 160;
    const targetFat = (window.FitApp && window.FitApp.currentProfile) ? window.FitApp.currentProfile.daily_fat_target : 55;

    const txtKcal = document.getElementById('macro-txt-kcal');
    const txtProtein = document.getElementById('macro-txt-protein');
    const txtCarbs = document.getElementById('macro-txt-carbs');
    const txtFat = document.getElementById('macro-txt-fat');

    if (txtKcal) txtKcal.textContent = `${dayData.totalsPerPerson.kcal} / ${targetKcal} kcal`;
    if (txtProtein) txtProtein.textContent = `${dayData.totalsPerPerson.protein} / ${targetProtein} g`;
    if (txtCarbs) txtCarbs.textContent = `${dayData.totalsPerPerson.carbs} / ${targetCarbs} g`;
    if (txtFat) txtFat.textContent = `${dayData.totalsPerPerson.fat} / ${targetFat} g`;

    const fillKcal = document.getElementById('bar-fill-kcal');
    const fillProtein = document.getElementById('bar-fill-protein');
    const fillCarbs = document.getElementById('bar-fill-carbs');
    const fillFat = document.getElementById('bar-fill-fat');

    if (fillKcal) fillKcal.style.width = `${Math.min(100, Math.round((dayData.totalsPerPerson.kcal / targetKcal) * 100))}%`;
    if (fillProtein) fillProtein.style.width = `${Math.min(100, Math.round((dayData.totalsPerPerson.protein / targetProtein) * 100))}%`;
    if (fillCarbs) fillCarbs.style.width = `${Math.min(100, Math.round((dayData.totalsPerPerson.carbs / targetCarbs) * 100))}%`;
    if (fillFat) fillFat.style.width = `${Math.min(100, Math.round((dayData.totalsPerPerson.fat / targetFat) * 100))}%`;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.DietModule.init();
});
