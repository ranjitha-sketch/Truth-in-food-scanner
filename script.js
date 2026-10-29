
const API = "https://world.openfoodfacts.org/api/v2/product/";
const SEARCH_API = "https://world.openfoodfacts.org/cgi/search.pl";

const $ = (selector) => document.querySelector(selector);

const results = $("#results");
const message = $("#message");
const historyList = $("#historyList");

let currentProduct = null;
let requestNumber = 0;

function readStorage(key, fallback = []) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    showMessage("Browser storage is unavailable or full.", true);
    return false;
  }
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function setLoading(text = "Searching product database...") {
  showMessage(text);
  results.replaceChildren();
}

function formatNumber(value, unit = "") {
  if (value === null || value === undefined || value === "") return "Not available";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Not available";
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}`;
}

function normalizeProduct(product) {
  const n = product.nutriments || {};

  return {
    code: product.code || "",
    name: product.product_name || product.product_name_en || "Unnamed product",
    brand: product.brands || "Brand not specified",
    image: product.image_front_url || product.image_url || "",
    quantity: product.quantity || "Not specified",
    ingredients: product.ingredients_text || product.ingredients_text_en || "",
    allergens: product.allergens || "",
    traces: product.traces || "",
    categories: product.categories || "",
    labels: product.labels || "",
    nutriScore: product.nutriscore_grade || product.nutrition_grades || "",
    nova: product.nova_group || null,
    nutrition: {
      energy: n["energy-kcal_100g"],
      sugar: n.sugars_100g,
      fat: n.fat_100g,
      saturatedFat: n["saturated-fat_100g"],
      protein: n.proteins_100g,
      salt: n.salt_100g,
      fiber: n.fiber_100g
    }
  };
}

async function getJSON(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`The database returned an error (${response.status}).`);
  }

  return response.json();
}

async function searchProducts(query) {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: "8",
    fields: "code,product_name,product_name_en,brands,image_front_url,image_url,quantity,ingredients_text,ingredients_text_en,allergens,traces,categories,labels,nutriscore_grade,nutrition_grades,nova_group,nutriments"
  });

  const data = await getJSON(`${SEARCH_API}?${params}`);
  return (data.products || []).filter(product => product.code);
}

async function getProduct(code) {
  const fields = [
    "code", "product_name", "product_name_en", "brands",
    "image_front_url", "image_url", "quantity", "ingredients_text",
    "ingredients_text_en", "allergens", "traces", "categories",
    "labels", "nutriscore_grade", "nutrition_grades", "nova_group",
    "nutriments"
  ].join(",");

  const data = await getJSON(
    `${API}${encodeURIComponent(code)}.json?fields=${fields}`
  );

  if (data.status !== 1 || !data.product) {
    throw new Error("Product not found. Check the name or barcode and try again.");
  }

  return data.product;
}

function isFavorite(code) {
  return readStorage("tifs-favorites", []).some(item => item.code === code);
}

function saveHistory(product) {
  const history = readStorage("tifs-history", []);
  const updated = [
    {
      code: product.code,
      name: product.name,
      brand: product.brand,
      image: product.image,
      date: new Date().toISOString()
    },
    ...history.filter(item => item.code !== product.code)
  ].slice(0, 10);

  saveStorage("tifs-history", updated);
  renderHistory();
}

function renderHistory() {
  const history = readStorage("tifs-history", []);

  if (!history.length) {
    historyList.innerHTML =
      '<p class="empty-state">Products you explore will appear here.</p>';
    return;
  }

  historyList.innerHTML = history.map(item => `
    <article class="history-item">
      ${item.image
        ? `<img src="${escapeHTML(item.image)}" alt="" loading="lazy">`
        : `<span aria-hidden="true">🥫</span>`}
      <div>
        <strong>${escapeHTML(item.name)}</strong>
        <small>${escapeHTML(item.brand)} · ${escapeHTML(item.code)}</small>
      </div>
      <button type="button" data-open="${escapeHTML(item.code)}">View</button>
    </article>
  `).join("");
}

function nutrientCard(label, value, unit = " g") {
  const display = value === null || value === undefined || value === ""
    ? "Not available"
    : formatNumber(value, unit);

  return `
    <div class="nutrient">
      <strong>${escapeHTML(display)}</strong>
      <span>${escapeHTML(label)} per 100 g</span>
    </div>`;
}

function makeTags(product) {
  const tags = [];

  if (product.nutriScore) {
    tags.push(`Nutri-Score: ${product.nutriScore.toUpperCase()}`);
  }

  if (product.nova) {
    tags.push(`NOVA group: ${product.nova}`);
  }

  if (product.allergens) {
    tags.push("Allergen data recorded");
  }

  return tags.map(tag =>
    `<span class="tag">${escapeHTML(tag)}</span>`
  ).join("");
}

function renderProduct(rawProduct) {
  const product = normalizeProduct(rawProduct);
  currentProduct = product;

  const n = product.nutrition;
  const ingredients = product.ingredients || "Ingredient list not available in the database.";
  const allergens = product.allergens || "No allergen information recorded. This does not mean the product is allergen-free.";
  const traces = product.traces || "No cross-contact information recorded.";

  results.innerHTML = `
    <article class="product-card">
      <div class="product-top">
        ${product.image
          ? `<img class="product-image" src="${escapeHTML(product.image)}" alt="Product packaging" onerror="this.style.display='none'">`
          : `<div class="product-image" role="img" aria-label="No product image available">🥫</div>`}
        <div>
          <span class="eyebrow">PRODUCT REPORT</span>
          <h2 class="product-title">${escapeHTML(product.name)}</h2>
          <div class="product-meta">
            ${escapeHTML(product.brand)}<br>
            Barcode: ${escapeHTML(product.code)}<br>
            Quantity: ${escapeHTML(product.quantity)}
          </div>
          <div class="tag-row">${makeTags(product)}</div>
          <div class="product-actions">
            <button id="favoriteBtn" type="button">
              ${isFavorite(product.code) ? "♥ Saved favorite" : "♡ Save favorite"}
            </button>
            <button id="csvBtn" type="button">Export report CSV</button>
          </div>
        </div>
      </div>

      <h3>Nutrition facts</h3>
      <p class="data-note">Values are per 100 g, as reported by the database. Missing values are not estimated.</p>
      <div class="nutrition-grid">
        ${nutrientCard("Energy", n.energy, " kcal")}
        ${nutrientCard("Sugar", n.sugar)}
        ${nutrientCard("Total fat", n.fat)}
        ${nutrientCard("Saturated fat", n.saturatedFat)}
        ${nutrientCard("Protein", n.protein)}
        ${nutrientCard("Salt", n.salt)}
        ${nutrientCard("Fibre", n.fiber)}
      </div>

      <h3>Ingredient list</h3>
      <p class="ingredient-text">${escapeHTML(ingredients)}</p>

      <h3>Allergen information</h3>
      <div class="tag-row">
        <span class="tag warning">Declared allergens: ${escapeHTML(allergens)}</span>
      </div>
      <p class="data-note">Cross-contact / traces: ${escapeHTML(traces)}</p>

      <h3>Additional product information</h3>
      <p><strong>Categories:</strong> ${escapeHTML(product.categories || "Not recorded")}</p>
      <p><strong>Labels:</strong> ${escapeHTML(product.labels || "Not recorded")}</p>

      <p class="data-note">
        Source: Open Food Facts. Database records may be incomplete, user-contributed,
        or outdated. Check the physical packaging before making dietary decisions.
      </p>
    </article>`;

  $("#favoriteBtn").addEventListener("click", toggleFavorite);
  $("#csvBtn").addEventListener("click", exportCSV);
  saveHistory(product);
  showMessage("Product report loaded.");
}

async function loadProduct(code) {
  const request = ++requestNumber;
  setLoading("Loading product details...");

  try {
    const product = await getProduct(code);
    if (request !== requestNumber) return;
    renderProduct(product);
  } catch (error) {
    if (request !== requestNumber) return;
    showMessage(error.message || "Unable to load product.", true);
  }
}

$("#searchForm").addEventListener("submit", async event => {
  event.preventDefault();
  const query = $("#productSearch").value.trim();
  if (!query) return;

  const request = ++requestNumber;
  setLoading("Searching product database...");

  try {
    const products = await searchProducts(query);
    if (request !== requestNumber) return;

    if (!products.length) {
      showMessage("No matching products found. Try another name or barcode.", true);
      return;
    }

    if (products.length === 1) {
      renderProduct(products[0]);
      return;
    }

    showMessage(`Found ${products.length} products. Select the correct one.`);

    results.innerHTML = products.map((product, index) => `
      <article class="history-item">
        ${product.image_front_url
          ? `<img src="${escapeHTML(product.image_front_url)}" alt="" loading="lazy">`
          : `<span>🥫</span>`}
        <div>
          <strong>${escapeHTML(product.product_name || "Unnamed product")}</strong>
          <small>${escapeHTML(product.brands || "Brand not specified")}</small>
        </div>
        <button type="button" data-result-index="${index}">Inspect</button>
      </article>
    `).join("");

    results.querySelectorAll("[data-result-index]").forEach(button => {
      button.addEventListener("click", () => {
        const product = products[Number(button.dataset.resultIndex)];
        loadProduct(product.code);
      });
    });
  } catch (error) {
    if (request === requestNumber) {
      showMessage("Search failed. Check your internet connection and try again.", true);
    }
  }
});

$("#barcodeForm").addEventListener("submit", event => {
  event.preventDefault();
  const code = $("#barcodeInput").value.trim();

  if (!/^\d{8,14}$/.test(code)) {
    showMessage("Enter a barcode containing 8 to 14 digits.", true);
    return;
  }

  loadProduct(code);
});

function toggleFavorite() {
  if (!currentProduct) return;

  let favorites = readStorage("tifs-favorites", []);
  const exists = favorites.some(item => item.code === currentProduct.code);

  if (exists) {
    favorites = favorites.filter(item => item.code !== currentProduct.code);
    showMessage("Removed from favorites.");
  } else {
    favorites.unshift({
      code: currentProduct.code,
      name: currentProduct.name,
      brand: currentProduct.brand
    });
    showMessage("Added to favorites.");
  }

  saveStorage("tifs-favorites", favorites);
  $("#favoriteBtn").textContent = exists ? "♡ Save favorite" : "♥ Saved favorite";
}

function exportCSV() {
  if (!currentProduct) return;

  const p = currentProduct;
  const rows = [
    ["Field", "Value"],
    ["Product", p.name],
    ["Brand", p.brand],
    ["Barcode", p.code],
    ["Ingredients", p.ingredients],
    ["Allergens", p.allergens],
    ["Traces", p.traces],
    ["Energy kcal per 100g", p.nutrition.energy],
    ["Sugar g per 100g", p.nutrition.sugar],
    ["Fat g per 100g", p.nutrition.fat],
    ["Saturated fat g per 100g", p.nutrition.saturatedFat],
    ["Protein g per 100g", p.nutrition.protein],
    ["Salt g per 100g", p.nutrition.salt],
    ["Fibre g per 100g", p.nutrition.fiber],
    ["Source", "Open Food Facts"]
  ];

  const csv = rows.map(row =>
    row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")
  ).join("\r\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `food-report-${p.code || "product"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

historyList.addEventListener("click", event => {
  const button = event.target.closest("[data-open]");
  if (button) loadProduct(button.dataset.open);
});

$("#clearHistory").addEventListener("click", () => {
  saveStorage("tifs-history", []);
  renderHistory();
  showMessage("History cleared.");
});

$("#themeBtn").addEventListener("click", () => {
  const isDark = document.body.classList.toggle("dark");
  $("#themeBtn").textContent = isDark ? "☀️" : "🌙";
  try {
    localStorage.setItem("tifs-dark", String(isDark));
  } catch {
    // Theme still works for the current page.
  }
});

try {
  if (localStorage.getItem("tifs-dark") === "true") {
    document.body.classList.add("dark");
    $("#themeBtn").textContent = "☀️";
  }
} catch {
  // Local storage may be disabled by browser settings.
}

renderHistory();
