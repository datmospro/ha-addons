// Recipe Finder & Macro Filtering Module
window.RecipeModule = {
  targetDay: 'lunes',
  targetMealType: 'almuerzo',
  selectedRecipe: null,

  init: function() {
    this.bindSearchEvents();
    this.bindAssignModal();
  },

  bindSearchEvents: function() {
    const btnSearch = document.getElementById('btn-execute-recipe-search');
    if (btnSearch) {
      btnSearch.addEventListener('click', () => this.search());
    }

    const inputQuery = document.getElementById('search-recipe-query');
    if (inputQuery) {
      inputQuery.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.search();
      });
    }
  },

  bindAssignModal: function() {
    const modal = document.getElementById('modal-assign-recipe');
    const btnClose = document.getElementById('btn-close-assign-recipe');
    if (btnClose) {
      btnClose.addEventListener('click', () => modal.classList.remove('active'));
    }

    const form = document.getElementById('form-assign-recipe');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const recipe_id = document.getElementById('assign-recipe-id').value;
        const day_of_week = document.getElementById('assign-day-of-week').value;
        const meal_type = document.getElementById('assign-meal-type').value;

        try {
          await window.apiFetch('api/diet/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              day_of_week: day_of_week.toLowerCase(),
              meal_type: meal_type.toLowerCase(),
              recipe_id: recipe_id,
              people_count: window.FitApp.peopleCount || 1
            })
          });

          modal.classList.remove('active');
          if (window.DietModule) window.DietModule.loadPlan();
          document.getElementById('btn-tab-diet').click();
        } catch (err) {
          alert('Error al asignar receta: ' + err.message);
        }
      });
    }
  },

  search: async function() {
    const query = document.getElementById('search-recipe-query').value;
    const category = document.getElementById('search-recipe-category').value;
    const maxKcal = document.getElementById('search-max-kcal').value;
    const minProtein = document.getElementById('search-min-protein').value;
    const maxCarbs = document.getElementById('search-max-carbs').value;

    const params = new URLSearchParams();
    if (query) params.append('query', query);
    if (category) params.append('category', category);
    if (maxKcal) params.append('maxKcal', maxKcal);
    if (minProtein) params.append('minProtein', minProtein);
    if (maxCarbs) params.append('maxCarbs', maxCarbs);
    params.append('source', 'all');

    try {
      const data = await window.apiFetch(`api/recipes?${params.toString()}`);
      this.renderResults(data.local, data.external);
    } catch (err) {
      console.error('Error searching recipes:', err);
    }
  },

  renderResults: function(localList = [], externalList = []) {
    const grid = document.getElementById('recipe-results-grid');
    if (!grid) return;

    const allRecipes = [...localList, ...externalList];

    if (allRecipes.length === 0) {
      grid.innerHTML = '<p class="text-muted" style="grid-column: 1/-1;">No se encontraron recetas con los filtros seleccionados.</p>';
      return;
    }

    grid.innerHTML = allRecipes.map(r => `
      <div class="recipe-card">
        <img src="${r.image_url || 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=500'}" class="recipe-img" alt="${r.title}" onerror="this.src='https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=500'">
        <div class="recipe-body">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <h4>${r.title}</h4>
            ${r.is_external ? '<span class="badge" style="background: rgba(6,182,212,0.15); color: var(--accent-cyan); font-size: 0.7rem; padding: 2px 6px; border-radius: 4px;">OpenDB</span>' : ''}
          </div>
          <p>${r.description || 'Sin descripción'}</p>
          
          <div class="recipe-stats">
            <span><strong>${r.kcal}</strong> kcal</span>
            <span><strong>${r.protein}g</strong> Prot</span>
            <span><strong>${r.carbs}g</strong> Carb</span>
            <span><strong>${r.fat}g</strong> Grasas</span>
          </div>

          <div style="display: flex; gap: 8px; margin-top: auto;">
            ${r.is_external ? `
              <button class="btn btn-secondary" onclick="window.RecipeModule.importAndAssign(${JSON.stringify(r).replace(/"/g, '&quot;')})" style="flex: 1; font-size: 0.8rem;">
                <i data-lucide="plus"></i> Importar & Asignar
              </button>
            ` : `
              <button class="btn btn-primary" onclick="window.RecipeModule.openAssignModal(${r.id}, '${r.title.replace(/'/g, "\\'")}')" style="flex: 1; font-size: 0.8rem;">
                <i data-lucide="calendar-plus"></i> Añadir a Plan Semanal
              </button>
            `}
          </div>
        </div>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
  },

  openAssignModal: function(recipeId, recipeTitle) {
    document.getElementById('assign-recipe-id').value = recipeId;
    document.getElementById('assign-recipe-title').value = recipeTitle;
    document.getElementById('assign-day-of-week').value = this.targetDay || 'lunes';
    document.getElementById('assign-meal-type').value = this.targetMealType || 'almuerzo';

    document.getElementById('modal-assign-recipe').classList.add('active');
  },

  importAndAssign: async function(recipeObj) {
    try {
      const data = await window.apiFetch('api/recipes/import-external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recipeObj)
      });
      if (data.id) {
        this.openAssignModal(data.id, recipeObj.title);
      }
    } catch (err) {
      alert('Error al importar receta: ' + err.message);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.RecipeModule.init();
});
