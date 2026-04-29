// /api/fatsecret.js  (Vercel Serverless)
// FatSecret OAuth2 + URL-based endpoints (evita XML y el 0-result raro)

module.exports = async (req, res) => {
  try {
    // CORS básico (por si llamas desde tu HTML)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    const query = (req.query?.query || "").trim();
    const debug = (req.query?.debug || "") === "1";

    if (!query) {
      return res.status(400).json({ success: false, error: "Missing query" });
    }

    const CLIENT_ID = process.env.FATSECRET_CLIENT_ID;
    const CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return res.status(500).json({
        success: false,
        step: "env",
        message:
          "Faltan FATSECRET_CLIENT_ID / FATSECRET_CLIENT_SECRET en Vercel (Production).",
      });
    }

    // 1) TOKEN OAuth2
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
      "base64",
    );

    const tokenResp = await fetch("https://oauth.fatsecret.com/connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: "grant_type=client_credentials&scope=basic",
    });

    const tokenText = await tokenResp.text();
    let tokenData;
    try {
      tokenData = JSON.parse(tokenText);
    } catch {
      return res.status(500).json({
        success: false,
        step: "token_parse",
        status: tokenResp.status,
        raw: tokenText.slice(0, 300),
      });
    }

    if (!tokenResp.ok || !tokenData.access_token) {
      return res.status(500).json({
        success: false,
        step: "token",
        status: tokenResp.status,
        tokenData,
      });
    }

    const token = tokenData.access_token;

    // 2) SEARCH (URL-based) -> JSON estable
    const searchUrl = new URL(
      "https://platform.fatsecret.com/rest/foods/search/v1",
    );
    searchUrl.searchParams.set("search_expression", query);
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("max_results", "20");

    const searchResp = await fetch(searchUrl.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const searchText = await searchResp.text();

    // Si devuelve XML/HTML, lo enseñamos para debug
    if (searchText.trim().startsWith("<")) {
      return res.status(500).json({
        success: false,
        step: "foods_search_xml",
        status: searchResp.status,
        raw: searchText.slice(0, 400),
      });
    }

    let searchData;
    try {
      searchData = JSON.parse(searchText);
    } catch {
      return res.status(500).json({
        success: false,
        step: "foods_search_parse",
        status: searchResp.status,
        raw: searchText.slice(0, 400),
      });
    }

    // Estructura típica: { foods: { food: [...] } }
    const foodsRaw = searchData?.foods?.food || [];
    const foodsBasic = Array.isArray(foodsRaw)
      ? foodsRaw
      : foodsRaw
        ? [foodsRaw]
        : [];

    // Si no hay resultados, devolvemos también el payload para ver si viene "error"
    if (foodsBasic.length === 0) {
      return res.json({
        success: true,
        query,
        total: 0,
        foods: [],
        ...(debug
          ? { debug: { search_status: searchResp.status, searchData } }
          : {}),
      });
    }

    // 3) DETALLES (macros) con FOOD GET (URL-based)
    const detailedFoods = [];
    const maxDetails = 12; // para no pasarnos con latencia

    for (const item of foodsBasic.slice(0, maxDetails)) {
      const foodId = item.food_id;
      if (!foodId) continue;

      const detailUrl = new URL("https://platform.fatsecret.com/rest/food/v5");
      detailUrl.searchParams.set("food_id", String(foodId));
      detailUrl.searchParams.set("format", "json");

      const detailResp = await fetch(detailUrl.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const detailText = await detailResp.text();
      if (detailText.trim().startsWith("<")) continue;

      let detailData;
      try {
        detailData = JSON.parse(detailText);
      } catch {
        continue;
      }

      const parsed = parseFood(detailData?.food);
      if (!parsed) continue;

      // Filtros: suaves por defecto. (Luego afilamos)
      if (!isValidSoft(parsed, query)) continue;

      detailedFoods.push(parsed);
    }

    return res.json({
      success: true,
      query,
      total: detailedFoods.length,
      foods: detailedFoods,
      ...(debug ? { debug: { foods_search_count: foodsBasic.length } } : {}),
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: "API Error",
      message: e.message,
    });
  }
};

// --- Helpers

function parseFood(food) {
  if (!food) return null;

  const servings = food.servings?.serving;
  if (!servings) return null;

  const arr = Array.isArray(servings) ? servings : [servings];

  // Preferimos 100 g si existe (muy útil para macros “por 100g”)
  const serving100g = arr.find(
    (s) =>
      s.metric_serving_unit === "g" && Number(s.metric_serving_amount) === 100,
  );

  const s = serving100g || arr[0];
  if (!s) return null;

  const protein = num(s.protein);
  const carbs = num(s.carbohydrate);
  const fat = num(s.fat);
  const calories = num(s.calories);
  const sugar = num(s.sugar);
  const saturated_fat = num(s.saturated_fat);

  return {
    id: `fatsecret_${food.food_id}`,
    name: food.food_name || "Sin nombre",
    brand:
      food.brand_name || (food.food_type === "Brand" ? "Marca" : "Genérico"),
    source: "fatsecret",
    calories,
    protein,
    carbs,
    fat,
    sugar,
    saturated_fat,
    category: inferCategory(protein, carbs, fat),
    is_api_result: true,
  };
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// Filtros suaves: queremos que devuelva cosas, luego ya “limpiamos” con cabeza.
function isValidSoft(food, query) {
  const name = (food.name || "").toLowerCase();
  const q = (query || "").toLowerCase();

  // Basura ultra obvia
  const hardBan = [
    "kit kat",
    "snickers",
    "mars",
    "twix",
    "coca cola",
    "fanta",
    "sprite",
    "pepsi",
  ];
  if (hardBan.some((b) => name.includes(b))) return false;

  // Si buscan proteína, dejamos más pasar
  const proteinIntent = [
    "whey",
    "protein",
    "proteína",
    "isolate",
    "casein",
  ].some((k) => q.includes(k) || name.includes(k));
  if (proteinIntent) return food.protein >= 5; // suave

  // Normal: mínimo algo de sentido
  if (food.calories <= 0) return false;

  return true;
}

function inferCategory(p, c, f) {
  if (p >= 10) return "protein";
  if (c >= 20 && c > p && c > f) return "carbs";
  if (f >= 10 && f > p && f > c) return "fat";
  return "other";
}
