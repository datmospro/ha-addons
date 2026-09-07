// Recipe Search Module - Spoonacular & Edamam Integration with Strict Veto & Macro Filtering
window.RecipeSearchModule = {
  activeVetoes: new Set(),
  currentResults: [],
  selectedRecipeForAssign: null,
  currentPage: 1,
  currentLimit: 24,
  hasMore: false,

  init: function() {
    this.bindSearchEvents();
    this.bindVetoChips();
    this.bindModalEvents();
    this.loadApiSettings();
  },

  bindVetoChips: function() {
    const chips = document.querySelectorAll('.veto-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const vetoVal = chip.getAttribute('data-veto');
        if (this.activeVetoes.has(vetoVal)) {
          this.activeVetoes.delete(vetoVal);
          chip.classList.remove('active');
        } else {
          this.activeVetoes.add(vetoVal);
          chip.classList.add('active');
        }
        this.updateVetoInputFromChips();
      });
    });

    const customVetoInput = document.getElementById('search-recipe-veto-custom');
    if (customVetoInput) {
      customVetoInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = customVetoInput.value.trim().toLowerCase();
          if (val && !this.activeVetoes.has(val)) {
            this.activeVetoes.add(val);
            this.renderCustomVetoBadge(val);
            customVetoInput.value = '';
            this.updateVetoInputFromChips();
          }
        }
      });
    }
  },

  renderCustomVetoBadge: function(text) {
    const container = document.getElementById('custom-veto-tags');
    if (!container) return;

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.style.cssText = 'background: rgba(239,68,68,0.2); color: var(--accent-red); border: 1px solid rgba(239,68,68,0.4); padding: 4px 10px; border-radius: 16px; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 6px; margin: 2px; cursor: pointer;';
    badge.innerHTML = `🚫 ${text} <i data-lucide="x" style="width: 12px; height: 12px;"></i>`;
    badge.addEventListener('click', () => {
      this.activeVetoes.delete(text);
      badge.remove();
      this.updateVetoInputFromChips();
    });

    container.appendChild(badge);
    if (window.lucide) lucide.createIcons();
  },

  updateVetoInputFromChips: function() {
    // Keep activeVetoes synchronized
  },

  bindSearchEvents: function() {
    const form = document.getElementById('form-search-recipes');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.currentPage = 1;
        this.performSearch();
      });
    }

    const limitSelect = document.getElementById('search-recipe-limit');
    if (limitSelect) {
      limitSelect.addEventListener('change', () => {
        this.currentLimit = parseInt(limitSelect.value, 10) || 24;
        this.currentPage = 1;
        this.performSearch();
      });
    }

    const btnReset = document.getElementById('btn-reset-search-filters');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (form) form.reset();
        this.activeVetoes.clear();
        this.currentPage = 1;
        document.querySelectorAll('.veto-chip').forEach(c => c.classList.remove('active'));
        const container = document.getElementById('custom-veto-tags');
        if (container) container.innerHTML = '';
        const resultsContainer = document.getElementById('recipes-search-results-grid');
        if (resultsContainer) {
          resultsContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">Usa los filtros superiores para buscar recetas en Spoonacular o Edamam.</div>';
        }
        const paginationBar = document.getElementById('recipes-search-pagination');
        if (paginationBar) paginationBar.style.display = 'none';
      });
    }
  },

  changePage: function(delta) {
    const targetPage = this.currentPage + delta;
    if (targetPage < 1) return;
    this.currentPage = targetPage;
    this.performSearch();

    // Scroll smoothly to top of results
    const resultsContainer = document.getElementById('recipes-search-results-grid');
    if (resultsContainer) {
      resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  performSearch: async function() {
    const query = (document.getElementById('search-recipe-query')?.value || '').trim();
    const provider = document.getElementById('search-recipe-provider')?.value || 'all';
    const limitSelect = document.getElementById('search-recipe-limit');
    if (limitSelect) this.currentLimit = parseInt(limitSelect.value, 10) || 24;

    const minKcal = document.getElementById('search-recipe-min-kcal')?.value || '';
    const maxKcal = document.getElementById('search-recipe-max-kcal')?.value || '';
    const minProtein = document.getElementById('search-recipe-min-protein')?.value || '';
    const maxProtein = document.getElementById('search-recipe-max-protein')?.value || '';
    const minCarbs = document.getElementById('search-recipe-min-carbs')?.value || '';
    const maxCarbs = document.getElementById('search-recipe-max-carbs')?.value || '';
    const minFat = document.getElementById('search-recipe-min-fat')?.value || '';
    const maxFat = document.getElementById('search-recipe-max-fat')?.value || '';

    const vetoList = Array.from(this.activeVetoes).join(',');

    const resultsContainer = document.getElementById('recipes-search-results-grid');
    const loadingEl = document.getElementById('recipes-search-loading');
    const countEl = document.getElementById('recipes-search-count');
    const paginationBar = document.getElementById('recipes-search-pagination');
    const pageNumEl = document.getElementById('search-current-page-num');
    const prevBtn = document.getElementById('btn-search-prev-page');
    const nextBtn = document.getElementById('btn-search-next-page');

    if (loadingEl) loadingEl.style.display = 'flex';
    if (resultsContainer) resultsContainer.innerHTML = '';
    if (countEl) countEl.textContent = `Buscando recetas (Página ${this.currentPage})...`;

    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (provider) params.set('provider', provider);
    params.set('page', String(this.currentPage));
    params.set('limit', String(this.currentLimit));
    if (minKcal) params.set('minKcal', minKcal);
    if (maxKcal) params.set('maxKcal', maxKcal);
    if (minProtein) params.set('minProtein', minProtein);
    if (maxProtein) params.set('maxProtein', maxProtein);
    if (minCarbs) params.set('minCarbs', minCarbs);
    if (maxCarbs) params.set('maxCarbs', maxCarbs);
    if (minFat) params.set('minFat', minFat);
    if (maxFat) params.set('maxFat', maxFat);
    if (vetoList) params.set('excluded', vetoList);

    try {
      const data = await window.apiFetch(`api/recipes/search-online?${params.toString()}`);
      if (loadingEl) loadingEl.style.display = 'none';

      this.currentResults = data.recipes || [];
      this.hasMore = data.hasMore !== undefined ? data.hasMore : (this.currentResults.length >= this.currentLimit);

      if (data.errors && data.errors.length > 0 && this.currentResults.length === 0) {
        if (resultsContainer) {
          resultsContainer.innerHTML = `
            <div style="grid-column: 1/-1; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 12px; padding: 24px; text-align: center;">
              <i data-lucide="alert-circle" style="width: 36px; height: 36px; color: var(--accent-red); margin-bottom: 8px;"></i>
              <h4 style="color: var(--accent-red); margin-bottom: 6px;">No se pudieron obtener resultados</h4>
              <p style="font-size: 0.88rem; color: var(--text-muted);">${data.errors.join(' | ')}</p>
              <p style="font-size: 0.8rem; margin-top: 10px; color: #fff;">Asegúrate de haber configurado tu API Key en la pestaña <strong>Configuración</strong>.</p>
            </div>
          `;
          if (window.lucide) lucide.createIcons();
        }
        if (countEl) countEl.textContent = '0 recetas encontradas';
        if (paginationBar) paginationBar.style.display = 'none';
        return;
      }

      if (countEl) countEl.textContent = `${this.currentResults.length} recetas en página ${this.currentPage}`;
      this.renderResults(this.currentResults);

      // Render Pagination Bar
      if (paginationBar) {
        if (this.currentResults.length > 0 || this.currentPage > 1) {
          paginationBar.style.display = 'flex';
          if (pageNumEl) pageNumEl.textContent = String(this.currentPage);
          if (prevBtn) {
            prevBtn.disabled = this.currentPage <= 1;
            prevBtn.style.opacity = this.currentPage <= 1 ? '0.4' : '1';
            prevBtn.style.cursor = this.currentPage <= 1 ? 'not-allowed' : 'pointer';
          }
          if (nextBtn) {
            nextBtn.disabled = !this.hasMore && this.currentResults.length === 0;
            nextBtn.style.opacity = (!this.hasMore && this.currentResults.length === 0) ? '0.4' : '1';
          }
        } else {
          paginationBar.style.display = 'none';
        }
      }
    } catch (err) {
      if (loadingEl) loadingEl.style.display = 'none';
      if (resultsContainer) {
        resultsContainer.innerHTML = `
          <div style="grid-column: 1/-1; background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); border-radius: 12px; padding: 24px; text-align: center;">
            <p style="color: var(--accent-red);">Error al buscar recetas: ${err.message}</p>
          </div>
        `;
      }
      if (countEl) countEl.textContent = 'Error en la búsqueda';
      if (paginationBar) paginationBar.style.display = 'none';
    }
  },

  renderResults: function(recipes) {
    const container = document.getElementById('recipes-search-results-grid');
    if (!container) return;

    if (recipes.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 50px; color: var(--text-muted);">
          <i data-lucide="search-x" style="width: 42px; height: 42px; margin-bottom: 12px; opacity: 0.5;"></i>
          <h4>No se encontraron recetas con estos filtros</h4>
          <p style="font-size: 0.85rem; margin-top: 4px;">Prueba a ampliar los rangos de calorías o quitar algún veto de alimentos.</p>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    container.innerHTML = recipes.map((r, idx) => {
      const providerBadge = r.provider === 'spoonacular'
        ? '<span class="badge" style="background: rgba(16,185,129,0.2); color: var(--primary); font-size: 0.72rem;">Spoonacular</span>'
        : '<span class="badge" style="background: rgba(6,182,212,0.2); color: var(--accent-cyan); font-size: 0.72rem;">Edamam</span>';

      const imgHtml = r.image_url
        ? `<img src="${r.image_url}" alt="${r.title}" style="width: 100%; height: 160px; object-fit: cover; border-radius: 10px 10px 0 0;" loading="lazy">`
        : `<div style="width: 100%; height: 160px; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; border-radius: 10px 10px 0 0;"><i data-lucide="utensils" style="width: 36px; height: 36px; color: var(--text-muted);"></i></div>`;

      return `
        <div class="card" style="padding: 0; overflow: hidden; display: flex; flex-direction: column; border: 1px solid var(--border-color); transition: transform 0.2s ease, border-color 0.2s ease;">
          ${imgHtml}
          <div style="padding: 14px; flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                ${providerBadge}
                <span class="text-muted" style="font-size: 0.75rem;"><i data-lucide="clock" style="width: 12px; height: 12px;"></i> ${r.prep_time_min}m</span>
              </div>
              <h4 style="font-size: 1.05rem; font-weight: 700; line-height: 1.3; margin-bottom: 8px;" title="${r.title}">
                ${r.title}
              </h4>
              <p class="text-muted" style="font-size: 0.8rem; margin-bottom: 12px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                ${r.description || ''}
              </p>
            </div>

            <div>
              <!-- Macro Pill Highlights -->
              <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; background: rgba(0,0,0,0.3); padding: 8px 6px; border-radius: 8px; text-align: center; margin-bottom: 12px;">
                <div>
                  <span style="font-size: 0.65rem; color: var(--text-muted); display: block;">KCAL</span>
                  <strong style="font-size: 0.88rem; color: var(--accent-orange);">${r.kcal}</strong>
                </div>
                <div>
                  <span style="font-size: 0.65rem; color: var(--text-muted); display: block;">PROT</span>
                  <strong style="font-size: 0.88rem; color: var(--primary);">${r.protein}g</strong>
                </div>
                <div>
                  <span style="font-size: 0.65rem; color: var(--text-muted); display: block;">CARB</span>
                  <strong style="font-size: 0.88rem; color: var(--accent-cyan);">${r.carbs}g</strong>
                </div>
                <div>
                  <span style="font-size: 0.65rem; color: var(--text-muted); display: block;">GRAS</span>
                  <strong style="font-size: 0.88rem; color: var(--accent-yellow);">${r.fat}g</strong>
                </div>
              </div>

              <!-- Action Buttons -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <button class="btn btn-secondary" onclick="window.RecipeSearchModule.openRecipeDetails(${idx})" style="padding: 8px; font-size: 0.8rem; justify-content: center;">
                  <i data-lucide="eye"></i> Ver Receta
                </button>
                <button class="btn btn-primary" onclick="window.RecipeSearchModule.openAssignModal(${idx})" style="padding: 8px; font-size: 0.8rem; justify-content: center; font-weight: 700;">
                  <i data-lucide="calendar-plus"></i> Asignar
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  },

  openRecipeDetails: function(index) {
    const recipe = this.currentResults[index];
    if (!recipe) return;

    this.selectedRecipeForAssign = recipe;
    const modal = document.getElementById('modal-recipe-details');
    if (!modal) return;

    const titleEl = document.getElementById('modal-recipe-title');
    const imgEl = document.getElementById('modal-recipe-image');
    const descEl = document.getElementById('modal-recipe-desc');
    const kcalEl = document.getElementById('modal-recipe-kcal');
    const protEl = document.getElementById('modal-recipe-prot');
    const carbsEl = document.getElementById('modal-recipe-carbs');
    const fatEl = document.getElementById('modal-recipe-fat');
    const ingList = document.getElementById('modal-recipe-ingredients-list');
    const instList = document.getElementById('modal-recipe-instructions-list');
    const sourceLink = document.getElementById('modal-recipe-source-link');

    if (titleEl) titleEl.textContent = recipe.title;
    if (descEl) descEl.textContent = recipe.description || '';
    if (kcalEl) kcalEl.textContent = `${recipe.kcal} kcal`;
    if (protEl) protEl.textContent = `${recipe.protein} g`;
    if (carbsEl) carbsEl.textContent = `${recipe.carbs} g`;
    if (fatEl) fatEl.textContent = `${recipe.fat} g`;

    if (imgEl) {
      if (recipe.image_url) {
        imgEl.src = recipe.image_url;
        imgEl.style.display = 'block';
      } else {
        imgEl.style.display = 'none';
      }
    }

    if (sourceLink) {
      if (recipe.source_url) {
        sourceLink.href = recipe.source_url;
        sourceLink.style.display = 'inline-flex';
      } else {
        sourceLink.style.display = 'none';
      }
    }

    if (ingList) {
      ingList.innerHTML = (recipe.ingredients || []).map(i => {
        const amt = i.amount ? `${i.amount} ${i.unit || ''}` : '';
        return `<li style="margin-bottom: 6px; font-size: 0.88rem;"><strong>${amt}</strong> ${i.name || i.original || ''}</li>`;
      }).join('');
    }

    if (instList) {
      const steps = Array.isArray(recipe.instructions) ? recipe.instructions : [recipe.instructions];
      instList.innerHTML = steps.map((s, sIdx) => {
        return `<li style="margin-bottom: 10px; font-size: 0.88rem; line-height: 1.5;">${s}</li>`;
      }).join('');
    }

    modal.classList.add('active');
    if (window.lucide) lucide.createIcons();
  },

  openAssignModal: function(index) {
    const recipe = this.currentResults[index];
    if (!recipe) return;
    this.selectedRecipeForAssign = recipe;

    const modal = document.getElementById('modal-assign-external-recipe');
    if (!modal) return;

    const titleEl = document.getElementById('assign-recipe-name');
    if (titleEl) titleEl.textContent = recipe.title;

    // Default target week to whichever user was viewing or current
    const weekSelect = document.getElementById('assign-week-type');
    if (weekSelect && window.DietModule && window.DietModule.currentWeekView) {
      weekSelect.value = window.DietModule.currentWeekView;
    }

    modal.classList.add('active');
    if (window.lucide) lucide.createIcons();
  },

  bindModalEvents: function() {
    // Close Recipe Details Modal
    const btnCloseDetails = document.getElementById('btn-close-recipe-details');
    const modalDetails = document.getElementById('modal-recipe-details');
    if (btnCloseDetails && modalDetails) {
      btnCloseDetails.addEventListener('click', () => modalDetails.classList.remove('active'));
    }

    // Assign from Details Modal
    const btnAssignFromDetails = document.getElementById('btn-assign-from-details');
    if (btnAssignFromDetails) {
      btnAssignFromDetails.addEventListener('click', () => {
        if (modalDetails) modalDetails.classList.remove('active');
        if (this.selectedRecipeForAssign) {
          const modalAssign = document.getElementById('modal-assign-external-recipe');
          if (modalAssign) modalAssign.classList.add('active');
        }
      });
    }

    // Save to Mis Platos without assigning
    const btnSaveOnly = document.getElementById('btn-save-recipe-only');
    if (btnSaveOnly) {
      btnSaveOnly.addEventListener('click', async () => {
        if (!this.selectedRecipeForAssign) return;
        try {
          const res = await window.apiFetch('api/recipes/save-and-assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipe: this.selectedRecipeForAssign })
          });
          alert(res.message || 'Receta guardada en Mis Platos');
          if (modalDetails) modalDetails.classList.remove('active');
          if (window.DietModule) window.DietModule.loadRecipesCatalog();
        } catch (e) {
          alert('Error al guardar la receta: ' + e.message);
        }
      });
    }

    // Close Assign Modal
    const btnCloseAssign = document.getElementById('btn-close-assign-external');
    const modalAssign = document.getElementById('modal-assign-external-recipe');
    if (btnCloseAssign && modalAssign) {
      btnCloseAssign.addEventListener('click', () => modalAssign.classList.remove('active'));
    }

    // Submit Assign Form
    const formAssign = document.getElementById('form-assign-external-recipe');
    if (formAssign) {
      formAssign.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!this.selectedRecipeForAssign) return;

        const day_of_week = document.getElementById('assign-day-select')?.value;
        const meal_type = document.getElementById('assign-meal-select')?.value;
        const week_type = document.getElementById('assign-week-type')?.value || 'current';
        const people_count = parseInt(document.getElementById('assign-people-count')?.value || '1', 10);

        try {
          const res = await window.apiFetch('api/recipes/save-and-assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipe: this.selectedRecipeForAssign,
              assign: {
                day_of_week,
                meal_type,
                week_type,
                people_count
              }
            })
          });

          alert(res.message || '¡Receta asignada al plan semanal!');
          if (modalAssign) modalAssign.classList.remove('active');
          if (modalDetails) modalDetails.classList.remove('active');

          if (window.DietModule) {
            window.DietModule.loadPlanAndRecipes();
          }
        } catch (err) {
          alert('Error al asignar la receta: ' + err.message);
        }
      });
    }
  },

  loadApiSettings: async function() {
    try {
      const settings = await window.apiFetch('api/settings/api-keys');
      const spoonInput = document.getElementById('setting-spoonacular-key');
      const edamamAppIdInput = document.getElementById('setting-edamam-app-id');
      const edamamAppKeyInput = document.getElementById('setting-edamam-app-key');
      const preferredSelect = document.getElementById('setting-preferred-provider');
      const defaultExcludedInput = document.getElementById('setting-default-excluded');

      if (spoonInput) spoonInput.value = settings.spoonacular_api_key || '';
      if (edamamAppIdInput) edamamAppIdInput.value = settings.edamam_app_id || '';
      if (edamamAppKeyInput) edamamAppKeyInput.value = settings.edamam_app_key || '';
      if (preferredSelect) preferredSelect.value = settings.preferred_provider || 'all';
      if (defaultExcludedInput) defaultExcludedInput.value = settings.default_excluded || '';

      // Also set provider selector in search tab to preferred provider
      const searchProviderSelect = document.getElementById('search-recipe-provider');
      if (searchProviderSelect && settings.preferred_provider) {
        searchProviderSelect.value = settings.preferred_provider;
      }
    } catch (e) {
      console.error('Error loading API settings:', e);
    }
  },

  testApi: async function(provider) {
    const statusEl = document.getElementById(`api-test-status-${provider}`);
    if (statusEl) {
      statusEl.textContent = 'Probando conexión...';
      statusEl.style.color = 'var(--text-muted)';
    }

    try {
      let body = { provider };
      if (provider === 'spoonacular') {
        body.apiKey = document.getElementById('setting-spoonacular-key')?.value;
      } else if (provider === 'edamam') {
        body.appId = document.getElementById('setting-edamam-app-id')?.value;
        body.appKey = document.getElementById('setting-edamam-app-key')?.value;
      }

      const res = await window.apiFetch('api/settings/test-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (statusEl) {
        statusEl.textContent = `✓ ${res.message}`;
        statusEl.style.color = 'var(--primary)';
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `✗ ${err.message}`;
        statusEl.style.color = 'var(--accent-red)';
      }
    }
  },

  saveApiSettings: async function() {
    const spoonKey = document.getElementById('setting-spoonacular-key')?.value || '';
    const edamamAppId = document.getElementById('setting-edamam-app-id')?.value || '';
    const edamamAppKey = document.getElementById('setting-edamam-app-key')?.value || '';
    const preferred = document.getElementById('setting-preferred-provider')?.value || 'all';
    const defaultExcluded = document.getElementById('setting-default-excluded')?.value || '';
    const statusEl = document.getElementById('api-settings-save-status');

    try {
      const res = await window.apiFetch('api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spoonacular_api_key: spoonKey,
          edamam_app_id: edamamAppId,
          edamam_app_key: edamamAppKey,
          preferred_provider: preferred,
          default_excluded: defaultExcluded
        })
      });

      if (statusEl) {
        statusEl.textContent = '✓ Guardado correctamente';
        statusEl.style.color = 'var(--primary)';
        setTimeout(() => { statusEl.textContent = ''; }, 3500);
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `✗ ${err.message}`;
        statusEl.style.color = 'var(--accent-red)';
      }
    }
  }
};
