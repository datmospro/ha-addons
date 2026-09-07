const { db } = require('./database');

/**
 * Common Spanish-to-English dictionary for ingredients, dishes, and vetoes
 */
const ES_EN_MAP = {
  'tomate': 'tomato',
  'tomates': 'tomato',
  'jitomate': 'tomato',
  'salsa de tomate': 'tomato sauce',
  'cebolla': 'onion',
  'cebollas': 'onion',
  'ajo': 'garlic',
  'cerdo': 'pork',
  'carne de cerdo': 'pork',
  'bacon': 'bacon',
  'panceta': 'pork belly',
  'jamon': 'ham',
  'jamón': 'ham',
  'pollo': 'chicken',
  'pechuga de pollo': 'chicken breast',
  'ternera': 'beef',
  'vaca': 'beef',
  'carne picada': 'minced meat',
  'pescado': 'fish',
  'salmon': 'salmon',
  'salmón': 'salmon',
  'atun': 'tuna',
  'atún': 'tuna',
  'marisco': 'shellfish',
  'mariscos': 'shellfish',
  'gamba': 'shrimp',
  'gambas': 'shrimp',
  'langostino': 'prawn',
  'langostinos': 'prawn',
  'mejillon': 'mussel',
  'mejillones': 'mussel',
  'huevo': 'egg',
  'huevos': 'egg',
  'leche': 'milk',
  'lactosa': 'dairy',
  'queso': 'cheese',
  'yogur': 'yogurt',
  'mantequilla': 'butter',
  'nata': 'cream',
  'gluten': 'gluten',
  'trigo': 'wheat',
  'harina': 'flour',
  'pan': 'bread',
  'pasta': 'pasta',
  'arroz': 'rice',
  'avena': 'oats',
  'patata': 'potato',
  'patatas': 'potato',
  'papa': 'potato',
  'papas': 'potato',
  'aguacate': 'avocado',
  'frutos secos': 'nuts',
  'nuez': 'walnut',
  'nueces': 'walnut',
  'almendra': 'almond',
  'almendras': 'almond',
  'cacahuete': 'peanut',
  'cacahuetes': 'peanut',
  'mani': 'peanut',
  'maní': 'peanut',
  'azucar': 'sugar',
  'azúcar': 'sugar',
  'ensalada': 'salad',
  'sopa': 'soup',
  'guiso': 'stew',
  'pizzas': 'pizza',
  'pizza': 'pizza',
  'hamburguesa': 'burger',
  'soja': 'soy',
  'tofu': 'tofu',
  'champinon': 'mushroom',
  'champiñón': 'mushroom',
  'champinones': 'mushroom',
  'setas': 'mushroom'
};

function translateText(text) {
  if (!text) return '';
  const clean = text.trim().toLowerCase();
  if (ES_EN_MAP[clean]) return ES_EN_MAP[clean];

  let result = clean;
  for (const [es, en] of Object.entries(ES_EN_MAP)) {
    const reg = new RegExp(`\\b${es}\\b`, 'gi');
    result = result.replace(reg, en);
  }
  return result;
}

function getExcludedKeywords(excludedList) {
  if (!excludedList) return [];
  const terms = Array.isArray(excludedList)
    ? excludedList
    : String(excludedList).split(',').map(s => s.trim()).filter(Boolean);

  const keywords = new Set();
  for (const raw of terms) {
    const term = raw.trim().toLowerCase();
    if (!term) continue;
    keywords.add(term);
    const translated = translateText(term);
    if (translated) keywords.add(translated.toLowerCase());

    if (term === 'tomate' || term === 'tomato') {
      keywords.add('tomates');
      keywords.add('tomatoes');
      keywords.add('tomato paste');
      keywords.add('tomato sauce');
      keywords.add('cherry tomato');
      keywords.add('ketchup');
    } else if (term === 'cerdo' || term === 'pork') {
      keywords.add('bacon');
      keywords.add('ham');
      keywords.add('jamon');
      keywords.add('jamón');
      keywords.add('panceta');
      keywords.add('sausage');
      keywords.add('chorizo');
    } else if (term === 'lactosa' || term === 'dairy') {
      keywords.add('milk');
      keywords.add('leche');
      keywords.add('cheese');
      keywords.add('queso');
      keywords.add('butter');
      keywords.add('mantequilla');
      keywords.add('cream');
      keywords.add('nata');
      keywords.add('yogurt');
      keywords.add('yogur');
    } else if (term === 'frutos secos' || term === 'nuts') {
      keywords.add('almond');
      keywords.add('walnut');
      keywords.add('peanut');
      keywords.add('hazelnut');
      keywords.add('cashew');
      keywords.add('almendra');
      keywords.add('nuez');
      keywords.add('cacahuete');
    } else if (term === 'marisco' || term === 'mariscos' || term === 'shellfish') {
      keywords.add('shrimp');
      keywords.add('prawn');
      keywords.add('crab');
      keywords.add('lobster');
      keywords.add('mussel');
      keywords.add('gamba');
      keywords.add('langostino');
      keywords.add('mejillon');
    } else if (term === 'gluten') {
      keywords.add('wheat');
      keywords.add('trigo');
      keywords.add('flour');
      keywords.add('harina');
      keywords.add('bread');
      keywords.add('pan');
    }
  }
  return Array.from(keywords);
}

/**
 * Strict server-side post-filter:
 * Checks recipe title and every ingredient text against the veto list.
 */
function passesVetoFilter(recipe, vetoKeywords) {
  if (!vetoKeywords || vetoKeywords.length === 0) return true;

  const targetStrings = [];
  if (recipe.title) targetStrings.push(recipe.title.toLowerCase());
  if (recipe.description) targetStrings.push(recipe.description.toLowerCase());

  if (Array.isArray(recipe.ingredients)) {
    for (const ing of recipe.ingredients) {
      if (typeof ing === 'string') {
        targetStrings.push(ing.toLowerCase());
      } else if (ing && typeof ing === 'object') {
        if (ing.name) targetStrings.push(String(ing.name).toLowerCase());
        if (ing.original) targetStrings.push(String(ing.original).toLowerCase());
      }
    }
  }

  const combinedText = targetStrings.join(' ');
  for (const keyword of vetoKeywords) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i');
    if (regex.test(combinedText)) {
      return false; // VETOED!
    }
  }

  return true;
}

/**
 * Fetch Spoonacular Complex Search
 */
async function searchSpoonacular({ apiKey, query, minKcal, maxKcal, minProtein, maxProtein, minCarbs, maxCarbs, minFat, maxFat, excludedList, offset = 0, number = 24 }) {
  if (!apiKey) throw new Error('API Key de Spoonacular no configurada');

  const englishQuery = translateText(query || '');
  const url = new URL('https://api.spoonacular.com/recipes/complexSearch');
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('number', String(number));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('addRecipeInformation', 'true');
  url.searchParams.set('addRecipeNutrition', 'true');
  url.searchParams.set('fillIngredients', 'true');

  if (englishQuery) {
    url.searchParams.set('query', englishQuery);
  }

  if (minKcal) url.searchParams.set('minCalories', String(minKcal));
  if (maxKcal) url.searchParams.set('maxCalories', String(maxKcal));
  if (minProtein) url.searchParams.set('minProtein', String(minProtein));
  if (maxProtein) url.searchParams.set('maxProtein', String(maxProtein));
  if (minCarbs) url.searchParams.set('minCarbs', String(minCarbs));
  if (maxCarbs) url.searchParams.set('maxCarbs', String(maxCarbs));
  if (minFat) url.searchParams.set('minFat', String(minFat));
  if (maxFat) url.searchParams.set('maxFat', String(maxFat));

  const vetoKeywords = getExcludedKeywords(excludedList);
  if (vetoKeywords.length > 0) {
    url.searchParams.set('excludeIngredients', vetoKeywords.join(','));
  }

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'FitController/1.8' }
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Error en Spoonacular API (${res.status}): ${errBody || res.statusText}`);
  }

  const data = await res.json();
  const results = data.results || [];
  const totalResults = data.totalResults || results.length;

  const mapped = results.map(item => {
    const nutrients = (item.nutrition && item.nutrition.nutrients) ? item.nutrition.nutrients : [];
    const getNutrient = name => {
      const found = nutrients.find(n => n.name && n.name.toLowerCase() === name.toLowerCase());
      return found ? Math.round(found.amount) : 0;
    };

    const kcal = getNutrient('Calories');
    const protein = getNutrient('Protein');
    const carbs = getNutrient('Carbohydrates');
    const fat = getNutrient('Fat');
    const fiber = getNutrient('Fiber');

    const ingredients = (item.extendedIngredients || []).map(ing => ({
      name: ing.nameClean || ing.name || ing.originalName || 'Ingrediente',
      amount: ing.measures && ing.measures.metric ? ing.measures.metric.amount : (ing.amount || 1),
      unit: ing.measures && ing.measures.metric ? ing.measures.metric.unitShort : (ing.unit || 'g'),
      original: ing.original || ing.name
    }));

    let instructions = [];
    if (item.analyzedInstructions && item.analyzedInstructions.length > 0) {
      for (const section of item.analyzedInstructions) {
        if (Array.isArray(section.steps)) {
          instructions.push(...section.steps.map(s => s.step));
        }
      }
    } else if (item.instructions) {
      instructions = item.instructions.replace(/<[^>]*>?/gm, '').split('\n').map(s => s.trim()).filter(Boolean);
    }
    if (instructions.length === 0) {
      instructions = ['Preparar los ingredientes y cocinar siguiendo las indicaciones básicas del plato.'];
    }

    let category = 'almuerzo';
    const dishTypes = (item.dishTypes || []).map(d => d.toLowerCase());
    if (dishTypes.some(d => d.includes('breakfast') || d.includes('morning'))) category = 'desayuno';
    else if (dishTypes.some(d => d.includes('dinner'))) category = 'cena';
    else if (dishTypes.some(d => d.includes('snack') || d.includes('dessert'))) category = 'snack';
    else if (dishTypes.some(d => d.includes('salad') || d.includes('soup') || d.includes('side dish'))) category = 'merienda';

    return {
      id: `spoon_${item.id}`,
      external_id: String(item.id),
      provider: 'spoonacular',
      title: item.title,
      description: item.summary ? item.summary.replace(/<[^>]*>?/gm, '').slice(0, 200) + '...' : `Receta de Spoonacular (${item.sourceName || 'Web'})`,
      category,
      prep_time_min: item.readyInMinutes || 25,
      servings: item.servings || 1,
      kcal,
      protein,
      carbs,
      fat,
      fiber,
      ingredients,
      instructions,
      image_url: item.image || '',
      source_url: item.sourceUrl || '',
      is_external: true
    };
  });

  return mapped.filter(r => passesVetoFilter(r, vetoKeywords));
}

/**
 * Fetch Edamam Recipe v2 Search
 */
async function searchEdamam({ appId, appKey, query, minKcal, maxKcal, minProtein, maxProtein, minCarbs, maxCarbs, minFat, maxFat, excludedList }) {
  if (!appId || !appKey) throw new Error('App ID o App Key de Edamam no configuradas');

  const englishQuery = translateText(query || '') || 'healthy recipe';
  const url = new URL('https://api.edamam.com/api/recipes/v2');
  url.searchParams.set('type', 'public');
  url.searchParams.set('app_id', appId);
  url.searchParams.set('app_key', appKey);
  url.searchParams.set('q', englishQuery);

  if (minKcal && maxKcal) {
    url.searchParams.set('calories', `${minKcal}-${maxKcal}`);
  } else if (maxKcal) {
    url.searchParams.set('calories', `${maxKcal}`);
  } else if (minKcal) {
    url.searchParams.set('calories', `${minKcal}+`);
  }

  const vetoKeywords = getExcludedKeywords(excludedList);
  for (const veto of vetoKeywords.slice(0, 10)) {
    url.searchParams.append('excluded', veto);
  }

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'FitController/1.8' }
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Error en Edamam API (${res.status}): ${errBody || res.statusText}`);
  }

  const data = await res.json();
  const hits = data.hits || [];

  const mapped = hits.map(hit => {
    const r = hit.recipe || {};
    const servings = r.yield && r.yield > 0 ? r.yield : 1;

    const totalNutrients = r.totalNutrients || {};
    const getNutrientPerServing = key => {
      if (totalNutrients[key] && totalNutrients[key].quantity) {
        return Math.round(totalNutrients[key].quantity / servings);
      }
      return 0;
    };

    const kcal = r.calories ? Math.round(r.calories / servings) : 0;
    const protein = getNutrientPerServing('PROCNT');
    const carbs = getNutrientPerServing('CHOCDF');
    const fat = getNutrientPerServing('FAT');
    const fiber = getNutrientPerServing('FIBTG');

    const ingredients = (r.ingredients || []).map(ing => ({
      name: ing.food || 'Ingrediente',
      amount: ing.quantity ? Math.round(ing.quantity / servings * 10) / 10 : 1,
      unit: ing.measure && ing.measure !== '<unit>' ? ing.measure : 'porción',
      original: ing.text || ing.food
    }));

    const instructions = Array.isArray(r.instructionLines) && r.instructionLines.length > 0
      ? r.instructionLines
      : ['Consultar la preparación detallada en la fuente original de la receta.'];

    let category = 'almuerzo';
    const mealTypes = (r.mealType || []).map(m => m.toLowerCase());
    if (mealTypes.some(m => m.includes('breakfast'))) category = 'desayuno';
    else if (mealTypes.some(m => m.includes('dinner'))) category = 'cena';
    else if (mealTypes.some(m => m.includes('snack') || m.includes('teatime'))) category = 'snack';

    const recipeUri = r.uri || '';
    const idMatch = recipeUri.match(/recipe_([a-zA-Z0-9]+)/);
    const recipeId = idMatch ? idMatch[1] : Math.random().toString(36).substring(2, 9);

    return {
      id: `edamam_${recipeId}`,
      external_id: recipeId,
      provider: 'edamam',
      title: r.label,
      description: `Receta de ${r.source || 'Edamam'} (${(r.cuisineType || ['Internacional']).join(', ')})`,
      category,
      prep_time_min: r.totalTime && r.totalTime > 0 ? r.totalTime : 30,
      servings: 1,
      kcal,
      protein,
      carbs,
      fat,
      fiber,
      ingredients,
      instructions,
      image_url: r.image || (r.images && r.images.REGULAR ? r.images.REGULAR.url : ''),
      source_url: r.url || '',
      is_external: true
    };
  });

  return mapped.filter(r => {
    if (minProtein && r.protein < minProtein) return false;
    if (maxProtein && r.protein > maxProtein) return false;
    if (minCarbs && r.carbs < minCarbs) return false;
    if (maxCarbs && r.carbs > maxCarbs) return false;
    if (minFat && r.fat < minFat) return false;
    if (maxFat && r.fat > maxFat) return false;
    return passesVetoFilter(r, vetoKeywords);
  });
}

/**
 * Unified search handler for external online recipe databases with pagination support
 */
async function searchOnlineRecipes({
  query = '',
  provider = 'all',
  minKcal,
  maxKcal,
  minProtein,
  maxProtein,
  minCarbs,
  maxCarbs,
  minFat,
  maxFat,
  excluded = '',
  page = 1,
  limit = 24
}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(8, Math.min(100, parseInt(limit, 10) || 24));
  const offset = (pageNum - 1) * pageSize;

  const settingsRows = db.prepare('SELECT key, value FROM api_settings').all();
  const settings = {};
  for (const row of settingsRows) {
    settings[row.key] = row.value;
  }

  const spoonKey = settings['spoonacular_api_key'] || '';
  const edamamAppId = settings['edamam_app_id'] || '';
  const edamamAppKey = settings['edamam_app_key'] || '';

  const defaultExcluded = settings['default_excluded'] || '';
  const combinedExcluded = [defaultExcluded, excluded].filter(Boolean).join(',');

  const searchParams = {
    query,
    minKcal: minKcal ? Number(minKcal) : undefined,
    maxKcal: maxKcal ? Number(maxKcal) : undefined,
    minProtein: minProtein ? Number(minProtein) : undefined,
    maxProtein: maxProtein ? Number(maxProtein) : undefined,
    minCarbs: minCarbs ? Number(minCarbs) : undefined,
    maxCarbs: maxCarbs ? Number(maxCarbs) : undefined,
    minFat: minFat ? Number(minFat) : undefined,
    maxFat: maxFat ? Number(maxFat) : undefined,
    excludedList: combinedExcluded,
    offset,
    number: pageSize
  };

  const results = [];
  const errors = [];

  const fetchSpoon = async () => {
    if (!spoonKey) {
      errors.push('Spoonacular: API key no configurada');
      return;
    }
    try {
      const spoonResults = await searchSpoonacular({ ...searchParams, apiKey: spoonKey });
      results.push(...spoonResults);
    } catch (e) {
      errors.push(`Spoonacular: ${e.message}`);
    }
  };

  const fetchEdam = async () => {
    if (!edamamAppId || !edamamAppKey) {
      errors.push('Edamam: App ID o App Key no configurada');
      return;
    }
    try {
      const edamamResults = await searchEdamam({ ...searchParams, appId: edamamAppId, appKey: edamamAppKey });
      results.push(...edamamResults);
    } catch (e) {
      errors.push(`Edamam: ${e.message}`);
    }
  };

  if (provider === 'spoonacular') {
    await fetchSpoon();
  } else if (provider === 'edamam') {
    await fetchEdam();
  } else {
    await Promise.allSettled([fetchSpoon(), fetchEdam()]);
  }

  return {
    recipes: results,
    errors: errors.length > 0 ? errors : undefined,
    count: results.length,
    page: pageNum,
    limit: pageSize,
    hasMore: results.length >= Math.min(12, Math.floor(pageSize / 2))
  };
}

/**
 * Search recipes from local DB with macro filtering
 */
function searchLocalRecipes({ query, category, maxKcal, minProtein, maxCarbs }) {
  let sql = `SELECT * FROM recipes WHERE 1=1`;
  const params = [];

  if (query) {
    sql += ` AND (title LIKE ? OR description LIKE ? OR ingredients_json LIKE ?)`;
    const q = `%${query}%`;
    params.push(q, q, q);
  }

  if (category && category !== 'all') {
    sql += ` AND category = ?`;
    params.push(category);
  }

  if (maxKcal) {
    sql += ` AND kcal <= ?`;
    params.push(parseInt(maxKcal, 10));
  }

  if (minProtein) {
    sql += ` AND protein >= ?`;
    params.push(parseInt(minProtein, 10));
  }

  if (maxCarbs) {
    sql += ` AND carbs <= ?`;
    params.push(parseInt(maxCarbs, 10));
  }

  sql += ` ORDER BY id DESC`;

  const rows = db.prepare(sql).all(...params);
  return rows.map(r => ({
    ...r,
    ingredients: JSON.parse(r.ingredients_json || '[]'),
    instructions: JSON.parse(r.instructions_json || '[]')
  }));
}

module.exports = {
  searchLocalRecipes,
  searchOnlineRecipes,
  getExcludedKeywords,
  passesVetoFilter,
  translateText
};
