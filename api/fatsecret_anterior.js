module.exports = async (req, res) => {
  try {
    const query = (req.query?.query || "").trim();
    if (!query)
      return res.status(400).json({ success: false, error: "Missing query" });

    // ✅ Recomendado: usar ENV en Vercel (luego te digo cómo)
    const CLIENT_ID = process.env.FATSECRET_CLIENT_ID || "TU_CLIENT_ID_AQUI";
    const CLIENT_SECRET =
      process.env.FATSECRET_CLIENT_SECRET || "TU_CLIENT_SECRET_AQUI";

    // 1) OAuth token
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

    // 2) foods.search (✅ forzamos JSON)
    const body = new URLSearchParams({
      method: "foods.search",
      search_expression: query,
      format: "json",
      max_results: "20",
    });

    const searchResp = await fetch(
      "https://platform.fatsecret.com/rest/server.api",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${token}`,
        },
        body: body.toString(),
      },
    );

    const searchText = await searchResp.text();

    // ✅ Si FatSecret devuelve XML, lo detectamos y lo devolvemos como diagnóstico
    if (
      searchText.trim().startsWith("<?xml") ||
      searchText.trim().startsWith("<")
    ) {
      return res.status(500).json({
        success: false,
        step: "foods.search_xml",
        message:
          "FatSecret devolvió XML (no JSON). Revisa parámetros y method/format.",
        raw: searchText.slice(0, 400),
      });
    }

    let searchData;
    try {
      searchData = JSON.parse(searchText);
    } catch {
      return res.status(500).json({
        success: false,
        step: "foods.search_parse",
        raw: searchText.slice(0, 400),
      });
    }

    const foodsRaw = searchData?.foods?.food || [];
    const foods = Array.isArray(foodsRaw) ? foodsRaw : [foodsRaw];

    return res.json({
      success: true,
      query,
      total: foods.length,
      foods,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ success: false, error: "API Error", message: e.message });
  }
};
