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

    // 5. Import Diet JSON Modal Close
    const modalImport = document.getElementById('modal-import-diet');
    const btnCloseImport = document.getElementById('btn-close-import-diet');
    if (btnCloseImport && modalImport) {
      btnCloseImport.addEventListener('click', () => {
        modalImport.style.display = 'none';
        modalImport.classList.remove('active');
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

  openDayMealDetailsModal: function(dayKey, defaultActiveMealType = null) {
    const modal = document.getElementById('modal-day-meal-details');
    if (!modal) return;

    this.currentDayKey = dayKey;

    // Sync people count selector inside modal
    const peopleCount = (window.FitApp && window.FitApp.peopleCount) || 1;
    const modalSelect = document.getElementById('modal-people-count-select');
    if (modalSelect) modalSelect.value = String(peopleCount);

    const dayData = (this.currentPlanData && this.currentPlanData[dayKey]) ? this.currentPlanData[dayKey] : null;

    const dayTitleEl = document.getElementById('day-details-title');
    const daySubtitleEl = document.getElementById('day-details-subtitle');

    if (dayTitleEl) dayTitleEl.innerHTML = `<i data-lucide="utensils" style="color: var(--primary);"></i> Menú Completo del ${dayKey.toUpperCase()}`;
    if (daySubtitleEl) {
      daySubtitleEl.textContent = dayData 
        ? `Total del Día: ${dayData.totalsPerPerson.kcal} kcal/persona (${dayData.totalsPerPerson.protein}g P | ${dayData.totalsPerPerson.carbs}g C | ${dayData.totalsPerPerson.fat}g G)`
        : 'Sin platos asignados a este día';
    }

    const tabsBar = document.getElementById('day-meal-tabs-bar');
    const contentArea = document.getElementById('day-meal-tab-content');

    if (!dayData || !dayData.meals || dayData.meals.length === 0) {
      if (tabsBar) tabsBar.innerHTML = '';
      if (contentArea) {
        contentArea.innerHTML = `
          <div style="text-align: center; padding: 40px 16px;">
            <i data-lucide="utensils-crossed" style="width: 48px; height: 48px; color: var(--text-muted); opacity: 0.5; margin-bottom: 12px;"></i>
            <h4 style="font-size: 1.1rem; color: #fff;">No hay comidas asignadas al ${dayKey.toUpperCase()}</h4>
            <p class="text-muted" style="font-size: 0.85rem; margin-top: 6px;">Asigna platos al menú semanal usando el botón "Asignar Plato a Plan".</p>
            <button class="btn btn-primary" onclick="window.DietModule.closeDayMealDetailsModal(); window.DietModule.openAssignModal('${dayKey}', 'almuerzo');" style="margin-top: 16px;">
              <i data-lucide="plus-circle"></i> Asignar Plato Ahora
            </button>
          </div>
        `;
      }
    } else {
      // Order meals chronologically: Desayuno, Almuerzo, Merienda, Cena, Snack
      const mealOrder = ['desayuno', 'almuerzo', 'merienda', 'cena', 'snack'];
      const sortedMeals = [...dayData.meals].sort((a, b) => {
        const indexA = mealOrder.indexOf((a.meal_type || '').toLowerCase());
        const indexB = mealOrder.indexOf((b.meal_type || '').toLowerCase());
        return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
      });

      // Determine active meal
      let activeMeal = null;
      if (defaultActiveMealType) {
        activeMeal = sortedMeals.find(m => (m.meal_type || '').toLowerCase() === defaultActiveMealType.toLowerCase());
      }
      if (!activeMeal) {
        activeMeal = sortedMeals[0];
      }

      // Render Tabs Bar
      if (tabsBar) {
        tabsBar.innerHTML = sortedMeals.map(m => {
          const isActive = activeMeal && m.id === activeMeal.id;
          const typeUpper = (m.meal_type || 'COMIDA').toUpperCase();
          const kcal = m.perPerson ? m.perPerson.kcal : 0;

          return `
            <button type="button" 
                    onclick="window.DietModule.selectMealTab('${m.meal_type}')"
                    class="btn ${isActive ? 'btn-primary' : 'btn-secondary'}"
                    style="font-size: 0.82rem; padding: 8px 14px; font-weight: 700; white-space: nowrap; ${isActive ? 'box-shadow: 0 0 14px var(--primary-glow);' : 'opacity: 0.85;'}">
              <span>${typeUpper}</span>
              <span class="badge" style="background: ${isActive ? 'rgba(0,0,0,0.2)' : 'rgba(16,185,129,0.15)'}; color: ${isActive ? '#000' : 'var(--primary)'}; font-size: 0.72rem; font-weight: 800; padding: 2px 6px;">
                ${kcal} kcal
              </span>
            </button>
          `;
        }).join('');
      }

      // Render Active Meal Content
      this.renderDayMealTabContent(activeMeal, dayKey, peopleCount);
    }

    modal.style.display = 'flex';
    modal.style.zIndex = '99999';
    modal.classList.add('active');
    if (window.lucide) lucide.createIcons();
  },

  selectMealTab: function(mealType) {
    if (this.currentDayKey) {
      this.openDayMealDetailsModal(this.currentDayKey, mealType);
    }
  },

  changeModalPeopleCount: async function(newCount) {
    const count = parseInt(newCount, 10) || 1;
    this.peopleCount = count;
    if (window.FitApp) window.FitApp.peopleCount = count;

    try {
      await window.apiFetch('api/diet/people-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ people_count: count })
      });
      await this.loadPlan();
      if (this.currentDayKey) {
        this.openDayMealDetailsModal(this.currentDayKey);
      }
    } catch (err) {
      console.error('Error changing people count:', err);
    }
  },

  closeDayMealDetailsModal: function() {
    const modal = document.getElementById('modal-day-meal-details');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
  },

  renderDayMealTabContent: function(meal, dayKey, peopleCount) {
    const contentArea = document.getElementById('day-meal-tab-content');
    if (!contentArea || !meal) return;

    const perPerson = meal.perPerson || { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    const scaledTotal = meal.scaledTotal || { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    const ingredients = meal.ingredients || [];
    const instructions = meal.instructions || [];

    contentArea.innerHTML = `
      <div style="background: rgba(15,23,42,0.85); border: 1px solid var(--border-color); border-radius: 14px; padding: 20px; display: flex; flex-direction: column; gap: 16px;">
        
        <!-- Header Info -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 14px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span class="badge" style="background: rgba(16,185,129,0.15); color: var(--primary); text-transform: uppercase; font-size: 0.78rem; font-weight: 900; padding: 4px 10px;">
                ${(meal.meal_type || 'COMIDA').toUpperCase()}
              </span>
              <span class="text-muted" style="font-size: 0.8rem;">
                <i data-lucide="clock" style="width: 13px; height: 13px;"></i> Prep: ${meal.prep_time_min || 15} min
              </span>
            </div>
            <h3 style="font-size: 1.35rem; font-weight: 800; color: #fff; line-height: 1.2;">${meal.recipe_title}</h3>
          </div>

          <!-- Actions -->
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" onclick="window.DietModule.openAssignModal('${dayKey}', '${meal.meal_type}')" style="font-size: 0.8rem; padding: 8px 12px;">
              <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> Cambiar Plato
            </button>
            <button class="btn btn-secondary" onclick="window.DietModule.removeMealAndRefresh(${meal.id})" style="font-size: 0.8rem; padding: 8px 12px; color: var(--accent-red); border-color: rgba(239,68,68,0.3);" title="Quitar de este día">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Quitar
            </button>
          </div>
        </div>

        <!-- Macro Summary Pills -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; background: rgba(0,0,0,0.25); padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05);">
          <div style="text-align: center;">
            <span style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Calorías (1 pers.)</span>
            <div style="font-size: 1.15rem; font-weight: 900; color: var(--accent-orange);">${perPerson.kcal} <span style="font-size: 0.75rem;">kcal</span></div>
            ${peopleCount > 1 ? `<span style="font-size: 0.68rem; color: var(--text-muted);">Total (${peopleCount}p): ${scaledTotal.kcal} kcal</span>` : ''}
          </div>

          <div style="text-align: center;">
            <span style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Proteínas</span>
            <div style="font-size: 1.15rem; font-weight: 900; color: var(--primary);">${perPerson.protein} <span style="font-size: 0.75rem;">g</span></div>
            ${peopleCount > 1 ? `<span style="font-size: 0.68rem; color: var(--text-muted);">Total (${peopleCount}p): ${scaledTotal.protein}g</span>` : ''}
          </div>

          <div style="text-align: center;">
            <span style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Carbohidratos</span>
            <div style="font-size: 1.15rem; font-weight: 900; color: var(--accent-cyan);">${perPerson.carbs} <span style="font-size: 0.75rem;">g</span></div>
            ${peopleCount > 1 ? `<span style="font-size: 0.68rem; color: var(--text-muted);">Total (${peopleCount}p): ${scaledTotal.carbs}g</span>` : ''}
          </div>

          <div style="text-align: center;">
            <span style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Grasas</span>
            <div style="font-size: 1.15rem; font-weight: 900; color: var(--accent-yellow);">${perPerson.fat} <span style="font-size: 0.75rem;">g</span></div>
            ${peopleCount > 1 ? `<span style="font-size: 0.68rem; color: var(--text-muted);">Total (${peopleCount}p): ${scaledTotal.fat}g</span>` : ''}
          </div>
        </div>

        <!-- Ingredients & Instructions Split View -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; margin-top: 6px;">
          
          <!-- Ingredients Box -->
          <div style="background: rgba(16,185,129,0.05); border: 1px solid rgba(16,185,129,0.2); border-radius: 12px; padding: 14px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
              <i data-lucide="shopping-basket" style="color: var(--primary); width: 18px; height: 18px;"></i>
              <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--primary);">
                Ingredientes (${peopleCount} ${peopleCount === 1 ? 'persona' : 'personas'})
              </h4>
            </div>
            ${ingredients.length === 0 ? '<p class="text-muted" style="font-size: 0.8rem;">Sin ingredientes detallados.</p>' : `
              <ul style="font-size: 0.85rem; color: #e2e8f0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 6px;">
                ${ingredients.map(ing => `
                  <li style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(15,23,42,0.6); border-radius: 6px; border: 1px solid rgba(255,255,255,0.03);">
                    <span>${ing.name}</span>
                    <strong style="color: var(--primary); font-size: 0.88rem;">${ing.scaledAmount} ${ing.unit || ''}</strong>
                  </li>
                `).join('')}
              </ul>
            `}
          </div>

          <!-- Instructions Box -->
          <div style="background: rgba(6,182,212,0.05); border: 1px solid rgba(6,182,212,0.2); border-radius: 12px; padding: 14px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
              <i data-lucide="chef-hat" style="color: var(--accent-cyan); width: 18px; height: 18px;"></i>
              <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--accent-cyan);">Instrucciones de Preparación</h4>
            </div>
            ${instructions.length === 0 ? '<p class="text-muted" style="font-size: 0.8rem;">Sin instrucciones registradas.</p>' : `
              <ol style="font-size: 0.83rem; color: #cbd5e1; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; line-height: 1.4;">
                ${instructions.map(ins => `<li>${ins}</li>`).join('')}
              </ol>
            `}
          </div>

        </div>

      </div>
    `;

    if (window.lucide) lucide.createIcons();
  },

  removeMealAndRefresh: async function(mealId) {
    try {
      await this.removeMeal(mealId);
      if (this.currentDayKey) {
        this.openDayMealDetailsModal(this.currentDayKey);
      }
    } catch (e) {}
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
  },

  openImportModal: function() {
    const modal = document.getElementById('modal-import-diet');
    if (!modal) return;

    const statusEl = document.getElementById('import-diet-status');
    if (statusEl) statusEl.style.display = 'none';

    modal.style.display = 'flex';
    modal.style.zIndex = '99999';
    modal.classList.add('active');
    if (window.lucide) lucide.createIcons();
  },

  closeImportModal: function() {
    const modal = document.getElementById('modal-import-diet');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
  },

  fillSampleImportJson: function() {
    const sample = {
      "recipes": [
        {
          "title": "Avena Energética con Plátano y Crema de Cacahuete",
          "category": "desayuno",
          "prep_time_min": 10,
          "kcal": 380,
          "protein": 14,
          "carbs": 56,
          "fat": 10,
          "ingredients": [
            { "name": "Copos de avena", "amount": "60", "unit": "g" },
            { "name": "Plátano", "amount": "1", "unit": "unidad" },
            { "name": "Crema de cacahuete", "amount": "15", "unit": "g" },
            { "name": "Leche desnatada o bebida vegetal", "amount": "200", "unit": "ml" }
          ],
          "instructions": [
            "Mezclar los copos de avena con la leche y calentar 2 min en microondas.",
            "Cortar el plátano en rodajas y añadir encima.",
            "Añadir la cucharada de crema de cacahuete y servir caliente."
          ]
        },
        {
          "title": "Pechuga de Pollo a la Plancha con Arroz Integral",
          "category": "almuerzo",
          "prep_time_min": 20,
          "kcal": 520,
          "protein": 45,
          "carbs": 50,
          "fat": 12,
          "ingredients": [
            { "name": "Pechuga de pollo", "amount": "200", "unit": "g" },
            { "name": "Arroz integral cocido", "amount": "180", "unit": "g" },
            { "name": "Aceite de oliva virgen extra", "amount": "10", "unit": "ml" },
            { "name": "Brócoli al vapor", "amount": "100", "unit": "g" }
          ],
          "instructions": [
            "Sazonar la pechuga de pollo con sal, pimienta y orégano.",
            "Cocinar a la plancha con unas gotas de aceite de oliva hasta dorar por ambos lados.",
            "Servir acompañado del arroz integral cocido y el brócoli al vapor."
          ]
        }
      ],
      "plan": [
        { "day_of_week": "lunes", "meal_type": "desayuno", "recipe_title": "Avena Energética con Plátano y Crema de Cacahuete" },
        { "day_of_week": "lunes", "meal_type": "almuerzo", "recipe_title": "Pechuga de Pollo a la Plancha con Arroz Integral" },
        { "day_of_week": "martes", "meal_type": "desayuno", "recipe_title": "Avena Energética con Plátano y Crema de Cacahuete" }
      ]
    };

    const textarea = document.getElementById('import-diet-json-input');
    if (textarea) {
      textarea.value = JSON.stringify(sample, null, 2);
    }
  },

  copyAiPromptTemplate: function() {
    const promptText = `Por favor, actúa como un nutricionista experto y genera una respuesta ÚNICAMENTE en formato JSON válido (sin texto extra fuera del bloque JSON) para importar en mi aplicación de dietas con la siguiente estructura:

{
  "recipes": [
    {
      "title": "Nombre exacto del plato",
      "category": "desayuno|almuerzo|merienda|cena|snack",
      "prep_time_min": 15,
      "kcal": 450,
      "protein": 35,
      "carbs": 40,
      "fat": 12,
      "ingredients": [
        { "name": "Ingrediente 1", "amount": "100", "unit": "g" },
        { "name": "Ingrediente 2", "amount": "1", "unit": "unidad" }
      ],
      "instructions": [
        "Paso 1 de preparación...",
        "Paso 2 de preparación..."
      ]
    }
  ],
  "plan": [
    { "day_of_week": "lunes", "meal_type": "desayuno", "recipe_title": "Nombre exacto del plato" },
    { "day_of_week": "lunes", "meal_type": "almuerzo", "recipe_title": "Nombre exacto del plato" }
  ]
}

Por favor, crea un menú saludable para toda la semana acorde a mi objetivo de déficit calórico.`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(promptText).then(() => {
        alert('📋 Prompt copiado al portapapeles. Pégalo en ChatGPT, Gemini o Claude para pedir tu dieta en JSON.');
      }).catch(() => {
        prompt("Copia este prompt para la IA:", promptText);
      });
    } else {
      prompt("Copia este prompt para la IA:", promptText);
    }
  },

  submitImportJson: async function() {
    const textarea = document.getElementById('import-diet-json-input');
    const statusEl = document.getElementById('import-diet-status');

    if (!textarea || !textarea.value.trim()) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(239,68,68,0.15)';
        statusEl.style.color = 'var(--accent-red)';
        statusEl.textContent = '❌ Por favor, pega un JSON antes de importar.';
      }
      return;
    }

    try {
      const jsonText = textarea.value.trim();
      const res = await window.apiFetch('api/diet/import-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: jsonText })
      });

      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(16,185,129,0.15)';
        statusEl.style.color = 'var(--primary)';
        statusEl.textContent = `✅ ${res.message || 'Importación completada con éxito.'}`;
      }

      await this.loadPlanAndRecipes();

      setTimeout(() => {
        this.closeImportModal();
        textarea.value = '';
      }, 1500);

    } catch (err) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(239,68,68,0.15)';
        statusEl.style.color = 'var(--accent-red)';
        statusEl.textContent = `❌ Error al importar: ${err.message}`;
      }
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.DietModule.init();
});
