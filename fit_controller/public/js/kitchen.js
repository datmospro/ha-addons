/* Recipe library, reviewed imports and weekly batch cooking. No framework/build step. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = s => /^(https?:\/\/|uploads\/(photos|recipes)\/)/i.test(s || '') ? s : '';
  const api = (url, body, method = 'POST') => window.apiFetch('api/' + url, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const days = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
  const freezerLabels = { yes: '❄ Congela bien', components: '❄ Congelar por partes', no: 'Preparar en el día', unknown: 'Conservación por revisar' };
  const nutritionLabels = { author: 'Macros del autor / introducidos', estimated: 'Macros estimados', unknown: 'Macros pendientes' };
  const button = (text, action, cls = 'btn-secondary') => `<button type="button" class="btn ${cls}" data-action="${action}">${text}</button>`;
  const input = (id, label, value = '', type = 'text', extra = '') => `<label class="k-field">${label}<input class="input-field" id="${id}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  const area = (id, label, value = '', rows = 3) => `<label class="k-field">${label}<textarea class="input-field" id="${id}" rows="${rows}">${esc(value)}</textarea></label>`;
  const select = (id, label, options, value) => `<label class="k-field">${label}<select class="input-field" id="${id}">${Object.entries(options).map(([k, v]) => `<option value="${esc(k)}" ${String(value) === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
  const check = (id, label, checked = false) => `<label class="k-check"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>${label}</label>`;
  const fmt = n => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });
  const ingredients = r => r.ingredients || JSON.parse(r.ingredients_json || '[]');
  const steps = r => r.instructions || JSON.parse(r.instructions_json || '[]');
  const K = window.Kitchen = {
    filters: { query: '', favorites: false, freezer: false, protein: '', kcal: '' }, batchData: null, editor: null, draft: null,
    async run(fn, target) {
      if (target) target.disabled = true;
      try { return await fn(); } catch (err) { this.message(err.message, true); }
      finally { if (target) target.disabled = false; }
    },
    message(text, error = false) {
      const node = $('k-dialog').open ? $('k-message') : $('k-global-message');
      node.textContent = text; node.className = 'k-notice' + (error ? ' k-error' : ''); node.hidden = false;
    },
    open(title, html) {
      this.focusBefore = document.activeElement;
      $('k-title').textContent = title;
      $('k-content').innerHTML = html;
      $('k-message').hidden = true;
      if (!$('k-dialog').open) $('k-dialog').showModal();
      $('k-dialog').scrollTop = 0;
    },
    close() { $('k-dialog').close(); this.focusBefore?.focus(); },
    async refresh() { await window.DietModule.loadPlanAndRecipes(); },
    init() {
      const navLabels = { dashboard: 'Resumen', diet: 'Dieta y recetas', 'recipes-search': 'Buscar recetas', workout: 'Entrenamientos', history: 'Historial', progress: 'Progreso', settings: 'Configuración' };
      document.querySelectorAll('.nav-btn').forEach(el => { const label = navLabels[el.dataset.tab]; if (label) { el.setAttribute('aria-label', label); el.title = label; } });
      document.body.insertAdjacentHTML('beforeend', `<dialog id="k-dialog" class="k-dialog"><header class="k-dialog-head"><h2 id="k-title"></h2>${button('Cerrar ×', 'close')}</header><div id="k-message" role="status" hidden></div><div id="k-content"></div></dialog>`);
      const panel = $('panel-diet');
      panel.insertAdjacentHTML('afterbegin', `<div class="k-hero"><div><span class="k-eyebrow">TU COCINA · TU SEMANA</span><h2>Comer bien. Tenerlo listo.</h2><p>Guarda platos que te apetezcan, organiza las raciones y deja el congelador preparado.</p></div><div class="k-actions">${button('＋ Importar una receta', 'import', 'btn-primary')}${button('Preparar mi semana', 'planner')}${button('Compra y cocina por lotes', 'batch')}</div></div><div id="k-global-message" role="status" hidden></div>`);
      $('my-recipes-catalog-grid').insertAdjacentHTML('beforebegin', `<div class="k-library-tools"><label class="k-field k-grow">Busca lo que te apetece<input id="k-search" type="search" class="input-field" placeholder="Burrito, pollo crujiente, pasta…"></label>${input('k-protein', 'Proteína mínima / ración', '', 'number', 'min="0" max="200" placeholder="Sin mínimo"')}${input('k-kcal', 'Kcal máximas / ración', '', 'number', 'min="1" max="5000" placeholder="Sin máximo"')}${check('k-favorites', '♥ Favoritos')}${check('k-freezer', '❄ Para congelar')}</div><p id="k-catalog-count" class="k-muted"></p>`);
      for (const [id, key] of [['k-search', 'query'], ['k-protein', 'protein'], ['k-kcal', 'kcal'], ['k-favorites', 'favorites'], ['k-freezer', 'freezer']]) {
        $(id).addEventListener('input', e => { this.filters[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; this.renderCatalog(); });
      }
      $('panel-settings').insertAdjacentHTML('beforeend', `<div class="card k-settings"><p class="k-muted">Fit Controller 1.9.0</p><h3>Importación de recetas con IA</h3><p class="k-muted">Lee texto y capturas de tus recetas. Opcional: el catálogo, los menús y la compra funcionan sin IA.</p>${button('Configurar OpenAI', 'ai-settings')}</div>`);
      document.addEventListener('click', e => {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        const [action, value] = el.dataset.action.split(':');
        const actions = {
          close: () => this.close(), import: () => this.importDialog(), 'ai-settings': () => this.settings(), 'save-ai': () => this.saveSettings(),
          extract: () => this.extract(), 'import-json': () => { this.close(); window.DietModule.openImportModal(); },
          edit: () => this.edit(value), view: () => this.view(value), favorite: () => this.favorite(value),
          'save-recipe': () => this.saveRecipe(), 'add-ingredient': () => this.addIngredient(), 'remove-ingredient': () => el.closest('.k-ingredient-row').remove(),
          'upload-photo': () => $('k-photo-file').click(), 'read-photo': () => {},
          planner: () => this.planner(), preview: () => this.preview(), apply: () => this.apply(),
          batch: () => this.batch(), 'batch-refresh': () => this.batch($('k-batch-week').value),
          'copy-shopping': () => this.copyShopping(), 'print-batch': () => this.printBatch(), 'export-recipes': () => this.exportRecipes(),
          'scale-view': () => this.view(this.viewId, Number($('k-view-portions').value)),
          starters: () => this.starters(), 'add-starters': () => this.addStarters()
        };
        if (actions[action]) this.run(actions[action], el);
      });
      $('k-dialog').addEventListener('cancel', () => this.focusBefore?.focus());
      window.DietModule.renderRecipeCatalog = () => this.renderCatalog();
      window.DietModule.openCreateRecipeModal = () => this.edit();
      window.DietModule.openEditRecipeModal = id => this.edit(id);
      window.DietModule.openShoppingListModal = () => this.run(() => this.batch());
      $('tab-week-current').parentElement.classList.add('k-week-tabs');
      this.renderCatalog();
    },
    renderCatalog() {
      const f = this.filters, cat = window.DietModule.selectedCategoryFilter;
      const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const list = window.DietModule.recipeCatalog.filter(r => (cat === 'all' || r.category === cat) && (!f.favorites || r.favorite) && (!f.freezer || ['yes', 'components'].includes(r.freezer)) &&
        (!f.protein || (r.nutrition_source !== 'unknown' && r.protein >= Number(f.protein))) && (!f.kcal || (r.nutrition_source !== 'unknown' && r.kcal <= Number(f.kcal))) &&
        norm(r.title + ' ' + r.tags + ' ' + r.ingredients_json).includes(norm(f.query)));
      $('k-catalog-count').innerHTML = `${list.length} platos · Cantidades nutricionales por ración <span class="k-export">${button('8 ideas para empezar', 'starters')}${button('Exportar recetario', 'export-recipes')}</span>`;
      $('my-recipes-catalog-grid').innerHTML = list.length ? list.map(r => `<article class="recipe-card k-recipe">
        <button class="k-photo" data-action="view:${r.id}" aria-label="Ver ${esc(r.title)}">${safeUrl(r.image_url) ? `<img loading="lazy" src="${esc(safeUrl(r.image_url))}" alt="${esc(r.title)}">` : `<span class="k-photo-placeholder">🍲<small>Añade la foto de tu plato</small></span>`}<span class="k-photo-tag">${esc(r.tags?.split(',')[0] || r.category)}</span></button>
        <div class="recipe-body"><div class="k-card-title"><h3>${esc(r.title)}</h3><button class="k-heart" data-action="favorite:${r.id}" aria-label="${r.favorite ? 'Quitar de' : 'Añadir a'} favoritos" aria-pressed="${!!r.favorite}">${r.favorite ? '♥' : '♡'}</button></div>
        <p class="k-muted k-description">${esc(r.description || 'Tu próxima receta favorita.')}</p><div class="k-macros">${r.nutrition_source === 'unknown' ? 'Macros por completar' : `<strong>${fmt(r.kcal)} <small>kcal</small></strong><strong>${fmt(r.protein)} g <small>proteína</small></strong>`}</div>
        <p class="k-muted">${esc(freezerLabels[r.freezer] || freezerLabels.unknown)} · ${fmt(r.prep_time_min)} min</p>
        <p class="k-muted">${esc(nutritionLabels[r.nutrition_source] || nutritionLabels.author)}${r.rating ? ' · ' + esc({ repeat: '¡Repetir!', ok: 'Está bien', avoid: 'No repetir' }[r.rating]) : ''}</p>
        <div class="k-actions">${button('Ver receta', 'view:' + r.id, 'btn-primary')}${button('Editar', 'edit:' + r.id)}</div></div></article>`).join('') : `<div class="k-empty"><h3>No hay platos con estos filtros</h3><p>Prueba otra búsqueda o guarda una receta que te apetezca.</p>${button('Importar receta', 'import', 'btn-primary')}</div>`;
    },
    async starters() {
      const recipes = await api('kitchen/starter-recipes');
      this.open('Cocina con ganas · 8 platos para empezar', `<div class="k-stack"><p>Una colección editable de platos para cocinar por lotes. Los macros son estimaciones orientativas: revísalos con tus marcas. Puedes añadir tus propias fotos después de cocinarlos.</p><div class="k-two">${recipes.map(r => `<article class="k-batch-dish"><h3>${esc(r.title)}</h3><p class="k-muted">${esc(r.tags)}</p><p>${r.kcal} kcal · ${r.protein} g proteína / ración</p><p>${esc(freezerLabels[r.freezer])}</p></article>`).join('')}</div>${button('Añadir colección a mis recetas', 'add-starters', 'btn-primary')}<p class="k-muted">Conserva tus recetas existentes. Los platos que ya tienes con el mismo nombre no se duplican.</p></div>`);
    },
    async addStarters() { const result = await api('kitchen/starter-recipes', {}); await this.refresh(); this.close(); this.message(`${result.added} platos añadidos al recetario.`); },
    async favorite(id) {
      const r = window.DietModule.recipeCatalog.find(r => r.id === Number(id));
      await api('recipes/' + id, { favorite: !r.favorite }, 'PUT'); await window.DietModule.loadRecipeCatalog();
    },
    view(id, portions) {
      const r = window.DietModule.recipeCatalog.find(r => r.id === Number(id));
      if (!r) throw new Error('No se encuentra la receta.');
      this.viewId = id;
      portions = Number.isFinite(portions) && portions > 0 && portions <= 100 ? portions : 1;
      const factor = portions / (r.ingredients_basis === 'recipe' ? r.servings : 1);
      this.open(r.title, `<div class="k-stack">${safeUrl(r.image_url) ? `<img class="k-cover" src="${esc(safeUrl(r.image_url))}" alt="${esc(r.title)}">` : ''}<p>${esc(r.description)}</p>
        <div class="k-macros">${r.nutrition_source === 'unknown' ? 'Macros pendientes' : `${fmt(r.kcal)} kcal · ${fmt(r.protein)} g proteína · ${fmt(r.carbs)} g carbohidratos · ${fmt(r.fat)} g grasas por ración`}</div>
        <p class="k-muted">${esc(nutritionLabels[r.nutrition_source])}. ${esc(r.nutrition_notes)}</p><div class="k-actions">${input('k-view-portions', 'Raciones que vas a cocinar', portions, 'number', 'min="1" max="100"')}${button('Ajustar cantidades', 'scale-view')}</div>
        <div class="k-two"><div><h3>Ingredientes para ${fmt(portions)} ${portions === 1 ? 'ración' : 'raciones'}</h3><ul class="k-list">${ingredients(r).map(i => `<li>${esc(i.name)} <strong>${typeof i.amount === 'number' ? fmt(i.amount * factor) : esc(i.amount)} ${esc(i.unit)}</strong>${i.fresh ? ' · añadir fresco' : ''}${i.optional ? ' · opcional' : ''}</li>`).join('')}</ul></div><div><h3>Preparación</h3><p class="k-muted">Pasos de la receta original: adapta las tandas y los recipientes a las raciones elegidas.</p><ol class="k-steps">${steps(r).map(s => `<li>${esc(s)}</li>`).join('') || '<li>Faltan los pasos de preparación. Completa la receta antes de cocinar.</li>'}</ol></div></div>
        <div class="k-notice"><strong>${esc(freezerLabels[r.freezer])}</strong><p>${esc(r.freeze_notes)}</p><p>${esc(r.reheat_notes)}</p></div>
        ${safeUrl(r.source_url) ? `<a href="${esc(safeUrl(r.source_url))}" target="_blank" rel="noopener noreferrer">Ver fuente original ↗</a>` : ''}
        <div class="k-actions">${button('Editar receta', 'edit:' + id)}<button class="btn btn-secondary" id="k-assign-view">Añadir al menú</button><button class="btn btn-secondary" id="k-delete-view">Eliminar receta</button></div></div>`);
      $('k-assign-view').onclick = () => { this.close(); window.DietModule.openAssignModal(); $('assign-meal-recipe-id').value = id; };
      $('k-delete-view').onclick = () => this.run(async () => { if (!confirm('¿Eliminar esta receta? Las comidas asignadas quedarán sin ingredientes hasta que elijas otra.')) return; await api('recipes/' + id, {}, 'DELETE'); this.close(); await this.refresh(); });
    },
    edit(id, imported) {
      const r = imported || (id ? window.DietModule.recipeCatalog.find(r => r.id === Number(id)) : {}) || {};
      this.editor = { id: imported ? null : id, original: r };
      this.open(imported ? 'Revisa la receta antes de guardarla' : id ? 'Editar receta' : 'Nueva receta', `<form id="k-recipe-form" class="k-stack">
        <p class="k-muted">Los macros son siempre por ración. Indica a cuántas raciones corresponden los ingredientes para calcular bien la compra.</p>
        ${input('kr-title', 'Nombre del plato', r.title, 'text', 'required maxlength="200"')}${area('kr-description', 'Qué tiene de especial', r.description, 2)}
        <div class="k-three">${select('kr-category', 'Comida', { almuerzo: 'Almuerzo', cena: 'Cena', desayuno: 'Desayuno', merienda: 'Merienda', snack: 'Snack' }, r.category || 'almuerzo')}${input('kr-time', 'Preparación (min)', r.prep_time_min || 30, 'number', 'min="1" max="1440" required')}${input('kr-tags', 'Estilos separados por comas', r.tags, 'text', 'placeholder="Crujiente, coreano, bowl"')}</div>
        <div class="k-two">${select('kr-basis', 'Las cantidades de ingredientes son…', { portion: 'Para 1 ración', recipe: 'Para la receta completa' }, r.ingredients_basis || 'recipe')}${input('kr-servings', 'Raciones de la receta completa', r.servings || 1, 'number', 'min="0.1" max="1000" step="0.1" required')}</div>
        <h3>Ingredientes</h3><p class="k-muted">Cantidad y unidad separadas: 200 · g. Marca los acompañamientos que añadirás frescos. Las cantidades “al gusto” se mostrarán como pendientes de concretar.</p>
        <div id="k-ingredients"></div>${button('＋ Añadir ingrediente', 'add-ingredient')}
        ${area('kr-steps', 'Preparación · un paso por línea', steps(r).join('\n'), 6)}
        <h3>Macros por ración</h3><div class="k-three">${['kcal', 'protein', 'carbs', 'fat', 'fiber'].map((key, i) => input('kr-' + key, ['Calorías (kcal)', 'Proteína (g)', 'Carbohidratos (g)', 'Grasa (g)', 'Fibra (g)'][i], r[key] ?? 0, 'number', 'min="0" max="20000" step="0.1" required')).join('')}${select('kr-nutrition', 'Origen', nutritionLabels, r.nutrition_source || 'unknown')}</div>
        ${area('kr-nutrition-notes', 'Notas y dudas sobre los macros', r.nutrition_notes)}
        <h3>Preparar y congelar</h3>${select('kr-freezer', '¿Cómo se conserva?', freezerLabels, r.freezer || 'unknown')}
        ${area('kr-freeze', 'Cómo repartir, congelar y qué dejar aparte', r.freeze_notes)}${area('kr-reheat', 'Cómo descongelar, recalentar y terminar el plato', r.reheat_notes)}
        <div class="k-two">${input('kr-source', 'Enlace original (opcional)', r.source_url, 'url')}${input('kr-image', 'Foto del plato: URL (opcional)', r.image_url)}</div>
        <div class="k-actions">${button('Subir foto del plato', 'upload-photo')}<input id="k-photo-file" type="file" accept="image/png,image/jpeg,image/webp" hidden><span id="k-photo-status" class="k-muted"></span></div>
        <div class="k-two">${check('kr-favorite', '♥ Guardar en favoritos', !!r.favorite)}${select('kr-rating', '¿Qué os ha parecido?', { '': 'Aún no probado', repeat: '¡Repetir!', ok: 'Está bien', avoid: 'No repetir' }, r.rating || '')}</div>
        <button class="btn btn-primary" type="submit">Guardar receta</button></form>`);
      for (const ing of ingredients(r)) this.addIngredient(ing);
      if (!ingredients(r).length) this.addIngredient();
      $('k-recipe-form').onsubmit = e => { e.preventDefault(); this.run(() => this.saveRecipe(), e.submitter); };
      $('k-photo-file').onchange = () => this.run(async () => {
        const file = $('k-photo-file').files[0]; if (!file) return;
        const data = await this.readImage(file);
        const result = await api('kitchen/photo', { image: data });
        $('kr-image').value = result.url; $('k-photo-status').textContent = result.warning || 'Foto subida. Guarda la receta para asociarla.';
      });
    },
    addIngredient(ing = {}) {
      const row = document.createElement('div'); row.className = 'k-ingredient-row';
      row.dataset.group = ing.group || '';
      row.innerHTML = `<input class="input-field ki-name" aria-label="Ingrediente" placeholder="Ingrediente" value="${esc(ing.name)}" required><input class="input-field ki-amount" aria-label="Cantidad" placeholder="200" value="${esc(ing.amount ?? '')}" required><input class="input-field ki-unit" aria-label="Unidad" placeholder="g / ml / ud" value="${esc(ing.unit)}"><label class="k-check"><input class="ki-fresh" type="checkbox" ${ing.fresh ? 'checked' : ''}>Fresco</label><label class="k-check"><input class="ki-optional" type="checkbox" ${ing.optional ? 'checked' : ''}>Opcional</label>${button('×', 'remove-ingredient')}`;
      $('k-ingredients').append(row);
    },
    async saveRecipe() {
      if (!$('k-recipe-form').reportValidity()) return;
      const v = id => $('kr-' + id).value;
      const body = { title: v('title'), description: v('description'), category: v('category'), prep_time_min: v('time'), tags: v('tags'),
        ingredients_basis: v('basis'), servings: v('servings'), ingredients: [...document.querySelectorAll('.k-ingredient-row')].map(row => ({
          name: row.querySelector('.ki-name').value, amount: row.querySelector('.ki-amount').value, unit: row.querySelector('.ki-unit').value,
          fresh: row.querySelector('.ki-fresh').checked, optional: row.querySelector('.ki-optional').checked, group: row.dataset.group
        })), instructions: v('steps').split('\n').map(s => s.trim()).filter(Boolean),
        ...Object.fromEntries(['kcal', 'protein', 'carbs', 'fat', 'fiber'].map(k => [k, v(k)])),
        nutrition_source: v('nutrition'), nutrition_notes: v('nutrition-notes'), freezer: v('freezer'), freeze_notes: v('freeze'), reheat_notes: v('reheat'),
        source_url: v('source'), image_url: v('image'), favorite: $('kr-favorite').checked, rating: v('rating') };
      if (!body.ingredients.length) throw new Error('Añade al menos un ingrediente para poder calcular la compra.');
      const result = await api('recipes' + (this.editor.id ? '/' + this.editor.id : ''), body, this.editor.id ? 'PUT' : 'POST');
      await this.refresh(); this.view(result.id); this.message('Receta guardada.');
    },
    async readImage(file) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 6000000) throw new Error('Usa una imagen PNG, JPEG o WebP de hasta 6 MB.');
      return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('No se pudo leer la imagen.')); reader.readAsDataURL(file); });
    },
    async importDialog() {
      const settings = await api('kitchen/ai-settings');
      this.open('De Instagram a tu recetario', `<div class="k-stack"><p>Pega los ingredientes y la preparación, o añade hasta cuatro capturas. Obtendrás un borrador editable, nunca se guarda automáticamente.</p>
        ${area('k-import-text', 'Texto de la publicación', '', 7)}${input('k-import-source', 'Enlace original (solo referencia)', '', 'url', 'placeholder="https://www.instagram.com/…"')}
        <label class="k-field">Capturas de la receta<input class="input-field" id="k-import-images" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><div id="k-image-preview" class="k-image-preview"></div>
        <p class="k-notice">${settings.configured ? 'Al pulsar «Leer receta», el texto y las capturas se envían a OpenAI con tu clave. La API tiene coste según uso.' : 'Configura tu clave de OpenAI para leer capturas y texto. También puedes importar JSON sin usar la API.'} El enlace no se descarga: incluye el contenido de la receta.</p>
        <div class="k-actions">${settings.configured ? button('Leer receta y revisar', 'extract', 'btn-primary') : ''}${button('Configurar IA', 'ai-settings')}${button('Importar JSON sin IA', 'import-json')}</div><p id="k-extract-status" role="status"></p></div>`);
      $('k-import-images').onchange = () => this.run(async () => {
        const files = [...$('k-import-images').files]; if (files.length > 4) throw new Error('Selecciona como máximo cuatro capturas.');
        const images = await Promise.all(files.map(f => this.readImage(f)));
        $('k-image-preview').innerHTML = images.map(src => `<img src="${src}" alt="Captura seleccionada">`).join('');
      });
    },
    async extract() {
      const files = [...$('k-import-images').files];
      if (files.length > 4) throw new Error('Selecciona como máximo cuatro capturas.');
      const body = { text: $('k-import-text').value, source_url: $('k-import-source').value, images: await Promise.all(files.map(f => this.readImage(f))) };
      $('k-extract-status').textContent = 'Leyendo la receta… puede tardar hasta 90 segundos.';
      try {
        const data = await api('kitchen/extract', body);
        this.edit(null, data.recipe);
        this.message(data.warnings.length ? data.warnings.join(' · ') : 'Revisa las cantidades, las raciones y los pasos antes de guardar.');
      } catch (err) { if ($('k-extract-status')) $('k-extract-status').textContent = ''; throw err; }
    },
    async settings() {
      const s = await api('kitchen/ai-settings');
      this.open('Importación con OpenAI', `<form id="k-ai-form" class="k-stack"><p>La clave se guarda en el servidor del addon y no se devuelve al navegador. La API se factura por separado de las suscripciones de ChatGPT.</p>
        ${input('k-ai-key', s.configured ? 'Clave configurada · deja vacío para conservarla' : 'Clave API de OpenAI', '', 'password', 'autocomplete="new-password"')}
        ${input('k-ai-model', 'Modelo con imágenes y salida estructurada', s.model, 'text', 'required')}${check('k-ai-remove', 'Eliminar la clave guardada')}
        <button type="submit" class="btn btn-primary">Guardar configuración</button><a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">Gestionar claves de OpenAI ↗</a></form>`);
      $('k-ai-form').onsubmit = e => { e.preventDefault(); this.run(() => this.saveSettings(), e.submitter); };
    },
    async saveSettings() { await api('kitchen/ai-settings', { api_key: $('k-ai-key').value, model: $('k-ai-model').value, remove: $('k-ai-remove').checked }); $('k-ai-key').value = ''; this.message('Configuración guardada. Ya puedes importar una receta.'); },
    planner() {
      this.draft = null;
      const list = window.DietModule.recipeCatalog.filter(r => r.rating !== 'avoid');
      this.open('Preparar nuestra semana', `<form id="k-plan-form" class="k-stack"><p>Elige platos que os gusten. La propuesta agrupa repeticiones para cocinar menos veces y respeta las exclusiones guardadas en Configuración. Los límites son por plato y ración, no un objetivo diario.</p>
        <div class="k-three">${select('kp-week', 'Semana', { current: 'Semana actual', next: 'Próxima semana' }, window.DietModule.selectedWeek)}${input('kp-people', 'Personas / raciones por comida', window.FitApp.peopleCount || 2, 'number', 'min="1" max="20" required')}${input('kp-repeats', 'Máximo de veces cada plato', 3, 'number', 'min="1" max="14" required')}</div>
        <div class="k-days">${days.map(d => check('kp-' + d, esc(d), true)).join('')}</div><div class="k-actions">${check('kp-almuerzo', 'Almuerzos', true)}${check('kp-cena', 'Cenas', true)}</div>
        <div class="k-three">${input('kp-protein', 'Mínimo de proteína / plato (g)', 30, 'number', 'min="0" max="200" required')}${input('kp-kcal', 'Máximo de kcal / plato', 650, 'number', 'min="1" max="5000" required')}${input('kp-excluded', 'Excluir ingredientes (comas)', '', 'text', 'placeholder="Champiñón, atún…"')}</div>
        <div class="k-actions">${check('kp-freezer', 'Solo platos con congelación revisada', true)}${check('kp-favorites', 'Solo favoritos')}${check('kp-replace', 'Reemplazar comidas de los huecos seleccionados')}</div>
        <details open><summary>Platos disponibles · desmarca los que no os apetecen</summary><div class="k-picks">${list.map(r => `<label class="k-check"><input type="checkbox" name="kp-recipe" value="${r.id}" checked><span>${esc(r.title)}<small>${fmt(r.kcal)} kcal · ${fmt(r.protein)} g proteína · ${esc(freezerLabels[r.freezer] || freezerLabels.unknown)}</small></span></label>`).join('') || '<p>Añade recetas al catálogo para empezar.</p>'}</div></details>
        <button type="submit" class="btn btn-primary">Ver propuesta</button><div id="k-plan-preview"></div></form>`);
      $('k-plan-form').onsubmit = e => { e.preventDefault(); this.run(() => this.preview(), e.submitter); };
      $('k-plan-form').addEventListener('change', e => { if (!e.target.closest('#k-plan-preview')) { this.draft = null; $('k-plan-preview').innerHTML = ''; } });
    },
    async preview() {
      const v = id => $('kp-' + id).value, c = id => $('kp-' + id).checked;
      const data = await api('kitchen/plan-preview', { week: v('week'), people: Number(v('people')), repeats: Number(v('repeats')), days: days.filter(c), meals: ['almuerzo', 'cena'].filter(c), minProtein: Number(v('protein')), maxKcal: Number(v('kcal')), excluded: v('excluded'), freezerOnly: c('freezer'), favoritesOnly: c('favorites'), replace: c('replace'), recipeIds: [...document.querySelectorAll('[name="kp-recipe"]:checked')].map(el => Number(el.value)) });
      this.draft = data;
      $('k-plan-preview').innerHTML = `<h3>Tu propuesta · ${data.plan.length} comidas</h3><p class="k-muted">Puedes cambiar cada plato antes de guardar. Al cambiar manualmente un plato puedes superar las repeticiones elegidas.</p><div class="k-preview-rows">${data.plan.map((p, i) => `<label class="k-preview-row"><span>${esc(p.day_of_week)} · ${esc(p.meal_type)}<small>${p.people_count} raciones</small></span><select class="input-field" data-plan-index="${i}">${data.candidates.filter(r => ['almuerzo', 'cena'].includes(r.category)).map(r => `<option value="${r.id}" ${r.id === p.recipe_id ? 'selected' : ''}>${esc(r.title)} · ${r.kcal} kcal / ${r.protein} g P</option>`).join('')}</select></label>`).join('')}</div><div class="k-notice" id="k-plan-totals"></div>${button('Guardar este menú', 'apply', 'btn-primary')}`;
      const totals = () => {
        let kcal = 0, protein = 0;
        for (const el of document.querySelectorAll('[data-plan-index]')) {
          const p = data.plan[Number(el.dataset.planIndex)]; p.recipe_id = Number(el.value);
          const r = data.candidates.find(r => r.id === p.recipe_id); kcal += r.kcal; protein += r.protein;
        }
        $('k-plan-totals').textContent = `Media por comida y persona: ${fmt(kcal / data.plan.length)} kcal · ${fmt(protein / data.plan.length)} g proteína. No incluye otras comidas del día.`;
      };
      $('k-plan-preview').onchange = totals; totals(); $('k-plan-preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    async apply() { if (!this.draft) throw new Error('Genera primero una propuesta.'); await api('kitchen/plan-apply', this.draft); const target = this.draft.week; this.draft = null; await window.FitApp.loadProfile(); await window.DietModule.switchWeekView(target); await this.batch(target); this.message('Menú guardado. Esta es la compra y la preparación para sus raciones.'); },
    async batch(target = window.DietModule.selectedWeek) {
      const data = await api('kitchen/batch?week=' + target); this.batchData = data;
      this.open('Compra y cocina de la semana', `<div class="k-stack"><div class="k-actions">${select('k-batch-week', 'Semana', { current: 'Semana actual', next: 'Próxima semana' }, target)}${button('Actualizar', 'batch-refresh')}${button('Copiar compra pendiente', 'copy-shopping')}${button('Imprimir compra, cocina y etiquetas', 'print-batch')}</div>
        ${!data.dishes.length ? `<div class="k-empty"><h3>Tu semana aún no tiene recetas</h3><p>Planifica las comidas para obtener cantidades y raciones.</p>${button('Preparar mi semana', 'planner', 'btn-primary')}</div>` : this.batchHtml(data)}
        </div>`);
      if (data.dishes.length) {
        for (const el of document.querySelectorAll('[data-k-check]')) {
          el.checked = !!data.checks[el.dataset.kCheck];
          el.onchange = () => {
            data.checks[el.dataset.kCheck] = el.checked;
            // Serialize snapshots so rapid clicks cannot restore an older state.
            const snapshot = { ...data.checks };
            this.checkQueue = (this.checkQueue || Promise.resolve()).catch(() => {}).then(() => api('kitchen/checks', { key: data.key, checks: snapshot })).catch(err => this.message('No se pudo guardar la marca: ' + err.message, true));
          };
        }
      }
    },
    batchHtml(data, printing = false) {
      const checkbox = (key, text) => `<label class="k-check"><input type="checkbox" data-k-check="${esc(key)}" ${data.checks[key] ? 'checked' : ''}>${text}</label>`;
      const uncertain = data.shopping.filter(i => i.needs_review).length;
      let group = '';
      return `<div class="k-summary"><strong>${data.dishes.length}<small>platos distintos</small></strong><strong>${data.portions}<small>raciones individuales</small></strong><strong>${data.shopping.length}<small>ingredientes agrupados</small></strong></div>
        <p class="k-muted">Compra calculada con las raciones de cada comida y las cantidades guardadas. No mezcla gramos con mililitros ni convierte tazas a peso. Los opcionales van separados.</p>
        ${data.warnings.length || uncertain ? `<div class="k-notice k-warning"><strong>Antes de comprar y cocinar</strong><ul class="k-list">${data.warnings.map(w => `<li>${esc(w)}</li>`).join('')}${uncertain ? `<li>${uncertain} ingredientes necesitan cantidad o unidad concreta. La compra aún no está completa.</li>` : ''}</ul></div>` : ''}
        <h3>1. Revisa la despensa y haz la compra</h3><p class="k-muted">Marca lo que ya tienes en cantidad suficiente o has comprado. Las marcas se comparten entre dispositivos y se reinician si cambia el menú o sus cantidades.</p>
        <div class="k-shopping">${data.shopping.map((i, index) => {
          const heading = group !== i.group ? `<h4>${esc(i.group)}</h4>` : ''; group = i.group;
          return heading + `<div class="k-shopping-row">${checkbox('shop-' + index, `<span>${esc(i.name)}${i.optional ? ' (opcional)' : ''}<small>${esc(i.recipes.join(' · '))}</small></span>`)}<strong>${esc(i.displayAmount)}${i.needs_review ? ' ⚠ revisar' : ''}</strong></div>`;
        }).join('')}</div>
        <h3>2. Cocina por platos y reparte</h3><p class="k-muted">Orden sugerido: empieza por los platos más largos. Los tiempos son los de cada receta original; al aumentar las raciones quizá necesites varias tandas. Prepara ${data.portions} recipientes si vas a envasar una ración por recipiente.</p>
        <div class="k-batch-dishes">${data.dishes.map(d => `<article class="k-batch-dish"><h3>${esc(d.title)} · ${d.portions} raciones</h3><p class="k-muted">${esc(d.slots.map(s => `${s.day} ${s.meal}: ${s.portions}`).join(' · '))}</p><p>${esc(freezerLabels[d.freezer])}</p>
          <div class="k-two"><div><h4>Cantidades totales para cocinar</h4><ul class="k-list">${d.ingredients.map(i => `<li>${esc(i.name)}: <strong>${typeof i.amount === 'number' ? fmt(i.amount) : esc(i.amount)} ${esc(i.unit)}</strong>${i.fresh ? ' · reservar fresco, no congelar con el plato' : ''}${i.optional ? ' · opcional' : ''}</li>`).join('')}</ul></div>
          <div><h4>Preparación</h4><ol class="k-steps">${d.instructions.map(s => `<li>${esc(s)}</li>`).join('') || '<li>Faltan los pasos: completa esta receta antes de cocinar.</li>'}</ol></div></div>
          <p class="k-notice">${esc(d.freeze_notes || 'Completa las notas de conservación de esta receta antes de congelar.')}<br>${esc(d.reheat_notes)}</p>
          <div class="k-actions">${checkbox('cooked-' + d.id, 'Cocinado')}${checkbox('packed-' + d.id, 'Repartido y etiquetado')}${printing ? '' : button('Revisar receta', 'edit:' + d.id)}</div></article>`).join('')}</div>
        <h3>3. Enfría, etiqueta y congela</h3><div class="k-notice"><p>Divide en recipientes pequeños y enfría con rapidez. Guarda las sobras en frío en un plazo de 1–2 horas; consúmelas en 48 horas o congélalas. Para arroz cocido, enfría idealmente en una hora y consume el refrigerado en 24 horas.</p><p>Descongela en la nevera y consume en las 24 horas siguientes a la descongelación completa. Recalienta una sola vez, hasta que esté bien caliente también en el centro. Mantén los acompañamientos frescos separados.</p><a href="https://www.food.gov.uk/safety-hygiene/chilling" target="_blank" rel="noopener noreferrer">Guía de conservación · Food Standards Agency ↗</a> · <a href="https://www.food.gov.uk/safety-hygiene/home-food-fact-checker" target="_blank" rel="noopener noreferrer">Arroz y recalentado ↗</a></div>
        <div class="k-labels">${data.dishes.flatMap(d => d.slots.map(s => `<div class="k-freezer-label"><strong>${esc(d.title)}</strong><span>${esc(s.day)} · ${esc(s.meal)} · ${s.portions} raciones</span><span>${esc(freezerLabels[d.freezer])}</span><span>Cocinado: ____ / ____ &nbsp; Congelado: ____ / ____</span><span>${d.nutrition_source === 'unknown' ? 'Macros pendientes' : `${fmt(d.kcal)} kcal · ${fmt(d.protein)} g proteína / ración`}</span><small>${esc(d.reheat_notes || 'Revisa las instrucciones de conservación de la receta.')}</small></div>`)).join('')}</div>`;
    },
    async copyShopping() {
      const d = this.batchData;
      const lines = d.shopping.filter((_, i) => !d.checks['shop-' + i]).map(i => `☐ ${i.name}: ${i.displayAmount}${i.optional ? ' (opcional)' : ''}${i.needs_review ? ' [REVISAR]' : ''}`);
      const text = `Compra · ${d.week === 'next' ? 'próxima semana' : 'semana actual'}\n${lines.join('\n')}${d.warnings.length ? '\n\nRevisar:\n' + d.warnings.join('\n') : ''}`;
      try { await navigator.clipboard.writeText(text); this.message('Compra pendiente copiada.'); }
      catch { this.download('compra-semanal.txt', text, 'text/plain'); this.message('Se ha descargado la lista porque el portapapeles no está disponible.'); }
    },
    printBatch() {
      const frame = document.createElement('iframe'); frame.className = 'k-print-frame'; document.body.append(frame);
      const doc = frame.contentDocument; doc.open();
      doc.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Compra y cocina semanal</title><style>body{font:12px Arial;color:#111;margin:24px}h1,h2,h3,h4{margin:20px 0 8px}.k-two{display:grid;grid-template-columns:1fr 1fr;gap:24px}.k-list,.k-steps{padding-left:18px;line-height:1.6}.k-summary{display:flex;gap:40px}.k-summary strong{font-size:22px}small,span{display:block}small{font-size:11px}.k-shopping-row{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:6px}.k-check{display:flex;gap:8px}.k-actions{display:flex;gap:18px}.k-batch-dish,.k-freezer-label{break-inside:avoid;border:1px solid #ccc;padding:12px;margin:12px 0}.k-labels{display:grid;grid-template-columns:1fr 1fr;gap:12px}.k-notice{background:#f2f4f3;padding:12px}.k-warning{border:1px solid #999}a{color:#333}input{accent-color:#111}</style></head><body><h1>Compra y cocina · ${this.batchData.week === 'next' ? 'próxima semana' : 'semana actual'}</h1>${this.batchHtml(this.batchData, true)}</body></html>`); doc.close();
      frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000);
    },
    download(name, text, type) { const a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type })); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); },
    exportRecipes() { this.download('fit-controller-recetas.json', JSON.stringify({ recipes: window.DietModule.recipeCatalog.map(r => ({ ...r, ingredients: ingredients(r), instructions: steps(r) })) }, null, 2), 'application/json'); this.message('Recetario exportado. Las fotos locales y las claves API no se incluyen en el archivo.'); }
  };
  document.addEventListener('DOMContentLoaded', () => K.init());
})();
