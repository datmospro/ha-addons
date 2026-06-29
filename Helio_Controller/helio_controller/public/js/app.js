// Global App State
let currentCropId = null;
let currentCrop = null;
let fullSchedule = [];
let inventory = [];
let climateLogs = [];
let cropsList = [];
let activeSection = "sec-dashboard";
let vpdMode = 'auto';

// Helper: Format Dates
function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth()+1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth()+1)}`;
}

// Helper: Set Datetime-local inputs to local now
function setDatetimeInputNow(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now - tzOffset)).toISOString().slice(0, 16);
    input.value = localISOTime;
}

// Helper: Round values
const roundVal = (v, decimals = 2) => {
    if (v === null || v === undefined) return 0;
    return Number(Number(v).toFixed(decimals));
};

// Helper: Calculate Leaf VPD from Room Temp and RH
function calculateLeafVPD(roomTemp, relativeHumidity) {
    if (roomTemp === null || roomTemp === undefined || relativeHumidity === null || relativeHumidity === undefined) return null;
    const tRoom = parseFloat(roomTemp);
    const hum = parseFloat(relativeHumidity);
    if (isNaN(tRoom) || isNaN(hum)) return null;

    // SVP room in kPa
    const svpRoom = 0.61078 * Math.exp((17.27 * tRoom) / (tRoom + 237.3));
    // AVP air in kPa
    const avpAir = svpRoom * (hum / 100);
    // Leaf Temp (2.8°C cooler than room)
    const tLeaf = tRoom - 2.8;
    // SVP leaf in kPa
    const svpLeaf = 0.61078 * Math.exp((17.27 * tLeaf) / (tLeaf + 237.3));

    const vpd = svpLeaf - avpAir;
    return Math.max(0, Number(vpd.toFixed(2)));
}

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
    setupNavigation();
    setupCropManagement();
    setupWateringSection();
    setupClimateSection();
    setupInventorySection();
    setupModals();
    setupVpdWidget();
    
    // Initial fetch
    fetchCrops();
    fetchInventory();
});

// ==========================================
// NAVIGATION
// ==========================================
function setupNavigation() {
    const navButtons = document.querySelectorAll(".nav-btn, .sidebar-btn");
    navButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            const targetSec = btn.dataset.target;
            if (!targetSec) return;
            
            // Toggle active section
            document.querySelectorAll(".app-section").forEach(sec => {
                sec.classList.remove("active");
            });
            document.getElementById(targetSec).classList.add("active");
            activeSection = targetSec;
            
            // Toggle button states
            navButtons.forEach(b => {
                if (b.dataset.target === targetSec) {
                    b.classList.add("active");
                } else {
                    b.classList.remove("active");
                }
            });
            
            // Action trigger based on section
            if (targetSec === "sec-history") {
                renderCharts();
                renderCompletedWateringsTable();
            } else if (targetSec === "sec-inventory") {
                renderInventoryList();
            } else if (targetSec === "sec-climate") {
                renderClimateLogsTable();
            } else if (targetSec === "sec-waterings") {
                renderWateringsList();
            } else if (targetSec === "sec-dashboard") {
                updateDashboard();
            }
        });
    });
}

// ==========================================
// CROP CYCLES MANAGEMENT
// ==========================================
function setupCropManagement() {
    const selector = document.getElementById("crop-selector");
    const selectorDesktop = document.getElementById("crop-selector-desktop");
    
    const handleCropChange = (e) => {
        const val = e.target.value;
        currentCropId = val;
        if (selector) selector.value = val;
        if (selectorDesktop) selectorDesktop.value = val;
        if (currentCropId) {
            loadCropData(currentCropId);
        }
    };

    if (selector) selector.addEventListener("change", handleCropChange);
    if (selectorDesktop) selectorDesktop.addEventListener("change", handleCropChange);

    // Auto-fill template values
    const templateSelector = document.getElementById("crop-template");
    templateSelector.addEventListener("change", () => {
        const val = templateSelector.value;
        if (val) {
            const templateCrop = cropsList.find(c => c.id == val);
            if (templateCrop) {
                document.getElementById("crop-plants").value = templateCrop.num_plants;
                document.getElementById("crop-pot-size").value = templateCrop.pot_size_l;
                document.getElementById("crop-notes").value = `Copiado de la plantilla "${templateCrop.name}".`;
            }
        } else {
            // Reset to defaults
            document.getElementById("crop-plants").value = 84;
            document.getElementById("crop-pot-size").value = 11;
            document.getElementById("crop-notes").value = "";
        }
    });

    // New crop form submit
    const formNewCrop = document.getElementById("form-new-crop");
    formNewCrop.addEventListener("submit", async (e) => {
        e.preventDefault();
        const templateId = document.getElementById("crop-template").value;
        const body = {
            name: document.getElementById("crop-name").value,
            start_date: document.getElementById("crop-start-date").value,
            num_plants: parseInt(document.getElementById("crop-plants").value),
            pot_size_l: parseFloat(document.getElementById("crop-pot-size").value),
            notes: document.getElementById("crop-notes").value,
            template_crop_id: templateId ? parseInt(templateId) : null
        };

        try {
            const res = await fetch('/api/crops', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                closeAllModals();
                formNewCrop.reset();
                await fetchCrops(); // Refetches and sets active
            } else {
                const data = await res.json();
                alert("Error: " + data.error);
            }
        } catch (err) {
            console.error(err);
        }
    });

    // Quick plants edit button on dashboard
    document.getElementById("btn-quick-adjust-plants").addEventListener("click", () => {
        if (!currentCrop) return;
        const newPlants = prompt(`Modificar número de plantas para este riego y los siguientes: \n(Actualmente hay ${currentCrop.num_plants} plantas)`, currentCrop.num_plants);
        if (newPlants !== null) {
            const count = parseInt(newPlants);
            if (isNaN(count) || count < 1) {
                alert("Introduce un número entero válido.");
                return;
            }
            updateCropPlantsCount(count);
        }
    });

    // Edit crop modal submission
    const formEditCrop = document.getElementById("form-edit-crop");
    formEditCrop.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = {
            name: document.getElementById("edit-crop-name").value,
            start_date: document.getElementById("edit-crop-start-date").value,
            num_plants: parseInt(document.getElementById("edit-crop-plants").value),
            pot_size_l: parseFloat(document.getElementById("edit-crop-pot-size").value),
            notes: document.getElementById("edit-crop-notes").value
        };

        try {
            const res = await fetch(`/api/crops/${currentCropId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                closeAllModals();
                loadCropData(currentCropId);
                fetchCropsDropdownOnly();
            } else {
                const data = await res.json();
                alert("Error al actualizar: " + data.error);
            }
        } catch (err) {
            console.error(err);
        }
    });

    // Trigger edit crop modal
    document.getElementById("btn-edit-crop").addEventListener("click", () => {
        if (!currentCrop) return;
        document.getElementById("edit-crop-name").value = currentCrop.name;
        document.getElementById("edit-crop-start-date").value = currentCrop.start_date;
        document.getElementById("edit-crop-plants").value = currentCrop.num_plants;
        document.getElementById("edit-crop-pot-size").value = currentCrop.pot_size_l;
        document.getElementById("edit-crop-notes").value = currentCrop.notes || "";
        openModal("modal-edit-crop");
    });
}

async function fetchCrops() {
    try {
        const res = await fetch('/api/crops');
        const data = await res.json();
        cropsList = data;
        populateCropsDropdown(data);
        
        // Find active crop or select first one
        if (data.length > 0) {
            const active = data.find(c => c.status === 'active') || data[0];
            currentCropId = active.id;
            const sel = document.getElementById("crop-selector");
            const selD = document.getElementById("crop-selector-desktop");
            if (sel) sel.value = currentCropId;
            if (selD) selD.value = currentCropId;
            await loadCropData(currentCropId);
        }
    } catch (err) {
        console.error("Error fetching crops:", err);
    }
}

async function fetchCropsDropdownOnly() {
    try {
        const res = await fetch('/api/crops');
        const data = await res.json();
        cropsList = data;
        populateCropsDropdown(data);
        const sel = document.getElementById("crop-selector");
        const selD = document.getElementById("crop-selector-desktop");
        if (sel) sel.value = currentCropId;
        if (selD) selD.value = currentCropId;
    } catch (err) {
        console.error("Error updating crops dropdown:", err);
    }
}

function populateCropsDropdown(crops) {
    const selector = document.getElementById("crop-selector");
    const selectorDesktop = document.getElementById("crop-selector-desktop");
    
    if (selector) {
        selector.innerHTML = "";
        crops.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c.id;
            opt.textContent = `${c.name} (${c.status === 'active' ? 'Activo' : 'Archivado'})`;
            selector.appendChild(opt);
        });
    }

    if (selectorDesktop) {
        selectorDesktop.innerHTML = "";
        crops.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c.id;
            opt.textContent = `${c.name} (${c.status === 'active' ? 'Activo' : 'Archivado'})`;
            selectorDesktop.appendChild(opt);
        });
    }
}

async function loadCropData(id) {
    try {
        const res = await fetch(`/api/crops/${id}/schedule`);
        const data = await res.json();
        currentCrop = data.crop;
        fullSchedule = data.schedule;
        
        // Fetch climate logs
        const climRes = await fetch(`/api/crops/${id}/climate`);
        climateLogs = await climRes.json();
        
        updateDashboard();
        
        // Populate Riego Cercano in Climate Log Form
        populateClimateRiegoSelect();
        
        if (activeSection === "sec-waterings") renderWateringsList();
        if (activeSection === "sec-climate") renderClimateLogsTable();
        if (activeSection === "sec-history") {
            renderCharts();
            renderCompletedWateringsTable();
        }
    } catch (err) {
        console.error("Error loading crop details:", err);
    }
}

async function updateCropPlantsCount(count) {
    try {
        const res = await fetch(`/api/crops/${currentCropId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ num_plants: count })
        });
        if (res.ok) {
            await loadCropData(currentCropId);
        }
    } catch (err) {
        console.error(err);
    }
}

// ==========================================
// DASHBOARD VIEW
// ==========================================
function updateDashboard() {
    if (!currentCrop) return;
    
    // Set Title & Badge
    document.getElementById("dash-crop-name").textContent = currentCrop.name;
    document.getElementById("dash-crop-dates").textContent = `Iniciado el ${formatDateShort(currentCrop.start_date)} ${currentCrop.end_date ? ' - Fin: ' + formatDateShort(currentCrop.end_date) : ''}`;
    
    const badge = document.getElementById("crop-badge");
    badge.className = "badge";
    if (currentCrop.status === 'active') {
        badge.classList.add("badge-growth");
        badge.textContent = "Activo";
    } else {
        badge.classList.add("badge-outline");
        badge.textContent = "Archivado";
    }
    
    // Stats Columns
    document.getElementById("dash-plants-count").textContent = currentCrop.num_plants;
    document.getElementById("dash-pot-size").textContent = `${currentCrop.pot_size_l} L`;
    
    // Crop Days & Progress
    const startDate = new Date(currentCrop.start_date);
    const today = new Date();
    const diffTime = Math.abs(today - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    document.getElementById("dash-crop-days").textContent = `Día ${diffDays}`;
    
    // Progress % calculation. Total cycle = 2 weeks growth + 8 weeks flowering = 70 days.
    const maxDays = 70;
    const progressPct = Math.min(100, Math.max(0, Math.round((diffDays / maxDays) * 100)));
    document.getElementById("dash-progress-bar").style.width = `${progressPct}%`;
    document.getElementById("dash-progress-pct").textContent = `Progreso Ciclo: ${progressPct}% (${diffDays} / ${maxDays} Días)`;
    
    // Next Watering Card
    const nextWatering = fullSchedule.find(s => !s.completed);
    const nextCard = document.getElementById("card-next-watering");
    
    if (nextWatering) {
        nextCard.style.display = "block";
        document.getElementById("next-riego-badge").textContent = `Riego ${nextWatering.riego_num.toFixed(1)}`;
        document.getElementById("next-water-qty").textContent = nextWatering.target_water_l;
        document.getElementById("next-riego-type").innerHTML = `<i class="fa-solid ${nextWatering.type === 'Mant.' ? 'fa-stethoscope' : 'fa-circle-nodes'}"></i> ${nextWatering.type}`;
        document.getElementById("next-riego-phase").innerHTML = `<i class="fa-solid fa-clock"></i> ${nextWatering.phase} - Sem. ${nextWatering.week}`;
        
        // Populate recipe
        const recipeList = document.getElementById("next-watering-recipe");
        recipeList.innerHTML = "";
        let hasNutrients = false;
        
        const nutrientsNames = {
            silica_power: "Silica Power (BAC)",
            calmag: "Calmag (Atami)",
            jj_micro: "JJ Micro (Base)",
            jj_grow: "JJ Grow (Base)",
            jj_bloom: "JJ Bloom (Base)",
            voodoo_juice: "Voodoo Juice",
            bud_candy: "Bud Candy",
            big_bud: "Big Bud Liquid",
            monster_bloom: "Monster Bloom (Grotek)",
            bac_f1: "BAC F1 Booster",
            enzymes: "Enzimas",
            flawless_finish: "Flawless Finish"
        };
        
        for (const [key, val] of Object.entries(nextWatering.target_products)) {
            if (val > 0) {
                hasNutrients = true;
                const li = document.createElement("li");
                const isGram = key === "monster_bloom" || key === "bac_f1";
                li.innerHTML = `<span class="name">${nutrientsNames[key]}</span> <span class="val">${val} ${isGram ? 'g' : 'ml'}</span>`;
                recipeList.appendChild(li);
            }
        }
        
        if (!hasNutrients) {
            const li = document.createElement("li");
            li.innerHTML = `<span class="name">Solo agua limpia sin aditivos</span> <span class="val">0 ml</span>`;
            recipeList.appendChild(li);
        }
        
        // Link watering log button to this riego_num
        const logBtn = document.getElementById("btn-quick-log-watering");
        logBtn.onclick = () => openLogWateringModal(nextWatering.riego_num);
        
        // Update Climate Targets
        if (nextWatering.climate_targets) {
            const ct = nextWatering.climate_targets;
            document.getElementById("clim-target-led").textContent = `${Math.round(ct.led_power * 100)}%`;
            document.getElementById("clim-target-dist").textContent = `${ct.light_distance} cm`;
            document.getElementById("clim-target-temp").textContent = `${ct.temp_day} / ${ct.temp_night} °C`;
            document.getElementById("clim-target-hum").textContent = `${ct.humidity}%`;
            document.getElementById("clim-target-ext").textContent = `${Math.round(ct.extractor * 100)}%`;
            document.getElementById("clim-target-vpd").textContent = `VPD: ${ct.vpd} kPa`;
            
            const banner = document.getElementById("poda-banner");
            if (ct.poda_info) {
                banner.style.display = "flex";
                document.getElementById("clim-target-poda").textContent = ct.poda_info;
            } else {
                banner.style.display = "none";
            }
        }
        
    } else {
        // No more waterings pending
        nextCard.style.display = "none";
        document.getElementById("clim-target-led").textContent = "0%";
        document.getElementById("clim-target-dist").textContent = "--";
        document.getElementById("clim-target-temp").textContent = "-- / -- °C";
        document.getElementById("clim-target-hum").textContent = "--%";
        document.getElementById("clim-target-ext").textContent = "0%";
        document.getElementById("clim-target-vpd").textContent = "VPD: -- kPa";
        document.getElementById("poda-banner").style.display = "none";
    }
    
    // Update VPD widget display
    updateDashboardVPD();

    // Costspent calculation
    updateFinancialSummary();
}

function updateFinancialSummary() {
    // Calculates actual costs based on raw ml used in all completed waterings
    let totalCostUsed = 0;
    
    const nutrientPricesPerMl = {};
    inventory.forEach(item => {
        if (item.price > 0 && item.format_volume_ml > 0) {
            nutrientPricesPerMl[item.name] = item.price / item.format_volume_ml;
        } else {
            nutrientPricesPerMl[item.name] = 0;
        }
    });

    const completed = fullSchedule.filter(s => s.completed);
    completed.forEach(cw => {
        const d = cw.completed_data;
        
        totalCostUsed += (d.silica_power || 0) * (nutrientPricesPerMl["Silica Power (BAC)"] || 0);
        totalCostUsed += (d.calmag || 0) * (nutrientPricesPerMl["Calmag (Atami)"] || 0);
        totalCostUsed += (d.jj_micro || 0) * (nutrientPricesPerMl["Jungle Juice Micro"] || 0);
        totalCostUsed += (d.jj_grow || 0) * (nutrientPricesPerMl["Jungle Juice Grow"] || 0);
        totalCostUsed += (d.jj_bloom || 0) * (nutrientPricesPerMl["Jungle Juice Bloom"] || 0);
        totalCostUsed += (d.voodoo_juice || 0) * (nutrientPricesPerMl["Voodoo Juice"] || 0);
        totalCostUsed += (d.bud_candy || 0) * (nutrientPricesPerMl["Bud Candy"] || 0);
        totalCostUsed += (d.big_bud || 0) * (nutrientPricesPerMl["Big Bud Liquid"] || 0);
        totalCostUsed += (d.monster_bloom || 0) * (nutrientPricesPerMl["Monster Bloom (Grotek)"] || 0);
        totalCostUsed += (d.bac_f1 || 0) * (nutrientPricesPerMl["BAC F1 Extreme Booster"] || 0);
        totalCostUsed += (d.flawless_finish || 0) * (nutrientPricesPerMl["Flawless Finish"] || 0);
        
        // Enzimas handles Atazyme / Sensizym
        const enzymesVol = d.enzymes || 0;
        if (enzymesVol > 0) {
            // Assume we consumed Atazyme up to 200ml total. Let's simplify by using Atazyme cost if stock > 0, otherwise Sensizym.
            // For dashboard simplicity, we can do a weighted cost or just use Sensizym's price
            totalCostUsed += enzymesVol * (nutrientPricesPerMl["Sensizym (Advanced Nutrients)"] || 0);
        }
    });

    document.getElementById("dash-cost-spent").textContent = `${totalCostUsed.toFixed(2)} €`;
    
    // Total basket value of complete purchased bottles
    let totalBasket = 0;
    inventory.forEach(item => {
        totalBasket += item.price * item.purchased_qty;
    });
    document.getElementById("dash-cost-budget").textContent = `${totalBasket.toFixed(2)} €`;
    
    // Low stock alerts
    const alertsBox = document.getElementById("dash-stock-alerts");
    alertsBox.innerHTML = "";
    let lowStockCount = 0;
    
    inventory.forEach(item => {
        // Warning if remaining stock is less than 15% of the purchase volume
        const limit = item.format_volume_ml * 0.15;
        if (item.stock_ml < limit && item.price > 0) {
            lowStockCount++;
            const isGram = item.name.includes("Monster") || item.name.includes("BAC");
            const div = document.createElement("div");
            div.className = "stock-alert-item";
            div.innerHTML = `<span><i class="fa-solid fa-triangle-exclamation"></i> ${item.name}</span> <span>Stock: ${Math.round(item.stock_ml)} ${isGram ? 'g' : 'ml'}</span>`;
            alertsBox.appendChild(div);
        }
    });
    
    if (lowStockCount === 0) {
        alertsBox.innerHTML = '<p class="muted-text">Todos los productos en stock adecuado.</p>';
    }
}

// ==========================================
// WATERINGS (RIEGOS PLAN) VIEW
// ==========================================
let wateringFilter = "all";

function setupWateringSection() {
    const tabs = document.querySelectorAll(".filter-tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            wateringFilter = tab.dataset.filter;
            renderWateringsList();
        });
    });

    // Logging watering submission
    const formWater = document.getElementById("form-log-watering");
    formWater.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = document.getElementById("log-water-riego-num").value;
        const riegoNum = parseFloat(id);
        
        const body = {
            riego_num: riegoNum,
            date: document.getElementById("log-water-date").value,
            plants_count: parseInt(document.getElementById("log-water-plants").value),
            water_liters: parseFloat(document.getElementById("log-water-liters").value),
            ph: parseFloat(document.getElementById("log-water-ph").value) || null,
            ec: parseFloat(document.getElementById("log-water-ec").value) || null,
            notes: document.getElementById("log-water-notes").value,
            
            silica_power: parseFloat(document.getElementById("log-nut-silica").value) || 0,
            calmag: parseFloat(document.getElementById("log-nut-calmag").value) || 0,
            jj_micro: parseFloat(document.getElementById("log-nut-micro").value) || 0,
            jj_grow: parseFloat(document.getElementById("log-nut-grow").value) || 0,
            jj_bloom: parseFloat(document.getElementById("log-nut-bloom").value) || 0,
            voodoo_juice: parseFloat(document.getElementById("log-nut-voodoo").value) || 0,
            bud_candy: parseFloat(document.getElementById("log-nut-candy").value) || 0,
            big_bud: parseFloat(document.getElementById("log-nut-bigbud").value) || 0,
            monster_bloom: parseFloat(document.getElementById("log-nut-monster").value) || 0,
            bac_f1: parseFloat(document.getElementById("log-nut-bac").value) || 0,
            enzymes: parseFloat(document.getElementById("log-nut-enzymes").value) || 0,
            flawless_finish: parseFloat(document.getElementById("log-nut-flawless").value) || 0
        };

        const existingRecord = fullSchedule.find(s => s.riego_num === riegoNum && s.completed);

        try {
            let res;
            if (existingRecord) {
                // PUT method to edit
                res = await fetch(`/api/crops/${currentCropId}/waterings/${existingRecord.completed_data.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
            } else {
                // POST method to create
                res = await fetch(`/api/crops/${currentCropId}/waterings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
            }

            if (res.ok) {
                closeAllModals();
                await fetchInventory(); // Refresh stock
                await loadCropData(currentCropId);
            } else {
                const data = await res.json();
                alert("Error al registrar: " + data.error);
            }
        } catch (err) {
            console.error(err);
        }
    });

    // Listen to changes on nutrient inputs to update highlights
    document.querySelectorAll('.nut-input-group input[type="number"]').forEach(input => {
        input.addEventListener('input', () => {
            updateNutrientHighlight(input);
        });
    });

    // Handle check button clicks for pouring fertilizers
    document.querySelectorAll('.btn-check-pour').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const group = btn.closest('.nut-input-group');
            if (group) {
                group.classList.toggle('added-to-mix');
                const isChecked = group.classList.contains('added-to-mix');
                const icon = btn.querySelector('i');
                if (icon) {
                    icon.className = isChecked ? 'fa-solid fa-square-check' : 'fa-regular fa-square';
                }
            }
        });
    });
}

function renderWateringsList() {
    const list = document.getElementById("watering-list");
    list.innerHTML = "";
    
    let filtered = [...fullSchedule];
    if (wateringFilter === "Crecimiento" || wateringFilter === "Floración") {
        filtered = filtered.filter(s => s.phase === wateringFilter);
    } else if (wateringFilter === "pending") {
        filtered = filtered.filter(s => !s.completed);
    }

    filtered.forEach(item => {
        const div = document.createElement("div");
        div.className = `watering-item ${item.completed ? 'completed' : 'pending'}`;
        div.onclick = () => openLogWateringModal(item.riego_num);
        
        let subText = `${item.phase} - Sem. ${item.week} (${item.type})`;
        if (item.completed) {
            subText += ` | Aplicado: ${formatDateShort(item.completed_data.date)}`;
        }
        
        let rightPill = "";
        if (item.completed && (item.completed_data.ph || item.completed_data.ec)) {
            const ph = item.completed_data.ph ? `pH: ${item.completed_data.ph}` : '';
            const ec = item.completed_data.ec ? `EC: ${item.completed_data.ec}` : '';
            rightPill = `<span class="ph-ec-pill">${[ph, ec].filter(Boolean).join(' | ')}</span>`;
        }

        const waterVol = item.completed ? item.completed_data.water_liters : item.target_water_l;

        div.innerHTML = `
            <div class="w-left">
                <div class="w-num-circle">${item.riego_num.toFixed(1)}</div>
                <div class="w-info">
                    <span class="w-title">Riego ${item.riego_num.toFixed(1)}</span>
                    <span class="w-sub">${subText}</span>
                </div>
            </div>
            <div class="w-right">
                ${rightPill}
                <span class="water-vol">${waterVol} L</span>
                <span class="w-status-icon ${item.completed ? 'done' : 'todo'}">
                    <i class="fa-solid ${item.completed ? 'fa-circle-check done' : 'fa-circle todo'}"></i>
                </span>
            </div>
        `;
        
        list.appendChild(div);
    });
    
    if (filtered.length === 0) {
        list.innerHTML = '<p class="muted-text text-center" style="padding: 2rem;">No hay riegos en esta categoría.</p>';
    }
}

function updateNutrientHighlight(inputEl) {
    const group = inputEl.closest('.nut-input-group');
    if (!group) return;
    const val = parseFloat(inputEl.value) || 0;
    if (val > 0) {
        group.classList.add('has-value');
    } else {
        group.classList.remove('has-value');
    }
}

function openLogWateringModal(riegoNum) {
    if (!currentCrop) return;
    
    const item = fullSchedule.find(s => s.riego_num === riegoNum);
    if (!item) return;

    // Reset check states and highlights
    document.querySelectorAll('.nut-input-group').forEach(group => {
        group.classList.remove('added-to-mix');
        group.classList.remove('has-value');
        const icon = group.querySelector('.btn-check-pour i');
        if (icon) {
            icon.className = 'fa-regular fa-square';
        }
    });

    document.getElementById("log-water-title-num").textContent = riegoNum.toFixed(1);
    document.getElementById("log-water-riego-num").value = riegoNum;
    
    // Set Target labels inside form
    const roundStr = (v, isGram = false) => `Objetivo: ${v || 0} ${isGram ? 'g' : 'ml'}`;
    document.getElementById("target-nut-silica").textContent = roundStr(item.target_products.silica_power);
    document.getElementById("target-nut-calmag").textContent = roundStr(item.target_products.calmag);
    document.getElementById("target-nut-micro").textContent = roundStr(item.target_products.jj_micro);
    document.getElementById("target-nut-grow").textContent = roundStr(item.target_products.jj_grow);
    document.getElementById("target-nut-bloom").textContent = roundStr(item.target_products.jj_bloom);
    document.getElementById("target-nut-voodoo").textContent = roundStr(item.target_products.voodoo_juice);
    document.getElementById("target-nut-candy").textContent = roundStr(item.target_products.bud_candy);
    document.getElementById("target-nut-bigbud").textContent = roundStr(item.target_products.big_bud);
    document.getElementById("target-nut-monster").textContent = roundStr(item.target_products.monster_bloom, true);
    document.getElementById("target-nut-bac").textContent = roundStr(item.target_products.bac_f1, true);
    document.getElementById("target-nut-enzymes").textContent = roundStr(item.target_products.enzymes);
    document.getElementById("target-nut-flawless").textContent = roundStr(item.target_products.flawless_finish);

    if (item.completed) {
        // Pre-fill with actual recorded data
        const cd = item.completed_data;
        document.getElementById("log-water-date").value = cd.date;
        document.getElementById("log-water-plants").value = cd.plants_count;
        document.getElementById("log-water-liters").value = cd.water_liters;
        document.getElementById("log-water-ph").value = cd.ph || "";
        document.getElementById("log-water-ec").value = cd.ec || "";
        document.getElementById("log-water-notes").value = cd.notes || "";
        
        document.getElementById("log-nut-silica").value = cd.silica_power;
        document.getElementById("log-nut-calmag").value = cd.calmag;
        document.getElementById("log-nut-micro").value = cd.jj_micro;
        document.getElementById("log-nut-grow").value = cd.jj_grow;
        document.getElementById("log-nut-bloom").value = cd.jj_bloom;
        document.getElementById("log-nut-voodoo").value = cd.voodoo_juice;
        document.getElementById("log-nut-candy").value = cd.bud_candy;
        document.getElementById("log-nut-bigbud").value = cd.big_bud;
        document.getElementById("log-nut-monster").value = cd.monster_bloom;
        document.getElementById("log-nut-bac").value = cd.bac_f1;
        document.getElementById("log-nut-enzymes").value = cd.enzymes;
        document.getElementById("log-nut-flawless").value = cd.flawless_finish;
    } else {
        // Pre-fill with target values
        setDatetimeInputNow("log-water-date");
        document.getElementById("log-water-plants").value = currentCrop.num_plants;
        document.getElementById("log-water-liters").value = item.target_water_l;
        document.getElementById("log-water-ph").value = "";
        document.getElementById("log-water-ec").value = "";
        document.getElementById("log-water-notes").value = "";
        
        document.getElementById("log-nut-silica").value = item.target_products.silica_power;
        document.getElementById("log-nut-calmag").value = item.target_products.calmag;
        document.getElementById("log-nut-micro").value = item.target_products.jj_micro;
        document.getElementById("log-nut-grow").value = item.target_products.jj_grow;
        document.getElementById("log-nut-bloom").value = item.target_products.jj_bloom;
        document.getElementById("log-nut-voodoo").value = item.target_products.voodoo_juice;
        document.getElementById("log-nut-candy").value = item.target_products.bud_candy;
        document.getElementById("log-nut-bigbud").value = item.target_products.big_bud;
        document.getElementById("log-nut-monster").value = item.target_products.monster_bloom;
        document.getElementById("log-nut-bac").value = item.target_products.bac_f1;
        document.getElementById("log-nut-enzymes").value = item.target_products.enzymes;
        document.getElementById("log-nut-flawless").value = item.target_products.flawless_finish;
    }

    // Set highlights for non-zero fields
    document.querySelectorAll('.nut-input-group input[type="number"]').forEach(input => {
        updateNutrientHighlight(input);
    });

    openModal("modal-log-watering");
}

// ==========================================
// CLIMATE MONITORING VIEW
// ==========================================
function setupClimateSection() {
    const form = document.getElementById("form-climate");
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const body = {
            date: document.getElementById("clim-in-date").value,
            riego_num: parseFloat(document.getElementById("clim-in-riego").value) || null,
            plant_height: parseFloat(document.getElementById("clim-in-height").value) || null,
            led_power: parseFloat(document.getElementById("clim-in-led").value) || null,
            light_distance: parseInt(document.getElementById("clim-in-distance").value) || null,
            temp_day: parseFloat(document.getElementById("clim-in-temp-d").value) || null,
            temp_night: parseFloat(document.getElementById("clim-in-temp-n").value) || null,
            humidity: parseInt(document.getElementById("clim-in-hum").value) || null,
            vpd: parseFloat(document.getElementById("clim-in-vpd").value) || null,
            extractor: parseFloat(document.getElementById("clim-in-ext").value) / 100 || null,
            poda_done: document.getElementById("clim-in-poda").checked ? 1 : 0,
            notes: document.getElementById("clim-in-notes").value
        };

        try {
            const res = await fetch(`/api/crops/${currentCropId}/climate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                form.reset();
                setDatetimeInputNow("clim-in-date");
                await loadCropData(currentCropId);
            } else {
                const data = await res.json();
                alert("Error al guardar clima: " + data.error);
            }
        } catch (err) {
            console.error(err);
        }
    });

    // Auto-calculate VPD on input
    const tempInput = document.getElementById("clim-in-temp-d");
    const humInput = document.getElementById("clim-in-hum");
    const vpdInput = document.getElementById("clim-in-vpd");
    
    function autoCalcVpd() {
        const t = parseFloat(tempInput.value);
        const h = parseFloat(humInput.value);
        if (!isNaN(t) && !isNaN(h)) {
            const calculated = calculateLeafVPD(t, h);
            if (calculated !== null) {
                vpdInput.value = calculated;
            }
        }
    }
    
    tempInput.addEventListener("input", autoCalcVpd);
    humInput.addEventListener("input", autoCalcVpd);

    document.getElementById("btn-quick-log-climate").addEventListener("click", () => {
        // Switch view to climate
        const climBtn = document.querySelector('[data-target="sec-climate"]');
        if (climBtn) climBtn.click();
    });
}

function populateClimateRiegoSelect() {
    const select = document.getElementById("clim-in-riego");
    select.innerHTML = '<option value="">-- Ninguno --</option>';
    fullSchedule.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.riego_num;
        opt.textContent = `Riego ${s.riego_num.toFixed(1)} (${s.phase})`;
        select.appendChild(opt);
    });

    // Auto-select next pending riego index
    const next = fullSchedule.find(s => !s.completed);
    if (next) {
        select.value = next.riego_num;
    }
}

function renderClimateLogsTable() {
    const tbody = document.querySelector("#table-climate-logs tbody");
    tbody.innerHTML = "";
    
    climateLogs.forEach(log => {
        const tr = document.createElement("tr");
        const rNum = log.riego_num ? `Riego ${log.riego_num.toFixed(1)}` : '-';
        const tDay = log.temp_day ? `${log.temp_day}°C` : '-';
        const tNight = log.temp_night ? `${log.temp_night}°C` : '-';
        const temp = `${tDay} / ${tNight}`;
        const hum = log.humidity ? `${log.humidity}%` : '-';
        let vpdVal = log.vpd;
        if (vpdVal === null && log.temp_day !== null && log.humidity !== null) {
            vpdVal = calculateLeafVPD(log.temp_day, log.humidity);
        }
        const vpd = vpdVal !== null ? `${vpdVal.toFixed(2)} kPa` : '-';

        tr.innerHTML = `
            <td>${formatDateShort(log.date)}</td>
            <td>${rNum}</td>
            <td>${temp}</td>
            <td>${hum}</td>
            <td>${vpd}</td>
            <td>
                <button class="btn-icon" style="color: var(--red);" onclick="deleteClimateLog(${log.id})" title="Eliminar Medición">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (climateLogs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center muted-text" style="padding: 1.5rem;">No hay mediciones registradas.</td></tr>';
    }
}

async function deleteClimateLog(logId) {
    if (!confirm("¿Seguro que deseas eliminar esta medición de clima?")) return;
    try {
        const res = await fetch(`/api/crops/${currentCropId}/climate/${logId}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            await loadCropData(currentCropId);
        }
    } catch (err) {
        console.error(err);
    }
}

// ==========================================
// INVENTORY & SHOPPING LIST
// ==========================================
async function fetchInventory() {
    try {
        const res = await fetch('/api/inventory');
        inventory = await res.json();
        if (activeSection === "sec-inventory") renderInventoryList();
        updateFinancialSummary();
    } catch (err) {
        console.error("Error fetching inventory:", err);
    }
}

function setupInventorySection() {
    // Edit inventory item submission
    const formEditInv = document.getElementById("form-edit-inventory");
    formEditInv.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = document.getElementById("edit-inv-id").value;
        const body = {
            price: parseFloat(document.getElementById("edit-inv-price").value),
            format_volume_ml: parseFloat(document.getElementById("edit-inv-format").value),
            purchased_qty: parseFloat(document.getElementById("edit-inv-qty").value),
            stock_ml: parseFloat(document.getElementById("edit-inv-stock").value)
        };

        try {
            const res = await fetch(`/api/inventory/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                closeAllModals();
                await fetchInventory();
                if (currentCropId) await loadCropData(currentCropId);
            } else {
                const data = await res.json();
                alert("Error al actualizar inventario: " + data.error);
            }
        } catch (err) {
            console.error(err);
        }
    });

    // Custom add product
    document.getElementById("btn-add-product").onclick = () => {
        const name = prompt("Nombre del producto nuevo:");
        if (name) {
            addNewProduct(name);
        }
    };
}

async function addNewProduct(name) {
    try {
        const res = await fetch('/api/inventory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, price: 0.0, format_volume_ml: 1000, purchased_qty: 0, stock_ml: 0 })
        });
        if (res.ok) {
            await fetchInventory();
        }
    } catch (err) {
        console.error(err);
    }
}

function renderInventoryList() {
    const tbody = document.getElementById("inventory-list");
    tbody.innerHTML = "";

    inventory.forEach(item => {
        const tr = document.createElement("tr");
        const isGram = item.name.includes("Monster") || item.name.includes("BAC");
        const formatUnit = isGram ? 'g' : 'ml';
        
        let stockDisplay = `${Math.round(item.stock_ml)} ${formatUnit}`;
        if (item.stock_ml < item.format_volume_ml * 0.15 && item.price > 0) {
            stockDisplay = `<span style="color: var(--red); font-weight: 600;"><i class="fa-solid fa-triangle-exclamation"></i> ${stockDisplay}</span>`;
        }

        tr.innerHTML = `
            <td><strong>${item.name}</strong></td>
            <td>${item.format_volume_ml} ${formatUnit}</td>
            <td>${item.price.toFixed(2)} €</td>
            <td>${stockDisplay}</td>
            <td>${item.purchased_qty} botellas</td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="openEditInventoryModal(${item.id})">
                    <i class="fa-solid fa-pen-to-square"></i> <span class="hide-mobile">Editar</span>
                </button>
                <button class="btn btn-outline btn-sm" style="color: var(--red); border-color: rgba(239, 68, 68, 0.2);" onclick="deleteInventoryItem(${item.id})">
                    <i class="fa-solid fa-trash"></i> <span class="hide-mobile">Eliminar</span>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openEditInventoryModal(itemId) {
    const item = inventory.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById("edit-inv-title").textContent = item.name;
    document.getElementById("edit-inv-id").value = item.id;
    document.getElementById("edit-inv-price").value = item.price;
    document.getElementById("edit-inv-format").value = item.format_volume_ml;
    document.getElementById("edit-inv-qty").value = item.purchased_qty;
    document.getElementById("edit-inv-stock").value = item.stock_ml;

    openModal("modal-edit-inventory");
}

async function deleteInventoryItem(itemId) {
    if (!confirm("¿Seguro que deseas eliminar este producto del inventario?")) return;
    try {
        const res = await fetch(`/api/inventory/${itemId}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            await fetchInventory();
        } else {
            const data = await res.json();
            alert("Error al eliminar: " + data.error);
        }
    } catch (err) {
        console.error(err);
    }
}

// ==========================================
// HISTORICAL TABLE VIEW
// ==========================================
function renderCompletedWateringsTable() {
    const tbody = document.querySelector("#table-completed-waterings tbody");
    tbody.innerHTML = "";
    
    const completed = fullSchedule.filter(s => s.completed);
    
    completed.forEach(cw => {
        const tr = document.createElement("tr");
        const d = cw.completed_data;

        tr.innerHTML = `
            <td><strong>Riego ${cw.riego_num.toFixed(1)}</strong></td>
            <td>${formatDate(d.date)}</td>
            <td>${d.water_liters} L</td>
            <td>${d.plants_count} plantas</td>
            <td>${d.ph || '-'}</td>
            <td>${d.ec ? d.ec + ' EC' : '-'}</td>
            <td class="table-notes">${d.notes || '-'}</td>
            <td>
                <div style="display:flex; gap: 0.35rem;">
                    <button class="btn btn-outline btn-sm" onclick="openLogWateringModal(${cw.riego_num})" title="Editar Riego">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn btn-outline btn-sm" style="color: var(--red); border-color: rgba(239, 68, 68, 0.2);" onclick="deleteWateringLog(${d.id})" title="Eliminar Riego">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (completed.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center muted-text" style="padding: 2rem;">Aún no se ha completado ningún riego en este ciclo.</td></tr>';
    }
}

async function deleteWateringLog(logId) {
    if (!confirm("¿Seguro que deseas eliminar este registro de riego? Se restablecerá el stock de fertilizantes correspondiente.")) return;
    try {
        const res = await fetch(`/api/crops/${currentCropId}/waterings/${logId}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            await fetchInventory();
            await loadCropData(currentCropId);
        }
    } catch (err) {
        console.error(err);
    }
}

// ==========================================
// CHARTS (HTML5 CANVAS DRAWING)
// ==========================================
function renderCharts() {
    const completedWaterings = fullSchedule.filter(s => s.completed).map(cw => cw.completed_data);
    
    // Sort chronological
    completedWaterings.sort((a,b) => new Date(a.date) - new Date(b.date));
    
    // 1. pH & EC Chart
    drawPHECChart(completedWaterings);
    
    // 2. Temp & Humidity Chart
    const sortedClimateLogs = [...climateLogs].reverse();
    drawTempHumChart(sortedClimateLogs);
}

function drawPHECChart(data) {
    const canvas = document.getElementById("chart-ph-ec");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const w = rect.width;
    const h = rect.height;
    
    // Clear and background
    ctx.clearRect(0,0,w,h);
    
    // Filter data with ph and ec
    const phPoints = data.filter(d => d.ph !== null);
    const ecPoints = data.filter(d => d.ec !== null);
    
    if (phPoints.length === 0 && ecPoints.length === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "12px Inter";
        ctx.textAlign = "center";
        ctx.fillText("Registra riegos con pH y EC para ver el gráfico", w/2, h/2);
        return;
    }
    
    const margin = { top: 20, right: 40, bottom: 30, left: 40 };
    const chartW = w - margin.left - margin.right;
    const chartH = h - margin.top - margin.bottom;
    
    // Draw Grid Lines (4 horizontal)
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = margin.top + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(w - margin.right, y);
        ctx.stroke();
    }
    
    // Limits
    const phMin = 5.5, phMax = 7.0;
    const ecMin = 0.0, ecMax = 2.5;
    
    // Draw Y Axis Labels (Left: pH)
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "10px Inter";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 3; i++) {
        const val = phMax - ((phMax - phMin) / 3) * i;
        const y = margin.top + (chartH / 3) * i;
        ctx.fillText(val.toFixed(1), margin.left - 8, y);
    }
    
    // Draw Y Axis Labels (Right: EC)
    ctx.textAlign = "left";
    for (let i = 0; i <= 3; i++) {
        const val = ecMax - ((ecMax - ecMin) / 3) * i;
        const y = margin.top + (chartH / 3) * i;
        ctx.fillText(val.toFixed(1) + ' EC', w - margin.right + 8, y);
    }
    
    // Plot pH Line (Blue)
    if (phPoints.length > 0) {
        ctx.strokeStyle = varColor('--blue');
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        
        phPoints.forEach((d, idx) => {
            const pctX = phPoints.length > 1 ? idx / (phPoints.length - 1) : 0.5;
            const x = margin.left + pctX * chartW;
            const phVal = Math.max(phMin, Math.min(phMax, d.ph));
            const y = margin.top + chartH - ((phVal - phMin) / (phMax - phMin)) * chartH;
            
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        
        // Draw Dots
        ctx.fillStyle = varColor('--blue');
        phPoints.forEach((d, idx) => {
            const pctX = phPoints.length > 1 ? idx / (phPoints.length - 1) : 0.5;
            const x = margin.left + pctX * chartW;
            const phVal = Math.max(phMin, Math.min(phMax, d.ph));
            const y = margin.top + chartH - ((phVal - phMin) / (phMax - phMin)) * chartH;
            
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    // Plot EC Line (Green)
    if (ecPoints.length > 0) {
        ctx.strokeStyle = varColor('--accent');
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        
        ecPoints.forEach((d, idx) => {
            const pctX = ecPoints.length > 1 ? idx / (ecPoints.length - 1) : 0.5;
            const x = margin.left + pctX * chartW;
            const ecVal = Math.max(ecMin, Math.min(ecMax, d.ec));
            const y = margin.top + chartH - ((ecVal - ecMin) / (ecMax - ecMin)) * chartH;
            
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        
        // Draw Dots
        ctx.fillStyle = varColor('--accent');
        ecPoints.forEach((d, idx) => {
            const pctX = ecPoints.length > 1 ? idx / (ecPoints.length - 1) : 0.5;
            const x = margin.left + pctX * chartW;
            const ecVal = Math.max(ecMin, Math.min(ecMax, d.ec));
            const y = margin.top + chartH - ((ecVal - ecMin) / (ecMax - ecMin)) * chartH;
            
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        });
    }
    
    // Draw X Axis labels
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    
    const labelPoints = data.length > 0 ? data : [];
    if (labelPoints.length > 0) {
        const step = Math.ceil(labelPoints.length / 5);
        for (let idx = 0; idx < labelPoints.length; idx += step) {
            const d = labelPoints[idx];
            const pctX = labelPoints.length > 1 ? idx / (labelPoints.length - 1) : 0.5;
            const x = margin.left + pctX * chartW;
            ctx.fillText(`R ${d.riego_num.toFixed(1)}`, x, h - margin.bottom + 6);
        }
    }
    
    // Draw Legends
    ctx.textAlign = "left";
    ctx.fillStyle = varColor('--blue');
    ctx.fillText("● pH", margin.left, margin.top - 8);
    ctx.fillStyle = varColor('--accent');
    ctx.fillText("● EC", margin.left + 50, margin.top - 8);
}

function drawTempHumChart(data) {
    const canvas = document.getElementById("chart-temp-hum");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const w = rect.width;
    const h = rect.height;
    
    ctx.clearRect(0,0,w,h);
    
    const tempPoints = data.filter(d => d.temp_day !== null || d.temp_night !== null);
    const humPoints = data.filter(d => d.humidity !== null);
    
    if (tempPoints.length === 0 && humPoints.length === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "12px Inter";
        ctx.textAlign = "center";
        ctx.fillText("Registra mediciones climáticas para ver el gráfico", w/2, h/2);
        return;
    }
    
    const margin = { top: 20, right: 40, bottom: 30, left: 40 };
    const chartW = w - margin.left - margin.right;
    const chartH = h - margin.top - margin.bottom;
    
    // Draw Grid Lines (4 horizontal)
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = margin.top + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(w - margin.right, y);
        ctx.stroke();
    }
    
    // Limits
    const tempMin = 15, tempMax = 30;
    const humMin = 30, humMax = 80;
    
    // Draw Y Axis Labels (Left: Temp)
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "10px Inter";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 3; i++) {
        const val = tempMax - ((tempMax - tempMin) / 3) * i;
        const y = margin.top + (chartH / 3) * i;
        ctx.fillText(val.toFixed(0) + '°C', margin.left - 8, y);
    }
    
    // Draw Y Axis Labels (Right: Hum)
    ctx.textAlign = "left";
    for (let i = 0; i <= 3; i++) {
        const val = humMax - ((humMax - humMin) / 3) * i;
        const y = margin.top + (chartH / 3) * i;
        ctx.fillText(val.toFixed(0) + '%', w - margin.right + 8, y);
    }
    
    // Plot Temp Day Line (Orange)
    if (tempPoints.length > 0) {
        ctx.strokeStyle = varColor('--orange');
        ctx.lineWidth = 2;
        ctx.beginPath();
        tempPoints.forEach((d, idx) => {
            const pctX = tempPoints.length > 1 ? idx / (tempPoints.length - 1) : 0.5;
            const x = margin.left + pctX * chartW;
            const tempVal = Math.max(tempMin, Math.min(tempMax, d.temp_day));
            const y = margin.top + chartH - ((tempVal - tempMin) / (tempMax - tempMin)) * chartH;
            
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        
        ctx.fillStyle = varColor('--orange');
        tempPoints.forEach((d, idx) => {
            const pctX = tempPoints.length > 1 ? idx / (tempPoints.length - 1) : 0.5;
            const x = margin.left + pctX * chartW;
            const tempVal = Math.max(tempMin, Math.min(tempMax, d.temp_day));
            const y = margin.top + chartH - ((tempVal - tempMin) / (tempMax - tempMin)) * chartH;
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    // Plot Humidity Line (Purple)
    if (humPoints.length > 0) {
        ctx.strokeStyle = varColor('--purple');
        ctx.lineWidth = 2;
        ctx.beginPath();
        humPoints.forEach((d, idx) => {
            const pctX = humPoints.length > 1 ? idx / (humPoints.length - 1) : 0.5;
            const x = margin.left + pctX * chartW;
            const humVal = Math.max(humMin, Math.min(humMax, d.humidity));
            const y = margin.top + chartH - ((humVal - humMin) / (humMax - humMin)) * chartH;
            
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        
        ctx.fillStyle = varColor('--purple');
        humPoints.forEach((d, idx) => {
            const pctX = humPoints.length > 1 ? idx / (humPoints.length - 1) : 0.5;
            const x = margin.left + pctX * chartW;
            const humVal = Math.max(humMin, Math.min(humMax, d.humidity));
            const y = margin.top + chartH - ((humVal - humMin) / (humMax - humMin)) * chartH;
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, Math.PI * 2);
            ctx.fill();
        });
    }
    
    // Draw X Axis dates
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    if (data.length > 0) {
        const step = Math.ceil(data.length / 5);
        for (let idx = 0; idx < data.length; idx += step) {
            const d = data[idx];
            const pctX = data.length > 1 ? idx / (data.length - 1) : 0.5;
            const x = margin.left + pctX * chartW;
            ctx.fillText(formatDateShort(d.date), x, h - margin.bottom + 6);
        }
    }
    
    // Draw Legends
    ctx.textAlign = "left";
    ctx.fillStyle = varColor('--orange');
    ctx.fillText("● Tº Día", margin.left, margin.top - 8);
    ctx.fillStyle = varColor('--purple');
    ctx.fillText("● Humedad", margin.left + 65, margin.top - 8);
}

function varColor(cssVarName) {
    // Helper to resolve CSS variables directly inside canvas
    return getComputedStyle(document.documentElement).getPropertyValue(cssVarName).trim();
}

// ==========================================
// MODALS LOGIC
// ==========================================
function setupModals() {
    // Close modal triggers
    document.querySelectorAll(".btn-close-modal").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            closeAllModals();
        });
    });

    // Close on overlay click
    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                closeAllModals();
            }
        });
    });

    // Open new crop modal
    const handleNewCropOpen = () => {
        const inputStart = document.getElementById("crop-start-date");
        // default start date to today's date
        inputStart.value = new Date().toISOString().split('T')[0];
        
        // Populate templates dropdown in modal
        const templateSelector = document.getElementById("crop-template");
        if (templateSelector) {
            templateSelector.innerHTML = '<option value="">-- Empezar de Cero (Plantilla Predeterminada) --</option>';
            cropsList.forEach(c => {
                const opt = document.createElement("option");
                opt.value = c.id;
                opt.textContent = `${c.name} (${c.status === 'active' ? 'Activo' : 'Archivado'})`;
                templateSelector.appendChild(opt);
            });
        }
        
        openModal("modal-new-crop");
    };

    const btnNew = document.getElementById("btn-new-crop");
    const btnNewD = document.getElementById("btn-new-crop-desktop");
    if (btnNew) btnNew.addEventListener("click", handleNewCropOpen);
    if (btnNewD) btnNewD.addEventListener("click", handleNewCropOpen);
}

function openModal(modalId) {
    document.getElementById(modalId).classList.add("active");
}

function closeAllModals() {
    document.querySelectorAll(".modal-overlay").forEach(modal => {
        modal.classList.remove("active");
    });
}

function setupVpdWidget() {
    const btnChart = document.getElementById("btn-toggle-vpd-chart");
    const drawer = document.getElementById("vpd-drawer");
    if (btnChart && drawer) {
        btnChart.addEventListener("click", () => {
            if (drawer.style.display === "none") {
                drawer.style.display = "block";
                btnChart.innerHTML = `<i class="fa-solid fa-eye-slash"></i> Ocultar Tablas de Referencia VPD`;
            } else {
                drawer.style.display = "none";
                btnChart.innerHTML = `<i class="fa-solid fa-image"></i> Ver Tablas de Referencia VPD`;
            }
        });
    }

    // Toggle auto / manual mode
    const btnAuto = document.getElementById("btn-vpd-mode-auto");
    const btnManual = document.getElementById("btn-vpd-mode-manual");
    const autoComp = document.getElementById("vpd-auto-comparison");
    const manualCtrl = document.getElementById("vpd-manual-controls");
    const targetPhaseContainer = document.getElementById("vpd-target-phase-container");

    if (btnAuto && btnManual) {
        btnAuto.addEventListener("click", () => {
            vpdMode = 'auto';
            btnAuto.classList.add("active");
            btnManual.classList.remove("active");
            
            // Styles
            btnAuto.style.background = "var(--accent)";
            btnAuto.style.color = "white";
            btnManual.style.background = "transparent";
            btnManual.style.color = "var(--text-secondary)";

            if (autoComp) autoComp.style.display = "flex";
            if (manualCtrl) manualCtrl.style.display = "none";
            if (targetPhaseContainer) targetPhaseContainer.style.display = "none";

            updateDashboardVPD();
        });

        btnManual.addEventListener("click", () => {
            vpdMode = 'manual';
            btnManual.classList.add("active");
            btnAuto.classList.remove("active");

            // Styles
            btnManual.style.background = "var(--accent)";
            btnManual.style.color = "white";
            btnAuto.style.background = "transparent";
            btnAuto.style.color = "var(--text-secondary)";

            if (autoComp) autoComp.style.display = "none";
            if (manualCtrl) manualCtrl.style.display = "flex";
            if (targetPhaseContainer) targetPhaseContainer.style.display = "block";

            updateDashboardVPD();
        });
    }

    // Sliders & Phase selector event listeners
    const tempSlider = document.getElementById("vpd-manual-temp-slider");
    const humSlider = document.getElementById("vpd-manual-hum-slider");
    const tempValDisp = document.getElementById("vpd-manual-temp-val");
    const humValDisp = document.getElementById("vpd-manual-hum-val");
    const manualPhase = document.getElementById("vpd-manual-phase");

    if (tempSlider && tempValDisp) {
        tempSlider.addEventListener("input", () => {
            tempValDisp.textContent = `${tempSlider.value}°C`;
            updateDashboardVPD();
        });
    }

    if (humSlider && humValDisp) {
        humSlider.addEventListener("input", () => {
            humValDisp.textContent = `${humSlider.value}%`;
            updateDashboardVPD();
        });
    }

    if (manualPhase) {
        manualPhase.addEventListener("change", () => {
            updateDashboardVPD();
        });
    }
}

function updateDashboardVPD() {
    const vpdBoxContainer = document.getElementById("vpd-box-container");
    const vpdBoxNum = document.getElementById("vpd-box-num");
    const vpdBoxLabel = document.getElementById("vpd-box-label");
    const vpdPointer = document.getElementById("vpd-pointer");
    const vpdStageText = document.getElementById("vpd-stage-text");
    
    if (!vpdBoxContainer || !vpdBoxNum || !vpdBoxLabel || !vpdPointer || !vpdStageText) return;

    let vpdVal = null;
    let minRange = 0.4;
    let maxRange = 0.8;
    let stageName = "Desconocida";
    
    if (vpdMode === 'auto') {
        // Auto Mode: read from database logs
        const nextWatering = fullSchedule.find(s => !s.completed);
        if (nextWatering) {
            if (nextWatering.phase === 'Crecimiento') {
                if (nextWatering.week === 1) {
                    stageName = "Crecimiento Temprano (Semana 1)";
                    minRange = 0.4;
                    maxRange = 0.8;
                } else {
                    stageName = "Crecimiento Tardío (Semana 2)";
                    minRange = 0.8;
                    maxRange = 1.2;
                }
            } else { // Floración
                if (nextWatering.week <= 2) {
                    stageName = "Floración Temprana (Semanas 1-2)";
                    minRange = 0.8;
                    maxRange = 1.2;
                } else {
                    stageName = "Floración Media / Tardía (Semanas 3-8)";
                    minRange = 1.2;
                    maxRange = 1.6;
                }
            }
        }
        
        // Find latest climate log with VPD or enough data to calculate it
        const latestClimateLog = climateLogs.find(log => log.vpd !== null || (log.temp_day !== null && log.humidity !== null));
        if (latestClimateLog) {
            if (latestClimateLog.vpd !== null) {
                vpdVal = latestClimateLog.vpd;
            } else {
                vpdVal = calculateLeafVPD(latestClimateLog.temp_day, latestClimateLog.humidity);
            }
        }
        
        // Update comparison fields
        const targetVPD = nextWatering && nextWatering.climate_targets ? nextWatering.climate_targets.vpd : null;
        const tgtValEl = document.getElementById("vpd-target-val");
        const tgtRngEl = document.getElementById("vpd-target-range");
        if (tgtValEl) tgtValEl.textContent = targetVPD ? `${targetVPD.toFixed(2)} kPa` : "-- kPa";
        if (tgtRngEl) tgtRngEl.textContent = `${minRange.toFixed(1)} - ${maxRange.toFixed(1)} kPa`;
        
        vpdStageText.innerHTML = `<strong>Etapa de Cultivo Actual:</strong> ${stageName}<br><span class="muted-text">Leyendo datos automáticos de tu última medición.</span>`;
        
    } else {
        // Manual Mode: read from sliders
        const tempSlider = document.getElementById("vpd-manual-temp-slider");
        const humSlider = document.getElementById("vpd-manual-hum-slider");
        const temp = tempSlider ? parseFloat(tempSlider.value) : 24;
        const hum = humSlider ? parseFloat(humSlider.value) : 60;
        vpdVal = calculateLeafVPD(temp, hum);
        
        const phaseVal = document.getElementById("vpd-manual-phase").value;
        if (phaseVal === 'early-veg') {
            stageName = "Propagación / Crecimiento Temprano";
            minRange = 0.4;
            maxRange = 0.8;
        } else if (phaseVal === 'late-veg') {
            stageName = "Crecimiento Tardío / Flora Temprana";
            minRange = 0.8;
            maxRange = 1.2;
        } else {
            stageName = "Floración Media / Tardía";
            minRange = 1.2;
            maxRange = 1.6;
        }
        vpdStageText.innerHTML = `<strong>Modo Calculadora Manual:</strong> Simulando condiciones.<br><span class="muted-text">Mueve los deslizadores de temperatura y humedad para ensayar valores de VPD.</span>`;
    }
    
    // Calculate and apply dynamic gradient on the track bar
    const vpdTrack = document.querySelector(".vpd-gauge-bar-track");
    if (vpdTrack) {
        const p1 = Math.max(0, Math.min(100, ((minRange - 0.15) / 3.0) * 100));
        const p2 = Math.max(0, Math.min(100, (minRange / 3.0) * 100));
        const p3 = Math.max(0, Math.min(100, (maxRange / 3.0) * 100));
        const p4 = Math.max(0, Math.min(100, ((maxRange + 0.15) / 3.0) * 100));
        
        vpdTrack.style.background = `linear-gradient(to right, 
            #3b82f6 0%, 
            #3b82f6 ${p1}%, 
            #f59e0b ${p1}%, 
            #f59e0b ${p2}%, 
            #10b981 ${p2}%, 
            #10b981 ${p3}%, 
            #f59e0b ${p3}%, 
            #f59e0b ${p4}%, 
            #ef4444 ${p4}%, 
            #ef4444 100%)`;
    }

    // Render the VPD Box and move pointer
    if (vpdVal !== null && !isNaN(vpdVal)) {
        vpdBoxNum.textContent = vpdVal.toFixed(2);
        
        // Move pointer: range 0.0 to 3.0 kPa
        const percentage = Math.min(100, Math.max(0, (vpdVal / 3.0) * 100));
        vpdPointer.style.left = `${percentage}%`;
        
        // Evaluate status colors
        if (vpdVal >= minRange && vpdVal <= maxRange) {
            vpdBoxContainer.style.background = "rgba(16, 185, 129, 0.15)";
            vpdBoxContainer.style.borderColor = "rgba(16, 185, 129, 0.3)";
            vpdBoxNum.style.color = "#10b981";
            vpdBoxLabel.style.color = "#10b981";
            vpdBoxLabel.textContent = "¡Óptimo! ✅";
        } else if (vpdVal >= (minRange - 0.15) && vpdVal <= (maxRange + 0.15)) {
            vpdBoxContainer.style.background = "rgba(245, 158, 11, 0.15)";
            vpdBoxContainer.style.borderColor = "rgba(245, 158, 11, 0.3)";
            vpdBoxNum.style.color = "#f59e0b";
            vpdBoxLabel.style.color = "#f59e0b";
            vpdBoxLabel.textContent = "Aceptable ⚠️";
        } else {
            if (vpdVal < minRange) {
                vpdBoxContainer.style.background = "rgba(59, 130, 246, 0.15)";
                vpdBoxContainer.style.borderColor = "rgba(59, 130, 246, 0.3)";
                vpdBoxNum.style.color = "#3b82f6";
                vpdBoxLabel.style.color = "#3b82f6";
                vpdBoxLabel.textContent = "Peligro: Demasiado Húmedo 🌧️";
            } else {
                vpdBoxContainer.style.background = "rgba(239, 68, 68, 0.15)";
                vpdBoxContainer.style.borderColor = "rgba(239, 68, 68, 0.3)";
                vpdBoxNum.style.color = "#ef4444";
                vpdBoxLabel.style.color = "#ef4444";
                vpdBoxLabel.textContent = "Peligro: Demasiado Seco 🏜️";
            }
        }
    } else {
        vpdBoxNum.textContent = "--";
        vpdPointer.style.left = "0%";
        vpdBoxContainer.style.background = "rgba(255, 255, 255, 0.02)";
        vpdBoxContainer.style.borderColor = "var(--border-color)";
        vpdBoxNum.style.color = "var(--text-secondary)";
        vpdBoxLabel.style.color = "var(--text-secondary)";
        vpdBoxLabel.textContent = "Sin Datos";
    }
}
