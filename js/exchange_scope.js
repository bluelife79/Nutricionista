/**
 * Premium 2.2 — product scope for the RevolucionaT exchanger.
 *
 * Processing is not treated as a synonym for "unhealthy". Plain yoghurt,
 * canned pulses, frozen vegetables, tofu, bread and canned fish can all be
 * useful foods. The scope instead closes the public product around foods that
 * can honestly take part in a healthy menu exchange.
 *
 * Statuses:
 *   - exchange_core: searchable and eligible as a normal candidate.
 *   - reference_only: searchable only for an equivalent reference context;
 *     it never enters the candidates of a core origin.
 *   - excluded: neither searchable nor eligible as a candidate.
 *   - not_publishable: already hidden/quarantined for data-quality reasons.
 */
(function (global) {
  "use strict";

  var VERSION = "premium-v2.3-scope-1";
  var CHOICE_VERSION = "premium-v2.5-choice-1";
  var STATUS = {
    CORE: "exchange_core",
    REFERENCE: "reference_only",
    EXCLUDED: "excluded",
    NOT_PUBLISHABLE: "not_publishable",
  };

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function hasAny(text, patterns) {
    return patterns.some(function (pattern) {
      return pattern.test(text);
    });
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function contextOf(food, explicitContext) {
    if (explicitContext) return String(explicitContext);
    if (
      typeof global.inferPremiumContext === "function"
    ) {
      return global.inferPremiumContext(food);
    }
    return String((food && food.premium_context) || "unknown");
  }

  function notPublishable(food) {
    return Boolean(
      !food ||
        food.quality_status === "quarantine" ||
        (food.flags || []).includes("hidden") ||
        !food.subgroup ||
        food.subgroup === "?",
    );
  }

  function evidenceFor(food) {
    return food && food.processing_evidence
      ? food.processing_evidence
      : {
          version: "premium-v2.2-processing-1",
          status: "not_available",
          nova_group: null,
          nutriscore_grade: null,
          sweeteners_n: null,
          ingredients_n: null,
          nutrient_levels: {},
        };
  }

  function result(status, reasons, context, evidence) {
    return {
      version: VERSION,
      status: status,
      reason_codes: unique(reasons),
      context: context,
      evidence_status: String((evidence && evidence.status) || "not_available"),
    };
  }

  var INSTANT_OR_BOUILLON_RE =
    /\b(yatekomo|avecrem|noodles? instant\w*|fideos? instant\w*|sopa instant\w*|ramen instant\w*|cubitos? de caldo|pastillas? de caldo|caldo en cubitos?|bouillon)\b/;
  var CONFECTIONERY_RE =
    /\b(gominol\w*|golosin\w*|chuch\w*|caramelos?|chicles?|nubes?|malvavisc\w*|donuts?|doughnuts?|croissants?|boll\w*|magdalenas?|bizcochos?|gallet\w*|cookies?|tartas?|pasteles?|helados?|polos?|calipo|mousse|puddings?|natillas?|barritas? prote\w*|snack prote\w*)\b/;
  var SWEET_CEREAL_RE =
    /\b(cereal\w*|copos?|muesli|granola|trigo inflado)\b.*\b(chocolate|cacao|caramel\w*|miel|azucar\w*|rellen\w*|fundente)\b|\b(choco ?bollz|cereales? rellenos?)\b/;
  var SUGARY_DRINK_RE =
    /\b(refresco\w*|gaseosa\w*|bebida energet\w*|bebida isoton\w*|aquarius|cola|limonada|nectar\w*|zumos?|jugos?)\b/;
  var ALCOHOL_RE =
    /\b(cerveza\w*|vino\w*|sangria\w*|sidra\w*|vermut\w*|licor\w*|ron\b|whisky|vodka|ginebra)\b/;
  var PROCESSED_MEAT_RE =
    /\b(choriz\w*|salchich\w*|mortadela\w*|salami\w*|fuet\w*|bacon\b|panceta\w*|fiambre\w*|sobrasad\w*|nugget\w*|jamon cocido|jamon serrano|jamon iberico|lomo (?:de )?(?:cebo|bellota).*iberic\w*|paleta.*iberic\w*|embutid\w*)\b/;
  var DISALLOWED_OIL_RE =
    /^aceite\b.*\b(palma|palmiste|algodon|germen de trigo|para freir)\b/;
  var FAST_READY_MEAL_RE =
    /\b(pizza\w*|lasa[nñ]\w* refrigerad\w*|hamburgues\w* con|burgers?\b|perrito\w*|kebab\w*|fingers?\b|croquet\w*|san jacobo|cordon bleu|empanadill\w*|burrito\w* preparado\w*|sandwich\w*|sanwich\w*|flautas?\b|funroll\b|gyozas?\b)\b/;
  var FLAVOURED_DAIRY_RE =
    /\b(pudding|mousse|natillas?|postre|tipo actimel|actimel|aromatizad\w*|edulcor\w*|educor\w*|azucarad\w*|con azucar\w*|con nata|frut\w*|fruit\w*|berr\w*|sabores?\b(?!\s+(?:natural|suave)\b)|sabor (?!natural\b|suave\b)|manzana\w*|pera\b|naranja\w*|fresa\w*|frambues\w*|mango|vainilla|caramelo|melocoton\w*|platano\w*|pina\b|coco\b|arandano\w*|ciruela\w*|albaricoque\w*|maracuya\w*|macedonia|trocitos? de fruta|strawberr\w*|blueberr\w*|raspberr\w*|peach\w*|passion fruit|vanilla|fruit flavour\w*)\b/;
  var FERMENTED_DAIRY_IDENTITY_RE =
    /\b(yogur\w*|yogurt|yoghourt|yaourt|iogur|kefir|quefir|skyr|bifidus|l casei|queso fresco batido|postre prote\w*)\b/;
  var NO_ADDED_SUGAR_CLAIM_RE =
    /\b(sin azucar(?:es)?(?: anadid\w*)?|no added sugar|without added sugar|sans sucres? ajoutes?|ohne zuckerzusatz|senza zuccheri aggiunti|sem acucar(?:es)? adicionado\w*)\b/g;
  var ADDED_SUGAR_INGREDIENT_RE =
    /\b(azucar(?:es)?|fructosa|glucosa|dextrosa|sacarosa|miel|panela|zucker|fruktose|glukose|honig|sugar|fructose|glucose|honey|sucre|miel|zucchero|miele|acucar|xarope|sciroppo|jarabe|sirope|sirop)\b|\b(zumo|jugo|juice|saft|succo)\b.{0,30}\b(concentrad\w*|concentrate\w*|konzentrat\w*)\b/;
  var DIRECT_ADDED_SUGAR_INGREDIENT_RE =
    /\b(azucar(?:es)?|fructosa|glucosa|dextrosa|sacarosa|miel|panela|zucker|fruktose|glukose|honig|sugar|fructose|glucose|honey|sucre|miel|zucchero|miele|acucar|xarope|sciroppo|jarabe|sirope|sirop)\b/;
  var FLAVOURED_NUT_RE =
    /\b(carameliz\w*|garrapin\w*|chocolatead\w*|con chocolate|sabor (barbacoa|chili|miel)|frit\w*|salad\w*|punto de sal|aguasal)\b/;
  var SEASONED_PROTEIN_RE =
    /\b(adobad\w*|marinad\w*|empanad\w*|rebozad\w*|fregit\w*|nuggets?|estilo (andaluz|kebab|cajun|tex mex))\b/;
  var FILLED_PASTA_RE =
    /\b(pasta\w* rellena\w*|ravioli\w*|tortellini\w*|tortelloni\w*|canelon\w*|cannelloni\w*)\b/;
  var FRUIT_PUREE_RE =
    /\b(compota\w*|pure de frutas?|fruit cie|fruta triturad\w*|bolsita de fruta)\b/;
  var PRESERVED_HIGH_SALT_FISH_RE =
    /\b(ahumad\w*|anchoad\w*|salazon\w*|salad\w*|en escabeche)\b/;
  var INDUSTRIAL_SNACK_RE =
    /\b(aros de maiz|tiras de maiz|snacks?|chips?|crisps?|nachos?|conos? de vainilla|plum cake|tejas? con|hojaldre de queso|tostas? queso|bocaditos? de queso|sables?)\b/;
  var COMMERCIAL_COOKED_MEAT_RE =
    /\b(lonchas?|brasead\w*|al horno|asado|asada|cocid\w*|bien star|fiambre|bajo en sal)\b/;
  var VEGETABLE_SOUP_OR_PUREE_RE =
    /\b(crema|pure|veloute|sopa)\b.*\b(verdura\w*|calabac\w*|calabaz\w*|zanahoria\w*|brocoli|espinaca\w*|puerro\w*|esparrag\w*|pimiento\w*|alcachofa\w*)\b|\b(pure|crema) de\b/;
  var COMPOSITE_LEGUME_RE =
    /\b(a la riojana|a la jardinera|con verduras?|con acelgas?|garam masala|guisad\w*|potaje|fabada|cocido)\b/;
  var STUFFED_COMPOSITE_RE =
    /\b(pimient\w*|peperoncin\w*|calabac\w*|berenjen\w*|tomate\w*)\b.{0,45}\brellen\w*\b/;
  var FRIED_VEGETABLE_IN_OIL_RE =
    /\b(berenjen\w*|habas?|habitas?|verduras?|hortalizas?)\b.{0,45}\bfrit\w*\b.{0,45}\baceite\b/;
  var PREPARED_TUBER_RE =
    /\b(patatas? (corte )?para (tortilla|bravas)|pure de patata)\b/;
  var READY_COFFEE_RE =
    /\b(cappuccino|capuchino|latte|macchiato|cold brew|cafe frio|cafe con leche preparado)\b/;
  var MILK_FRUIT_DRINK_RE =
    /\b(fruta\w* (y |con )?leche|leche (y|con) fruta\w*|bebida de leche y fruta\w*|l casei sabor)\b/;
  var NON_PLAIN_MILK_RE =
    /\b(leche merengada|leche materna|leche de crecimiento|leche crecimiento|leche avellanas)\b/;
  var PROCESSED_CHEESE_RE =
    /\b(queso fundido|lonchas? queso fundido|triangulo\w* fundente\w*|queso en polvo)\b/;
  var FLAVOURED_STAPLE_RE =
    /\b(arroz|maiz|noodles?|fideos?|pasta|papas?|patatas?)\b.*\bsabor\b/;
  var NOVA4_CORE_CONTEXTS = new Set([
    "fermented_dairy",
    "spoonable_fresh_dairy",
    "milk",
    "plant_drink",
    "bread",
    "fresh_cheese",
    "spreadable_cheese",
    "aged_cheese",
    "canned_fish",
    "cooked_legume",
    "olive",
    "plant_protein",
  ]);

  function nova4ContextApproved(food, context, evidenceTags) {
    if (!NOVA4_CORE_CONTEXTS.has(context)) return false;
    if (context === "bread") {
      return food.clean_carb !== false && food.raw_ingredient !== true;
    }
    if (context === "canned_fish") {
      return food.clean_protein === true;
    }
    if (context === "cooked_legume") {
      return food.clean_carb !== false;
    }
    if (context === "olive") {
      return (
        food.clean_fat !== false &&
        !/condiments|sauces|tomato-sauces/.test(evidenceTags || "")
      );
    }
    if (context === "plant_protein") {
      return food.clean_protein !== false;
    }
    return true;
  }

  function clearCoreIdentity(food, context, name) {
    var patterns = {
      breakfast_cereal:
        /\b(avena|copos?|salvado|porridge|muesli|cereal\w*|flakes?|flocs?|granola)\b/,
      bread:
        /\b(pan|bread|pita|wrap|tortilla de (trigo|maiz)|hogaza|barra|baguette|molde|regana)\b/,
      dry_grain:
        /\b(arroz|pasta alimenticia|espiral\w*|macarron\w*|espaguet\w*|tallarin\w*|fideo\w*|cuscus|couscous|quinoa|bulgur|trigo|maiz|centeno|cebada|mijo|amaranto)\b/,
      cooked_grain:
        /\b(arroz|pasta alimenticia|espiral\w*|macarron\w*|espaguet\w*|tallarin\w*|fideo\w*|cuscus|couscous|quinoa|bulgur|trigo|maiz|centeno|cebada|mijo|amaranto)\b/,
      baking_input:
        /\b(harina|masa|hojaldre|levadura|pan rallado|rebozado)\b/,
      tuber: /\b(patata\w*|papas?|boniato\w*|batata\w*|yuca|mandioca)\b/,
      cooked_tuber:
        /\b(patata\w*|papas?|boniato\w*|batata\w*|yuca|mandioca)\b/,
      cooked_legume:
        /\b(garbanz\w*|lentej\w*|alubia\w*|judia\w*|frijol\w*|guisante\w*|soja|edamame|altramuz\w*|haba\w*)\b/,
      lean_meat:
        /\b(pollo|pavo|ternera|vacuno|cerdo|conejo|caballo|avestruz|lomo|solomillo|pechuga|muslo)\b/,
      fatty_meat:
        /\b(cordero|pato|cerdo|costilla\w*|panceta|morro|oreja|codillo|muslo)\b/,
      minced_meat:
        /\b(picad\w*|carne picada|vacuno|ternera|pollo|pavo|cerdo)\b/,
      egg:
        /\b(huevo\w*|clara\w*|yema\w*|tortilla(?: a la)? francesa)\b/,
      white_fish:
        /\b(merluza|bacalao|rape|lenguado|gallo|dorada|lubina|panga|tilapia|calamar|sepia|gamba|gambon|langostino|mejillon|almeja|berberecho|pulpo|pota|pijota|raya)\b/,
      fatty_fish:
        /\b(salmon|sardina|caballa|atun|bonito|boqueron|anchoa|arenque|trucha)\b/,
      canned_fish:
        /\b(salmon|sardina|sardinilla|caballa|atun|bonito|boqueron|anchoa|bacalao|mejillon|berberecho)\b/,
      seafood:
        /\b(camaron\w*|gamba\w*|gambon\w*|langostin\w*|mejillon\w*|almeja\w*|berberech\w*|pulpo\w*|pota|calamar\w*|sepia\w*|vieira\w*|zamburin\w*|cangrej\w*|bogavante\w*|cigala\w*|centoll\w*|necora\w*|percebe\w*|marisco)\b/,
      plant_protein:
        /\b(tofu|tempeh|seitan|soja texturizada|proteina de soja)\b/,
      fermented_dairy:
        /\b(yogur\w*|yogurt|yaourt|iogur|kefir|quefir|skyr|quark|cuajada|bifidus|l casei)\b/,
      spoonable_fresh_dairy:
        /\b(queso fresco batido|quark)\b/,
      milk: /^(leche|lait|llet)\b/,
      plant_drink:
        /\b(bebida|leche|beguda|bevanda)\b.*\b(soja|avena|almendra|arroz|espelta|coco|trigo)\b|\b(soja|avena|almendra|arroz|espelta|coco|trigo)\b.*\b(bebida|leche|beguda|bevanda)\b/,
      fresh_cheese:
        /\b(queso|mozzarella|mozzarela|burrata|feta|ricotta|cottage|requeson|mato)\b/,
      spreadable_cheese:
        /\b(queso (?:para )?untar|queso crema|crema de queso|frischkase|mascarpone)\b/,
      aged_cheese:
        /\b(queso|emmental|gouda|havarti|cheddar|parmesano|grana padano|manchego|brie|camembert|gorgonzola|raclette)\b/,
      whole_fruit:
        /\b(manzana|pera|naranja|mandarina|platano|banana|fresa|frambuesa|arandano|mora|grosella|cereza|melocoton|nectarina|albaricoque|ciruela|uva|sandia|melon|pina|mango|papaya|kiwi|higo|datil|granada|pomelo|limon|aguacate)\b/,
      leafy_vegetable:
        /\b(lechuga|espinaca|acelga|endivia|escarola|canonigos|col rizada)\b/,
      cruciferous:
        /\b(brocoli|coliflor|repollo|col\b|coles de bruselas)\b/,
      fruiting_vegetable:
        /\b(tomate|pimiento|calabacin|berenjena|pepino|calabaza)\b/,
      root_vegetable:
        /\b(zanahoria|remolacha|nabo|rabano|chirivia)\b/,
      stalk_vegetable:
        /\b(apio|puerro|esparrago|alcachofa|hinojo)\b/,
      other_vegetable:
        /\b(cebolla|ajo|seta|champinon|judia verde|verdura|menestra|maiz dulce)\b/,
      oil: /\b(aceite|oil|ol)\b/,
      nuts_seeds:
        /\b(almendra|nuez|avellana|pistacho|anacardo|cacahuete|pipas?|semilla|sesamo|chia|lino|macadamia|castana)\b/,
      nut_spread:
        /\b(crema|mantequilla|pasta)\b.*\b(almendra|cacahuete|avellana|sesamo|tahin)\b|\btahin\w*\b/,
      avocado: /\b(aguacate|avocado|avocat)\b/,
      olive: /\b(aceituna|olives?)\b/,
      hot_beverage:
        /\b(cafe|coffee|te verde|te negro|infusion|rooibos|manzanilla|menta poleo)\b/,
      plant_savory_spread:
        /\b(hummus|houmous|guacamole)\b/,
    };
    if (patterns[context] && patterns[context].test(name)) return true;

    // BEDCA already gives us a trusted generic identity, a canonical subgroup
    // and complete composition. For those rows the structured facts are a
    // stronger source than requiring every Spanish food name to appear in a
    // hand-written whitelist. Rare foods remain closed; the recovery is aimed
    // at ordinary fruit, vegetables, fish, seafood, eggs and natural fats.
    var source = normalize(food && food.source);
    var frequency = normalize(food && food.frequency);
    var trustedBedca =
      source === "bedca" &&
      frequency !== "raro" &&
      food &&
      food.culinary_role !== "recipe_ingredient";
    if (!trustedBedca) return false;
    if (
      context === "whole_fruit" &&
      ["fruits", "other"].includes(food.category) &&
      !/\b(almibar|pure|compota|zumo)\b/.test(name)
    ) {
      return true;
    }
    if (
      [
        "leafy_vegetable",
        "cruciferous",
        "fruiting_vegetable",
        "root_vegetable",
        "stalk_vegetable",
        "other_vegetable",
      ].includes(context) &&
      ["vegetables", "other"].includes(food.category) &&
      !/\b(pure|crema|sopa)\b/.test(name)
    ) {
      return true;
    }
    if (
      ["white_fish", "fatty_fish", "canned_fish", "seafood"].includes(context) &&
      food.category === "protein" &&
      food.clean_protein === true
    ) {
      return true;
    }
    if (context === "egg" && food.subgroup === "eggs") return true;
    if (
      ["nuts_seeds", "nut_spread"].includes(context) &&
      food.category === "fat" &&
      food.clean_fat === true
    ) {
      return true;
    }
    return false;
  }
  var SIMPLE_COLD_SOUP_RE =
    /\b(gazpacho|salmorejo|ajo blanco|ajoblanco)\b/;
  var TRADITIONAL_DISH_RE =
    /\b(tortilla de patata|paella|escalivada|lentejas? guisad\w*|garbanzos? guisad\w*|fabada|potaje)\b/;
  var DARK_CHOCOLATE_RE =
    /\bchocolate negro\b.*\b(7[0-9]|8[0-9]|9[0-9]|100)\s*(por ciento|%)?\b|\bchocolate\b.*\b(7[0-9]|8[0-9]|9[0-9]|100)\s*(por ciento|%)?\s*cacao\b/;

  function addedSugarAssessment(food) {
    var evidence = evidenceFor(food);
    var name = normalize(food && food.name);
    var ingredients = normalize(evidence.ingredients_text_es || "");
    var labelClaim = NO_ADDED_SUGAR_CLAIM_RE.test(name);
    NO_ADDED_SUGAR_CLAIM_RE.lastIndex = 0;

    if (normalize(food && food.source) === "bedca") {
      return {
        status: "not_applicable",
        verified: true,
        source: "generic_food_identity",
      };
    }

    if (!ingredients) {
      return {
        status: labelClaim ? "not_detected" : "unknown",
        verified: labelClaim,
        source: labelClaim ? "label_claim" : "not_available",
      };
    }

    var ingredientsWithoutClaims = ingredients.replace(
      NO_ADDED_SUGAR_CLAIM_RE,
      " ",
    );
    NO_ADDED_SUGAR_CLAIM_RE.lastIndex = 0;
    var explicitAddedSugars = Number(
      evidence.nutrients_100g && evidence.nutrients_100g.added_sugars,
    );
    if (
      explicitAddedSugars === 0 &&
      !DIRECT_ADDED_SUGAR_INGREDIENT_RE.test(ingredientsWithoutClaims)
    ) {
      return {
        status: "not_detected",
        verified: true,
        source: "ingredients_and_declared_added_sugars",
      };
    }
    var detected = ADDED_SUGAR_INGREDIENT_RE.test(ingredientsWithoutClaims);
    return {
      status: detected ? "detected" : "not_detected",
      verified: true,
      source: "ingredients",
    };
  }

  function isFlavouredDairy(food, context, name, evidenceTags) {
    if (
      ![
        "fermented_dairy",
        "spoonable_fresh_dairy",
        "milk",
        "fresh_cheese",
        "spreadable_cheese",
        "aged_cheese",
      ].includes(
        context,
      )
    ) {
      return false;
    }
    var cleanName = String(name || "")
      .replace(/\bsabor (natural|suave)\b/g, " ")
      .replace(/\bnaturalmente\b/g, " ");
    return Boolean(
      FLAVOURED_DAIRY_RE.test(cleanName) ||
        /fermented-dairy-desserts-with-fruits|fruit-kefir-yogurts/.test(
          evidenceTags || "",
        ),
    );
  }

  function deriveScope(food, explicitContext) {
    var context = contextOf(food, explicitContext);
    var evidence = evidenceFor(food);
    if (notPublishable(food)) {
      return result(
        STATUS.NOT_PUBLISHABLE,
        ["catalogue_quality_gate"],
        context,
        evidence,
      );
    }

    var name = normalize(food.name);
    var subgroup = normalize(food.subgroup).replace(/\s+/g, "_");
    var category = normalize(food.category).replace(/\s+/g, "_");
    var role = normalize(food.culinary_role).replace(/\s+/g, "_");
    if (
      category === "postres_proteicos" &&
      FERMENTED_DAIRY_IDENTITY_RE.test(name)
    ) {
      context = "fermented_dairy";
    }
    var flags = Array.isArray(food.flags) ? food.flags : [];
    var evidenceTags = []
      .concat(evidence.categories_tags || [])
      .concat(evidence.food_groups_tags || [])
      .join(" ")
      .toLowerCase();
    var sugarAssessment = addedSugarAssessment(food);
    var hasAddedSugar = sugarAssessment.status === "detected";
    var reasons = [];
    var nova =
      evidence.nova_group == null || evidence.nova_group === ""
        ? Number.NaN
        : Number(evidence.nova_group);
    var hasNova = Number.isFinite(nova) && nova >= 1 && nova <= 4;
    var sweeteners = Number(evidence.sweeteners_n);
    var hasSweeteners = Number.isFinite(sweeteners) && sweeteners > 0;
    var flavouredDairy = isFlavouredDairy(
      food,
      context,
      name,
      evidenceTags,
    );
    var nutrientLevels = evidence.nutrient_levels || {};
    var highRiskNutrient =
      nutrientLevels.sugars === "high" ||
      nutrientLevels.salt === "high" ||
      nutrientLevels["saturated-fat"] === "high" ||
      nutrientLevels.saturated_fat === "high";

    if (
      evidence.off_quality_status === "has_errors" &&
      (evidence.off_quality_errors || []).some(function (error) {
        return /energy-value-in-kcal-does-not-match/.test(String(error));
      }) &&
      Math.abs(
        (
          Number(food.protein || 0) * 4 +
          Number(food.carbs || 0) * 4 +
          Number(food.fat || 0) * 9
        ) - Number(food.calories || 0)
      ) / Math.max(Number(food.calories || 0), 1) > 0.25
    ) {
      return result(
        STATUS.EXCLUDED,
        ["inconsistent_nutrition_data"],
        context,
        evidence,
      );
    }

    if (INSTANT_OR_BOUILLON_RE.test(name)) {
      return result(
        STATUS.EXCLUDED,
        ["instant_meal_or_bouillon"],
        context,
        evidence,
      );
    }
    if (context === "hot_beverage") {
      return result(
        STATUS.EXCLUDED,
        ["hot_beverage_outside_food_exchange"],
        context,
        evidence,
      );
    }
    if (/\bgrasa de (pollo|pavo|cerdo|vacuno|ternera)\b/.test(name)) {
      return result(
        STATUS.EXCLUDED,
        ["isolated_animal_fat_not_exchange_food"],
        context,
        evidence,
      );
    }
    if (DISALLOWED_OIL_RE.test(name)) {
      return result(
        STATUS.EXCLUDED,
        ["fat_quality_program_exclusion"],
        context,
        evidence,
      );
    }
    if (/\bpreparado de carne picada\b/.test(name)) {
      return result(
        STATUS.EXCLUDED,
        ["processed_or_prepared_minced_meat"],
        context,
        evidence,
      );
    }
    if (ALCOHOL_RE.test(name) || context === "alcoholic_beverage") {
      return result(STATUS.EXCLUDED, ["alcoholic_beverage"], context, evidence);
    }
    if (
      SUGARY_DRINK_RE.test(name) ||
      ["fruit_beverage", "soft_beverage"].includes(context) ||
      (
        !(
          context === "plant_drink" &&
          /\b(bebida|leche|beguda|bevanda)\b/.test(name)
        ) &&
        /fruit-juices|juices-and-nectars|fruit-based-beverages|smoothies|es:zumo/.test(
          evidenceTags,
        )
      )
    ) {
      return result(
        STATUS.EXCLUDED,
        ["sweet_or_free_sugar_beverage"],
        context,
        evidence,
      );
    }
    if (
      subgroup === "processed_meat" ||
      context === "processed_meat" ||
      PROCESSED_MEAT_RE.test(name) ||
      /processed-meat|prepared-meats|charcuteries/.test(evidenceTags)
    ) {
      return result(STATUS.EXCLUDED, ["processed_meat"], context, evidence);
    }
    if (
      context === "processed_fish" ||
      hasAny(name, [
        /\bsurimi\b/,
        /\bpalitos? de (cangrejo|mar)\b/,
        /\bnuggets? de pescado\b/,
        /\bpescado rebozad\w*\b/,
      ])
    ) {
      return result(STATUS.EXCLUDED, ["processed_fish"], context, evidence);
    }
    if (
      ["white_fish", "fatty_fish", "canned_fish", "seafood"].includes(
        context,
      ) &&
      PRESERVED_HIGH_SALT_FISH_RE.test(name)
    ) {
      return result(
        STATUS.REFERENCE,
        ["salted_or_smoked_fish_reference"],
        context,
        evidence,
      );
    }
    if (
      ["seasoning", "condiment", "savory_sauce"].includes(context) ||
      flags.includes("condiment")
    ) {
      return result(
        STATUS.EXCLUDED,
        ["culinary_adjunct_not_exchange_food"],
        context,
        evidence,
      );
    }
    if (
      (
        category === "postres_proteicos" &&
        !FERMENTED_DAIRY_IDENTITY_RE.test(name)
      ) ||
      ["sweet_bakery", "sweet_dessert", "sweet_spread"].includes(context) ||
      flags.includes("sweet") ||
      CONFECTIONERY_RE.test(name) ||
      SWEET_CEREAL_RE.test(name)
    ) {
      if (context === "chocolate" && DARK_CHOCOLATE_RE.test(name)) {
        return result(
          STATUS.REFERENCE,
          ["dark_chocolate_occasional_reference"],
          context,
          evidence,
        );
      }
      return result(
        STATUS.EXCLUDED,
        ["sweet_or_confectionery"],
        context,
        evidence,
      );
    }
    if (
      /ice-creams|frozen-desserts|sweet-snacks|confectioneries|candies|cakes/.test(
        evidenceTags,
      ) ||
      INDUSTRIAL_SNACK_RE.test(name)
    ) {
      return result(
        STATUS.EXCLUDED,
        ["industrial_dessert_or_snack"],
        context,
        evidence,
      );
    }
    if (
      /fruit\w*-puree|fruit-purees|compotes-to-drink|baby-fruit-desserts/
        .test(evidenceTags)
    ) {
      return result(
        STATUS.EXCLUDED,
        ["fruit_puree_not_whole_fruit"],
        context,
        evidence,
      );
    }
    if (
      /salty-snacks|potato-chips|corn-chips|crisps/.test(evidenceTags) &&
      !["olive", "cooked_legume"].includes(context)
    ) {
      return result(
        STATUS.EXCLUDED,
        ["industrial_salty_snack"],
        context,
        evidence,
      );
    }
    if (FRUIT_PUREE_RE.test(name)) {
      return result(
        STATUS.EXCLUDED,
        ["fruit_puree_not_whole_fruit"],
        context,
        evidence,
      );
    }
    if (PROCESSED_CHEESE_RE.test(name)) {
      return result(
        STATUS.EXCLUDED,
        ["processed_cheese"],
        context,
        evidence,
      );
    }
    if (FLAVOURED_STAPLE_RE.test(name)) {
      return result(
        STATUS.EXCLUDED,
        ["flavoured_industrial_staple"],
        context,
        evidence,
      );
    }
    if (context === "chocolate") {
      return result(
        DARK_CHOCOLATE_RE.test(name) ? STATUS.REFERENCE : STATUS.EXCLUDED,
        [
          DARK_CHOCOLATE_RE.test(name)
            ? "dark_chocolate_occasional_reference"
            : "chocolate_not_core_food",
        ],
        context,
        evidence,
      );
    }
    if (
      context === "protein_supplement" ||
      hasAny(name, [/\bproteindrink\b/, /\bproteina en polvo\b/, /\bwhey\b/])
    ) {
      return result(STATUS.EXCLUDED, ["protein_supplement"], context, evidence);
    }
    if (
      ["fermented_dairy", "spoonable_fresh_dairy"].includes(context) &&
      flavouredDairy
    ) {
      if (
        FERMENTED_DAIRY_IDENTITY_RE.test(name) &&
        sugarAssessment.status === "not_detected" &&
        sugarAssessment.verified
      ) {
        return result(
          STATUS.CORE,
          [
            "flavoured_dairy_without_added_sugar",
            hasSweeteners ? "contains_non_sugar_sweeteners" : null,
            hasNova && nova === 4 ? "off_nova_group_4_information" : null,
          ],
          context,
          evidence,
        );
      }
      return result(
        STATUS.EXCLUDED,
        [
          hasAddedSugar
            ? "added_sugar_in_flavoured_dairy"
            : "flavoured_dairy_sugar_status_unverified",
        ],
        context,
        evidence,
      );
    }
    if (
      context === "fermented_dairy" &&
      Number(food.carbs) >= 9 &&
      sugarAssessment.status !== "not_detected"
    ) {
      return result(
        STATUS.EXCLUDED,
        ["high_carbohydrate_dairy_unverified"],
        context,
        evidence,
      );
    }
    if (
      ["fermented_dairy", "spoonable_fresh_dairy"].includes(context) &&
      /\bcon\b/.test(name) &&
      !/\bcon leche\b/.test(name)
    ) {
      return result(
        STATUS.EXCLUDED,
        ["fermented_dairy_not_plain"],
        context,
        evidence,
      );
    }
    if (MILK_FRUIT_DRINK_RE.test(name)) {
      return result(
        STATUS.EXCLUDED,
        ["sweetened_or_flavoured_dairy_drink"],
        context,
        evidence,
      );
    }
    if (context === "milk" && NON_PLAIN_MILK_RE.test(name)) {
      return result(
        STATUS.EXCLUDED,
        ["milk_identity_not_plain"],
        context,
        evidence,
      );
    }
    if (READY_COFFEE_RE.test(name)) {
      return result(
        STATUS.EXCLUDED,
        ["commercial_ready_coffee"],
        context,
        evidence,
      );
    }
    if (
      context === "breakfast_cereal" &&
      (
        SWEET_CEREAL_RE.test(name) ||
        hasSweeteners ||
        nutrientLevels.sugars === "high"
      )
    ) {
      return result(
        STATUS.EXCLUDED,
        ["sweetened_breakfast_cereal"],
        context,
        evidence,
      );
    }
    if (
      ["nuts_seeds", "nut_spread"].includes(context) &&
      (FLAVOURED_NUT_RE.test(name) || hasSweeteners)
    ) {
      return result(
        STATUS.EXCLUDED,
        ["sweetened_or_flavoured_nuts"],
        context,
        evidence,
      );
    }
    if (
      hasAddedSugar &&
      [
        "whole_fruit",
        "breakfast_cereal",
        "plant_drink",
        "fermented_dairy",
        "spoonable_fresh_dairy",
        "milk",
        "nuts_seeds",
        "nut_spread",
      ].includes(context)
    ) {
      return result(
        STATUS.EXCLUDED,
        ["added_sugar_in_core_food_family"],
        context,
        evidence,
      );
    }
    if (
      context === "plant_drink" &&
      (hasAny(name, [
        /\b(chocolate|cacao|vainilla|fresa|caramelo)\b/,
        /\bazucarad\w*\b/,
      ]) ||
        hasSweeteners)
    ) {
      return result(
        STATUS.EXCLUDED,
        ["sweetened_or_flavoured_plant_drink"],
        context,
        evidence,
      );
    }
    if (hasSweeteners) {
      return result(
        STATUS.EXCLUDED,
        ["sweeteners_outside_supported_food_context"],
        context,
        evidence,
      );
    }
    if (FAST_READY_MEAL_RE.test(name)) {
      return result(
        STATUS.EXCLUDED,
        ["fast_or_industrial_ready_meal"],
        context,
        evidence,
      );
    }
    if (STUFFED_COMPOSITE_RE.test(name)) {
      return result(
        STATUS.REFERENCE,
        ["stuffed_composite_food_reference"],
        context,
        evidence,
      );
    }
    if (FRIED_VEGETABLE_IN_OIL_RE.test(name)) {
      return result(
        STATUS.REFERENCE,
        ["fried_vegetable_in_oil_reference"],
        context,
        evidence,
      );
    }
    if (
      /one-dish-meals|sandwiches|refrigerated-meals|frozen-meals/.test(
        evidenceTags,
      ) &&
      !(
        (context === "prepared_meal" && TRADITIONAL_DISH_RE.test(name)) ||
        context === "cold_soup"
      )
    ) {
      return result(
        STATUS.REFERENCE,
        ["commercial_composite_food_reference"],
        context,
        evidence,
      );
    }
    if (
      ["lean_meat", "fatty_meat", "minced_meat"].includes(context) &&
      normalize(food.source) !== "bedca" &&
      (COMMERCIAL_COOKED_MEAT_RE.test(name) || /\bal natural\b/.test(name))
    ) {
      return result(
        STATUS.REFERENCE,
        ["commercial_cooked_meat_reference"],
        context,
        evidence,
      );
    }
    if (
      ["leafy_vegetable", "cruciferous", "fruiting_vegetable",
        "root_vegetable", "stalk_vegetable", "other_vegetable"]
        .includes(context) &&
      VEGETABLE_SOUP_OR_PUREE_RE.test(name)
    ) {
      return result(
        STATUS.REFERENCE,
        ["vegetable_soup_or_puree_reference"],
        context,
        evidence,
      );
    }
    if (context === "cooked_legume" && COMPOSITE_LEGUME_RE.test(name)) {
      return result(
        STATUS.REFERENCE,
        ["composite_legume_dish_reference"],
        context,
        evidence,
      );
    }
    if (
      ["tuber", "cooked_tuber"].includes(context) &&
      (
        PREPARED_TUBER_RE.test(name) ||
        (
          normalize(food.source) !== "bedca" &&
          Number(food.fat) >= 3
        )
      )
    ) {
      return result(
        STATUS.REFERENCE,
        ["prepared_tuber_reference"],
        context,
        evidence,
      );
    }
    if (
      ["lean_meat", "fatty_meat", "minced_meat", "white_fish", "fatty_fish"]
        .includes(context) &&
      SEASONED_PROTEIN_RE.test(name)
    ) {
      return result(
        STATUS.EXCLUDED,
        ["industrially_seasoned_or_breaded_protein"],
        context,
        evidence,
      );
    }
    if (FILLED_PASTA_RE.test(name)) {
      return result(
        STATUS.EXCLUDED,
        ["filled_or_composite_pasta"],
        context,
        evidence,
      );
    }
    if (
      flags.includes("prepared") &&
      !["prepared_meal", "cold_soup"].includes(context)
    ) {
      return result(
        STATUS.EXCLUDED,
        ["prepared_flag_outside_valid_reference"],
        context,
        evidence,
      );
    }

    if (context === "prepared_meal") {
      if (
        TRADITIONAL_DISH_RE.test(name) &&
        (!hasNova || nova <= 3) &&
        !highRiskNutrient
      ) {
        return result(
          STATUS.REFERENCE,
          ["traditional_composite_dish_reference"],
          context,
          evidence,
        );
      }
      return result(
        STATUS.EXCLUDED,
        [
          evidence.status === "found"
            ? "prepared_meal_not_core"
            : "prepared_meal_without_processing_evidence",
        ],
        context,
        evidence,
      );
    }
    if (context === "cold_soup" || SIMPLE_COLD_SOUP_RE.test(name)) {
      if (hasNova && nova === 4) {
        return result(
          STATUS.EXCLUDED,
          ["ultra_processed_cold_soup"],
          context,
          evidence,
        );
      }
      return result(
        STATUS.REFERENCE,
        ["traditional_cold_soup_reference"],
        context,
        evidence,
      );
    }
    if (context === "animal_savory_spread") {
      return result(
        STATUS.EXCLUDED,
        ["processed_animal_spread"],
        context,
        evidence,
      );
    }
    if (context === "organ_meat") {
      return result(
        STATUS.REFERENCE,
        ["organ_meat_reference_not_everyday_exchange"],
        context,
        evidence,
      );
    }
    if (context === "baking_input") {
      return result(
        STATUS.REFERENCE,
        ["baking_input_reference"],
        context,
        evidence,
      );
    }
    if (["plant_savory_spread", "savory_spread"].includes(context)) {
      if (hasAny(name, [/\bpate\b/, /\bfoie\b/, /\bsobrasad\w*\b/, /\bzurrapa\b/])) {
        return result(
          STATUS.EXCLUDED,
          ["processed_savory_spread"],
          context,
          evidence,
        );
      }
      var trustedSpanishSource = /^(bedca|mercadona|carrefour|lidl|aldi|eroski|dia)$/i
        .test(String(food.source || "").trim());
      if (
        hasAny(name, [/\bhummus\b/, /\bhoumous\b/, /\bguacamole\b/]) &&
        (
          (hasNova && nova <= 3) ||
          (
            !hasNova &&
            trustedSpanishSource &&
            hasAny(name, [/\bhummus\b/, /\bhoumous\b/]) &&
            !/\blight\b/.test(name)
          )
        )
      ) {
        return result(
          STATUS.CORE,
          [
            hasNova
              ? "simple_legume_or_avocado_spread"
              : "trusted_spanish_plant_spread",
          ],
          context,
          evidence,
        );
      }
      if (
        hasAny(name, [/\bhummus\b/, /\bhoumous\b/, /\bguacamole\b/]) &&
        !hasNova
      ) {
        return result(
          STATUS.REFERENCE,
          ["unverified_legume_or_avocado_spread_reference"],
          context,
          evidence,
        );
      }
      return result(
        STATUS.REFERENCE,
        ["savory_spread_reference"],
        context,
        evidence,
      );
    }
    if (
      subgroup === "butter_margarine" ||
      hasAny(name, [/\bmantequilla\b/, /\bmargarina\b/])
    ) {
      return result(
        STATUS.REFERENCE,
        ["saturated_or_spreadable_fat_reference"],
        context,
        evidence,
      );
    }
    if (
      role === "dessert" ||
      role === "snack" &&
        ![
          "nuts_seeds",
          "whole_fruit",
          "breakfast_cereal",
          "bread",
        ].includes(context)
    ) {
      return result(
        STATUS.EXCLUDED,
        ["dessert_or_industrial_snack_role"],
        context,
        evidence,
      );
    }
    if (
      hasNova &&
      nova === 4 &&
      !nova4ContextApproved(food, context, evidenceTags)
    ) {
      return result(
        STATUS.EXCLUDED,
        ["nova4_context_not_approved_for_exchange"],
        context,
        evidence,
      );
    }
    if (
      context === "unknown" ||
      context === "non_exchangeable"
    ) {
      return result(
        STATUS.EXCLUDED,
        ["unresolved_exchange_identity"],
        context,
        evidence,
      );
    }
    if (!clearCoreIdentity(food, context, name)) {
      return result(
        STATUS.EXCLUDED,
        ["identity_not_clear_for_core_exchange"],
        context,
        evidence,
      );
    }

    return result(
      STATUS.CORE,
      [
        hasNova
          ? "core_food_with_processing_evidence"
          : "core_food_by_identity",
        hasNova && nova === 4 ? "off_nova_group_4_information" : null,
      ],
      context,
      evidence,
    );
  }

  function scopeFor(food) {
    if (
      food &&
      food.exchange_scope &&
      food.exchange_scope.version === VERSION &&
      food.exchange_scope.status
    ) {
      return food.exchange_scope;
    }
    return deriveScope(food);
  }

  function searchable(food) {
    var status = scopeFor(food).status;
    return status === STATUS.CORE || status === STATUS.REFERENCE;
  }

  function candidateEligible(food, originFood) {
    var candidateStatus = scopeFor(food).status;
    if (candidateStatus === STATUS.CORE) return true;
    if (candidateStatus !== STATUS.REFERENCE) return false;
    return Boolean(
      originFood && scopeFor(originFood).status === STATUS.REFERENCE,
    );
  }

  function deriveChoiceGuidance(food) {
    var scope = scopeFor(food);
    var evidence = evidenceFor(food);
    var sugarAssessment = addedSugarAssessment(food);
    var name = normalize(food && food.name);
    var evidenceTags = []
      .concat(evidence.categories_tags || [])
      .concat(evidence.food_groups_tags || [])
      .join(" ")
      .toLowerCase();
    var context = String(scope.context || contextOf(food));
    var flavoured = isFlavouredDairy(food, context, name, evidenceTags);
    var nova =
      evidence.nova_group == null || evidence.nova_group === ""
        ? Number.NaN
        : Number(evidence.nova_group);
    var sweeteners = Number(evidence.sweeteners_n);
    var hasNova4 = Number.isFinite(nova) && nova === 4;
    var hasSweeteners = Number.isFinite(sweeteners) && sweeteners > 0;
    var fatProgramPriority =
      ["seed_refined", "tropical"].includes(food && food.fat_quality);
    var packaged = normalize(food && food.source) !== "bedca";
    var labelSensitiveContexts = new Set([
      "breakfast_cereal",
      "bread",
      "milk",
      "plant_drink",
      "fermented_dairy",
      "spoonable_fresh_dairy",
      "fresh_cheese",
      "spreadable_cheese",
      "aged_cheese",
      "processed_meat",
      "processed_fish",
      "canned_fish",
      "oil",
      "olive",
      "nuts_seeds",
      "avocado",
      "nut_spread",
      "plant_savory_spread",
      "savory_spread",
      "cold_soup",
      "prepared_meal",
    ]);
    var labelUnverified =
      packaged &&
      labelSensitiveContexts.has(context) &&
      sugarAssessment.status === "unknown";
    var reasonCodes = [];
    var level = "preferred";

    if (
      scope.status === STATUS.EXCLUDED ||
      scope.status === STATUS.NOT_PUBLISHABLE
    ) {
      return {
        version: CHOICE_VERSION,
        level: "hidden",
        label: "No disponible",
        summary: "",
        detail: "",
        reason_codes: Array.from(scope.reason_codes || []),
        rank_factor: 0,
        no_added_sugar: sugarAssessment,
      };
    }

    if (scope.status === STATUS.REFERENCE) {
      level = "occasional";
      reasonCodes.push("reference_only");
    } else {
      if (flavoured) reasonCodes.push("flavoured_product");
      if (hasSweeteners) reasonCodes.push("contains_sweeteners");
      if (hasNova4) reasonCodes.push("nova_group_4");
      if (sugarAssessment.status === "detected") {
        reasonCodes.push("contains_added_sugar");
      }
      if (reasonCodes.length > 0) {
        level = "compatible";
      } else if (labelUnverified) {
        level = "unverified";
        reasonCodes.push("packaged_label_not_verified");
      }
      if (fatProgramPriority) {
        level = "occasional";
        reasonCodes.push("fat_quality_program_priority");
      }
    }

    var isChocolate = context === "chocolate";
    var copy = {
      preferred: {
        label: "Para diario",
        summary: "Una opción sencilla que encaja bien.",
        detail:
          "Puedes utilizarla con tranquilidad dentro de tu menú habitual.",
        rankFactor: 1,
      },
      compatible: {
        label:
          sugarAssessment.status === "detected"
            ? "Mejor para alguna vez"
            : "También te vale",
        summary: hasSweeteners
          ? "La cantidad cuadra, aunque lleva edulcorantes."
          : sugarAssessment.status === "detected"
            ? "Cuadra, pero lleva azúcar añadido."
            : "Cuadra, aunque tiene más ingredientes de la cuenta.",
        detail:
          sugarAssessment.status === "detected"
            ? "Que aparezca aquí no significa que sea nuestra primera elección. Mejor dejarla para alguna vez."
            : hasSweeteners
              ? "Puedes hacer el cambio. Para diario, nos gusta más una opción con ingredientes sencillos."
              : "Puedes hacer el cambio, aunque para diario pondremos primero las opciones más sencillas.",
        rankFactor: 0.8,
      },
      unverified: {
        label: "Nos falta información",
        summary: "La cantidad puede encajar, pero no vemos bien toda la etiqueta.",
        detail:
          "No hemos podido comprobar todos sus ingredientes. Puedes usar la equivalencia, pero pondremos antes los productos con una etiqueta clara.",
        rankFactor: 0.74,
      },
      occasional: {
        label: isChocolate ? "Capricho con sitio" : "Mejor para alguna vez",
        summary: fatProgramPriority
          ? "Cuadra como grasa, pero no es nuestra primera opción para diario."
          : isChocolate
            ? "Sí, puede encajar."
            : "Puede encajar, pero no es nuestra primera opción para diario.",
        detail: fatProgramPriority
          ? "Si puedes elegir, tira antes de aceite de oliva, aguacate, aceitunas o frutos secos."
          : isChocolate
            ? "Mejor como capricho que como fondo de armario."
            : "Te sirve como referencia. Para diario, pondremos primero opciones más sencillas.",
        rankFactor: 0.62,
      },
    }[level];

    return {
      version: CHOICE_VERSION,
      level: level,
      label: copy.label,
      summary: copy.summary,
      detail: copy.detail,
      reason_codes: unique(reasonCodes),
      rank_factor: copy.rankFactor,
      no_added_sugar: sugarAssessment,
      nova_group: Number.isFinite(nova) ? nova : null,
    };
  }

  function choiceGuidanceFor(food) {
    if (
      food &&
      food.choice_guidance &&
      food.choice_guidance.version === CHOICE_VERSION &&
      food.choice_guidance.level
    ) {
      return food.choice_guidance;
    }
    return deriveChoiceGuidance(food);
  }

  var api = {
    PREMIUM_EXCHANGE_SCOPE_VERSION: VERSION,
    PREMIUM_CHOICE_GUIDANCE_VERSION: CHOICE_VERSION,
    PREMIUM_EXCHANGE_SCOPE_STATUS: STATUS,
    derivePremiumExchangeScope: deriveScope,
    getPremiumExchangeScope: scopeFor,
    isPremiumExchangeSearchable: searchable,
    isPremiumExchangeCandidateEligible: candidateEligible,
    getPremiumAddedSugarAssessment: addedSugarAssessment,
    derivePremiumChoiceGuidance: deriveChoiceGuidance,
    getPremiumChoiceGuidance: choiceGuidanceFor,
  };

  Object.keys(api).forEach(function (key) {
    global[key] = api[key];
  });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
