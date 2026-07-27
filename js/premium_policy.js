/**
 * Premium v2 context and portion policy.
 *
 * This file contains deterministic, explainable product rules. It does not
 * calculate nutrition and it does not use generated prose as ground truth.
 * The serving thresholds are product-safety and usability signals, not
 * prescriptions. They determine whether a mathematical result is practical
 * enough to show directly, should carry a visible notice, or must be hidden.
 */
(function (global) {
  "use strict";

  var VERSION = "premium-v2.3-context-1";

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

  function inferContext(food) {
    if (!food) return "unknown";
    var name = normalize(food.name);
    var subgroup = String(food.subgroup || "").toLowerCase();
    var category = String(food.category || "").toLowerCase();
    var flags = Array.isArray(food.flags) ? food.flags : [];

    // Identidades de seguridad y colisiones históricas: estas señales
    // inequívocas prevalecen sobre un premium_context antiguo mal materializado.
    if (hasAny(name, [/\bsangre\b/])) return "non_exchangeable";
    if (hasAny(name, [/\bzurrapa\b/, /\bsobrasad\w*\b/, /\bpate\b/, /\bfoie\b/])) {
      return "animal_savory_spread";
    }
    if (hasAny(name, [
      /^higado\b/, /\bhigado de\b/, /^corazon\b/, /\bcorazon de\b/,
      /^rinon\w*\b/, /\brinon\w* de\b/, /\bcallos\b/, /\bmolleja\w*\b/,
    ])) {
      return "organ_meat";
    }
    if (hasAny(name, [/\byema\b.*\bdesecad\w*\b/])) return "baking_input";
    if (hasAny(name, [/\ben su tinta\b/])) return "prepared_meal";
    if (hasAny(name, [/\balino para ensalad\w*\b/])) return "savory_sauce";
    if (
      hasAny(name, [
        /\bagujas?\b/, /\bsardina\w*\b/, /\bsardinilla\w*\b/,
        /\batun\b/, /\bbonito\b/, /\bcaballa\b/, /\bsalmon\b/,
        /\banchoa\w*\b/, /\bmejillon\w*\b/, /\bberberech\w*\b/,
      ]) &&
      hasAny(name, [/\baceite\b/, /\blata\b/, /\bconserva\b/, /\bescabeche\b/])
    ) {
      return "canned_fish";
    }
    if (hasAny(name, [
      /\bpan de molde\b/, /\bpan integral\b/, /\bpan de\b/,
      /\bhogaza\b/, /\bbaguette\b/, /\bmollete\b/,
      /\bpanecill\w*\b/, /\bpico\w*\b/, /\bcolin\w*\b/, /\bbiscot\w*\b/,
    ])) {
      return "bread";
    }
    if (
      /^(ajo|ajo crudo|nuez moscada|cebolla frita)$/.test(name)
    ) {
      return "seasoning";
    }
    if (food.premium_context) return String(food.premium_context);

    if (subgroup === "cold_soup" || food.cold_soup === true) return "cold_soup";
    if (hasAny(name, [/\bpijota\b/])) return "white_fish";
    if (hasAny(name, [/\bsurimi\b/, /\bpalitos? de (cangrejo|mar)\b/])) return "processed_fish";
    if (hasAny(name, [/\bpan rallado\b/, /\brebozad\w*\b/])) return "baking_input";
    if (hasAny(name, [
      /\beneldo\b/, /\bromero\b/, /\bcomino\b/, /\btomillo\b/,
      /\bclavo\b/, /\bcanela\b/, /\bazafran\b/, /\bpimienta\b/,
      /\blaurel\b/, /\banis\b/, /\bguindilla\b/, /\bperejil\b/,
      /\bcilantro\b/, /\bmenta\b/, /\balbahaca\b/, /\boregano\b/,
      /\bajo en polvo\b/,
    ])) {
      return "seasoning";
    }
    if (hasAny(name, [/\bsangria\b/, /\bcerveza\b/, /\bvino\b/, /\bsidra\b/, /\bvermut\b/])) {
      return "alcoholic_beverage";
    }
    if (hasAny(name, [/\bchocolate\b/, /\bcacao\b/, /\bxocolata\b/])) return "chocolate";
    if (hasAny(name, [/\bqueso fresco batido\b/])) return "spoonable_fresh_dairy";
    if (hasAny(name, [/\btahin\w*\b/, /\bpasta de sesamo\b/])) return "nut_spread";
    if (hasAny(name, [/\bguacamole\b/, /\bhummus\b/, /\bhoumous\b/])) {
      return "plant_savory_spread";
    }
    if (hasAny(name, [/\bzumo\b/, /\bnectar\b/, /\bsmoothie\b/, /\blimonada\b/, /\bjugo\b/])) {
      return "fruit_beverage";
    }
    if (hasAny(name, [/\bcafe\b/, /\binfusion\b/, /\bte verde\b/, /\bte negro\b/, /\bmanzanilla\b/])) {
      return "hot_beverage";
    }
    if (hasAny(name, [/\bisotonic\w*\b/, /\brefresco\b/, /\bgaseosa\b/, /\bcola\b/, /\bhorchata\b/])) {
      return "soft_beverage";
    }
    if (
      hasAny(name, [/\bbatido\b/]) &&
      !["dairy", "postres_proteicos"].includes(category)
    ) {
      return "soft_beverage";
    }
    if (
      flags.includes("condiment") ||
      hasAny(name, [
        /\bsalsa\b/, /\bmostaza\b/, /\bmayonesa\b/, /\bmahonesa\b/,
        /\balioli\b/, /\ballioli\b/, /\bpesto\b/, /\bvinagre\b/,
        /\btabasco\b/, /\bmojo\b/, /\bsofrito\b/,
      ])
    ) {
      if (hasAny(name, [
        /\bcanela\b/, /\bcomino\b/, /\bcurry\b/, /\bromero\b/,
        /\btomillo\b/, /\beneldo\b/, /\bclavo\b/, /\bazafran\b/,
        /\bperejil\b/, /\bcilantro\b/, /\bmenta\b/, /\bespecia\w*\b/,
        /\bcubito\b/, /\bcaldo\b/,
      ])) {
        return "seasoning";
      }
      if (hasAny(name, [/\bvinagre\b/])) return "condiment";
      return "savory_sauce";
    }
    if (
      flags.includes("sweet") ||
      subgroup === "sweets_bakery"
    ) {
      if (food.culinary_role === "dessert" || hasAny(name, [/\bcrema catalana\b/, /\bflan\b/, /\bnatill\w*\b/])) {
        return "sweet_dessert";
      }
      return "sweet_bakery";
    }

    if (
      flags.includes("prepared") ||
      hasAny(name, [
        /\bpaella\b/, /\blasan\w*\b/, /\btortilla de patata\b/,
        /\bempanad\w*\b/, /\bpizza\b/, /\bcroqueta\w*\b/,
        /\bensalada\b/, /\brisotto\b/, /\bchili con carne\b/,
        /\bpasta\w* rellena\w*\b/, /\barroz marinera\b/, /\ben su tinta\b/,
      ])
    ) {
      return "prepared_meal";
    }

    if (category === "carbs") {
      if (subgroup === "other_carbs") {
        if (hasAny(name, [
          /\bpan\w*\b/, /\btost\w*\b/, /\bpiquito\w*\b/, /\bbiscot\w*\b/,
          /\bcracke\w*\b/, /\bcolin\w*\b/,
        ])) {
          return "bread";
        }
        if (hasAny(name, [
          /\bpasta\b/, /\bmacarr\w*\b/, /\bespaguet\w*\b/, /\btallarin\w*\b/,
          /\bfideo\w*\b/, /\bfusilli\b/, /\bpenne\b/, /\bcanelon\w*\b/,
          /\bcannelloni\b/, /\bhelice\w*\b/, /\bestrell\w*\b/,
          /\btiburon\w*\b/, /\bplumas?\b/, /\btubitos?\b/, /\bpipette\b/,
          /\bnidos?\b/, /\bpajaritas?\b/, /\btrottole\b/, /\bcoquillettes\b/,
          /\bcapellini\b/, /\bfusill\w*\b/, /\blinguine\b/, /\bserpentini\b/,
          /\bfettuccini\b/, /\bespirals?\b/, /\bradiatori\b/, /\bmaccheroni\b/,
          /\blumaconi\b/, /\bgalets?\b/, /\bcasarecce\b/, /\bletras?\b/,
          /\blazos?\b/, /\bpipe rigate\b/, /\bnoodle\w*\b/, /\bchow mein\b/,
          /\bconchiglie\b/, /\btagliatelle\b/,
          /\bvermicelli\b/, /\bcous?cous\b/, /\bcuscus\b/, /\bbulgur\b/,
          /\barroz\w*\b/, /\barroc\w*\b/, /\barros\b/, /\bbasmati\b/, /\briz\b/,
        ])) {
          return food.raw_ingredient === true ? "dry_grain" : "cooked_grain";
        }
        if (hasAny(name, [
          /\bpreparado panificable\b/, /\bmasa\b/, /\bhojaldre\b/,
          /\bharina\b/, /\bfarine\b/, /\bfarina\b/,
        ])) {
          return "baking_input";
        }
        if (hasAny(name, [
          /\bpa torrat\b/, /\bbastonets? de pa\b/, /\bquadradets? de pa\b/,
          /\bpetits? toasts?\b/, /\bbarra sin sal\b/, /\breganas?\b/,
          /\bbaguettes?\b/, /\bcamperos?\b/,
        ])) {
          return "bread";
        }
        if (hasAny(name, [
          /\bflakes?\b/, /\bflocs?\b/, /\bcereals? integrals?\b/,
          /\bcoquetes?\b/, /\bavoine\b/, /\bfibra sticks\b/,
        ])) {
          return "breakfast_cereal";
        }
        if (hasAny(name, [
          /\bcappuccino\b/, /\blatte\b/, /\bmacchiato\b/,
        ])) {
          return "hot_beverage";
        }
        if (hasAny(name, [
          /\bgelatin\w*\b/, /\bpeladillas?\b/, /\bmalvavisco\b/,
          /\btartelettes?\b/, /\bcaram\b/, /\bsucre\b/, /\bvainilla\b/,
          /\bchoco\b/, /\blenguas de gato\b/,
        ])) {
          return "sweet_bakery";
        }
        return "non_exchangeable";
      }
      if (subgroup === "tubers") {
        return food.raw_ingredient === true ? "tuber" : "cooked_tuber";
      }
      if (subgroup === "legumes") return "cooked_legume";
      if (
        hasAny(name, [
          /\bpan\w*\b/, /\bhogaza\b/, /\bmolde\b/, /\bpita\b/,
          /\bwrap\w*\b/, /\btortilla\w* de (trigo|maiz)\b/,
        ])
      ) {
        return "bread";
      }
      if (
        hasAny(name, [
          /\bavena\b/, /\bcopos\b/, /\bmuesli\b/, /\bgranola\b/,
          /\bporridge\b/, /\bcereal\w* de desayuno\b/,
        ])
      ) {
        return "breakfast_cereal";
      }
      return food.raw_ingredient === true ? "dry_grain" : "cooked_grain";
    }

    if (category === "protein") {
      if (subgroup === "plant_protein") return "plant_protein";
      if (subgroup === "legumes") return "cooked_legume";
      if (subgroup === "viscera") return "organ_meat";
      if (["processed_meat", "processed_protein"].includes(subgroup)) {
        return "processed_meat";
      }
      if (subgroup === "other_protein") {
        if (hasAny(name, [/\bcaracol\w*\b/, /\bmolusc\w*\b/])) return "seafood";
        if (hasAny(name, [/\bsesamo\b/, /\bsemilla\b/])) return "nuts_seeds";
        if (hasAny(name, [/\bsuplemento\b/, /\bproteina en polvo\b/, /\bprotein powder\b/])) {
          return "protein_supplement";
        }
        return "non_exchangeable";
      }
      if (subgroup === "eggs") return "egg";
      if (hasAny(name, [
        /\bcamaron\w*\b/, /\bgamba\w*\b/, /\bgambon\w*\b/,
        /\blangostin\w*\b/, /\bmejillon\w*\b/, /\balmeja\w*\b/,
        /\bberberech\w*\b/, /\bpulpo\w*\b/, /\bpota\b/, /\bcalamar\w*\b/,
        /\bsepia\w*\b/, /\bvieira\w*\b/, /\bzamburin\w*\b/,
        /\bcangrej\w*\b/, /\bbogavante\w*\b/, /\bcigala\w*\b/,
        /\bcentoll\w*\b/, /\bnecora\w*\b/, /\bpercebe\w*\b/,
      ])) {
        return "seafood";
      }
      if (subgroup === "fish_white") {
        return hasAny(name, [/\b(lata|conserva|aceite|natural)\b/])
          ? "canned_fish"
          : "white_fish";
      }
      if (subgroup === "fish_fatty") {
        return hasAny(name, [/\b(lata|conserva|aceite|natural|escabeche)\b/])
          ? "canned_fish"
          : "fatty_fish";
      }
      if (subgroup === "seafood") return "seafood";
      if (subgroup === "fish") {
        if (hasAny(name, [/\bzamburin\w*\b/, /\bmejillon\w*\b/, /\bmolusc\w*\b/])) {
          return "seafood";
        }
        return Number(food.fat) >= 5 ? "fatty_fish" : "white_fish";
      }
      if (hasAny(name, [/\bpicad\w*\b/, /\bhamburgues\w*\b/, /\bminced\b/])) {
        return "minced_meat";
      }
      if (subgroup === "meat_fatty") return "fatty_meat";
      return "lean_meat";
    }

    if (category === "dairy" || category === "postres_proteicos") {
      if (
        hasAny(name, [/\bbebida de (soja|avena|almendra|arroz)\b/])
      ) {
        return "plant_drink";
      }
      if (
        hasAny(name, [/\bqueso fresco batido\b/, /\bquark\b/])
      ) {
        return "spoonable_fresh_dairy";
      }
      if (
        hasAny(name, [
          /\bqueso (?:para )?untar\b/, /\bqueso crema\b/,
          /\bcrema de queso\b/, /\bfrischkase\b/,
        ])
      ) {
        return "spreadable_cheese";
      }
      if (
        subgroup === "fresh_cheese" ||
        hasAny(name, [
          /\bqueso fresco\b/, /\brequeson\b/, /\bricotta\b/,
          /\bcottage\b/, /\bmato\b/,
        ])
      ) {
        return "fresh_cheese";
      }
      if (subgroup === "aged_cheese") return "aged_cheese";
      if (subgroup === "cheese") {
        return hasAny(name, [/\bcremos\w*\b/, /\buntar\b/])
          ? "fresh_cheese"
          : "aged_cheese";
      }
      if (
        hasAny(name, [/\byogur\w*\b/, /\bkefir\b/, /\bskyr\b/, /\bquark\b/, /\bcuajada\b/]) ||
        ["whole_dairy", "low_fat_dairy", "high_protein_dairy"].includes(subgroup)
      ) {
        return "fermented_dairy";
      }
      if (hasAny(name, [/\bleche\b/]) && !hasAny(name, [/\bchocolate\b/, /\bcacao\b/])) {
        return "milk";
      }
      if (hasAny(name, [
        /\bqueso\b/, /\bmascarpone\b/, /\bricotta\b/, /\bcottage\b/,
      ])) {
        return hasAny(name, [/\bcremos\w*\b/, /\bmascarpone\b/, /\bricotta\b/, /\bcottage\b/])
          ? "fresh_cheese"
          : "aged_cheese";
      }
      if (hasAny(name, [/\bbebida\b/, /\bbatido\b/])) return "soft_beverage";
      if (hasAny(name, [
        /\byaourt\b/, /\byogourt\b/, /\biogurt\b/, /\bbifidus\b/,
        /\bbiactive\b/, /\bl casei\b/, /\bquefir\b/, /\bfruchtzwerge\b/,
      ])) {
        return "fermented_dairy";
      }
      if (hasAny(name, [
        /\bleche\b/, /\blait\b/, /\bllet\b/, /\bpreparado lacteo\b/,
      ])) {
        return "milk";
      }
      if (hasAny(name, [
        /\bbechamel\b/, /\bsalsas? frescas?\b/, /\bmostarde?\b/,
      ])) {
        return "savory_sauce";
      }
      if (hasAny(name, [
        /\btabla de quesos\b/, /\bquesos rallados\b/, /\bquesitos?\b/,
        /\bminiqueso\b/, /\bfrischkase\b/,
      ])) {
        return hasAny(name, [/\bfrischkase\b/]) ? "fresh_cheese" : "aged_cheese";
      }
      if (hasAny(name, [
        /\bcalamar\w*\b/, /\bmejillon\w*\b/, /\bsepia\w*\b/, /\bsurimi\b/,
        /\bhuevas?\b/, /\bjamon\b/, /\bcocido\b/, /\bcassoulet\b/,
        /\bguisantes?\b/, /\bhabitas?\b/, /\bpasta\b/, /\bfusilli\b/,
      ])) {
        return "prepared_meal";
      }
      return "non_exchangeable";
    }

    if (category === "fruits") return "whole_fruit";
    if (category === "other" && subgroup === "fruit") return "whole_fruit";

    if (category === "vegetables" || (category === "other" && subgroup === "vegetables")) {
      if (subgroup === "leafy") return "leafy_vegetable";
      if (subgroup === "cruciferous") return "cruciferous";
      if (subgroup === "fruiting_veg") return "fruiting_vegetable";
      if (subgroup === "root_veg") return "root_vegetable";
      if (subgroup === "stalk_veg") return "stalk_vegetable";
      return "other_vegetable";
    }

    if (category === "fat") {
      if (["olive_oil", "other_oils", "butter_margarine"].includes(subgroup)) {
        return "oil";
      }
      if (subgroup === "avocado" || hasAny(name, [/\bguacamole\b/])) return "avocado";
      if (subgroup === "nuts_seeds") return "nuts_seeds";
      if (hasAny(name, [/\baceitun\w*\b/, /\boliva\w*\b/, /\bolives?\b/])) return "olive";
      if (hasAny(name, [/\bcrema\b/, /\bmantequilla de\b/])) return "nut_spread";
      if (subgroup === "other_fat") {
        if (hasAny(name, [/\bmascarpone\b/])) return "spreadable_cheese";
        if (hasAny(name, [/\bfoie\b/, /\bpate\b/, /\bsobrasad\w*\b/, /\bzurrapa\b/])) {
          return "animal_savory_spread";
        }
        if (hasAny(name, [/\bmargarina\b/, /\bmantequilla\b/])) return "oil";
        if (hasAny(name, [
          /\bcalve\b/, /\bcesar\b/, /\bmayonnaise\b/, /\bvinagreta\b/,
          /\bligera\b/, /\bali oli\b/, /\balioli\b/,
        ])) {
          return "savory_sauce";
        }
        if (hasAny(name, [/\bpimient\w*\b/])) return "seasoning";
        if (hasAny(name, [
          /\bdados con ajo\b/, /\btriangulo fundente\b/, /\bcheese sticks\b/,
          /\bsour cre\w*\b/,
        ])) {
          return "fresh_cheese";
        }
        if (hasAny(name, [/\bchicharron\b/])) return "processed_meat";
        if (hasAny(name, [/\bhoumous\b/, /\bhummus\b/])) {
          return "plant_savory_spread";
        }
        return "non_exchangeable";
      }
    }

    if (hasAny(name, [/\bavocado\b/, /\bavocat\b/])) return "avocado";
    if (hasAny(name, [/\baceitun\w*\b/, /\boliva\w*\b/, /\bolives?\b/])) return "olive";
    // Last-resort, name-led recovery for legacy rows whose historical
    // category/subgroup is known to be unreliable. These rules only run after
    // all canonical structured paths above, so good metadata always wins.
    if (hasAny(name, [
      /\byogur\w*\b/, /\byaourt\b/, /\byogourt\b/, /\biogurt\b/,
      /\bbifidus\b/, /\bbiactive\b/, /\bl casei\b/, /\bquefir\b/,
      /\bkefir\b/, /\bfruchtzwerge\b/, /\byughi\b/,
    ])) {
      return "fermented_dairy";
    }
    if (hasAny(name, [
      /\bbebida vegetal\b/, /\bbebida de (avena|soja|arroz|almendra|espelta)\b/,
      /\bbeguda d arros\b/, /\bbevanda\b.*\bsoia\b/, /\bcoconut milk\b/,
      /\bleche de coco\b/,
    ])) {
      return "plant_drink";
    }
    if (hasAny(name, [
      /\bleche\b/, /\blait\b/, /\bllet\b/, /\bpreparado lacteo\b/,
      /\bbebida lactea\b/,
    ])) {
      return "milk";
    }
    if (hasAny(name, [
      /\bqueso\b/, /\bquesitos?\b/, /\bminiqueso\b/, /\bfrischkase\b/,
      /\bfundente\b/, /\bespecial fundir\b/, /\bsour cream\b/,
    ])) {
      return hasAny(name, [/\bcrema\b/, /\bfresco\b/, /\bfrischkase\b/, /\bsour cream\b/])
        ? "fresh_cheese"
        : "aged_cheese";
    }
    if (hasAny(name, [
      /\bsurimi\b/, /\bpalitos? de surimi\b/, /\bdelicias? aguin\w*\b/,
      /\bestrellas aguin\w*\b/, /\bguliciosas\b/,
    ])) {
      return "processed_fish";
    }
    if (hasAny(name, [
      /\bsalmon\b/, /\blachs\b/, /\bmerluza\b/, /\bbacalao\b/,
      /\bgamba\w*\b/, /\bvieira\w*\b/, /\bpoton\b/, /\bchipiron\b/,
      /\bcalamar\w*\b/, /\bsepia\w*\b/, /\bmejillon\w*\b/,
    ])) {
      return Number(food.fat) >= 5 ? "fatty_fish" : "white_fish";
    }
    if (hasAny(name, [/\byork\b/, /\bjamon\b/, /\bchicharron\b/])) {
      return "processed_meat";
    }
    if (hasAny(name, [/\baltramuz\w*\b/])) return "cooked_legume";
    if (hasAny(name, [
      /\bensaladilla\b/, /\bsalteado\b/, /\bparrillada\b/, /\brelleno (de |para )?fajita\b/,
      /\bnoodles? sabor\b/, /\bcrema de setas\b/, /\bpoelee\b/,
      /\btruita\b/, /\balmond?egas\b/, /\bpudin de pescado\b/,
      /\bcocktail oriental\b/, /\bcoctel oriental\b/,
    ])) {
      return "prepared_meal";
    }
    if (hasAny(name, [/\bgazpatxo\b/, /\bgazpacho\b/])) return "cold_soup";
    if (hasAny(name, [
      /\bpajaritas?\b/, /\btrottole\b/, /\bcoquillettes\b/, /\bcapellini\b/,
      /\bfusill\w*\b/, /\blinguine\b/, /\bserpentini\b/, /\bfettuccini\b/,
      /\bespirals?\b/, /\bradiatori\b/, /\bmaccheroni\b/, /\blumaconi\b/,
      /\bgalets?\b/, /\bcasarecce\b/, /\bletras?\b/,
    ])) {
      return food.raw_ingredient === true ? "dry_grain" : "cooked_grain";
    }
    if (hasAny(name, [/\bfarine\b/, /\bfarina\b/])) return "baking_input";
    if (hasAny(name, [/\barros\b/, /\barroces\b/])) {
      return food.raw_ingredient === true ? "dry_grain" : "cooked_grain";
    }
    if (hasAny(name, [
      /\bpa torrat\b/, /\bbastonets? de pa\b/, /\bquadradets? de pa\b/,
      /\bpetits? toasts?\b/, /\bbarra sin sal\b/, /\breganas?\b/,
      /\bbaguettes?\b/, /\bcamperos?\b/,
    ])) {
      return "bread";
    }
    if (hasAny(name, [
      /\bflakes?\b/, /\bflocs?\b/, /\bcereals? integrals?\b/,
      /\bcoquetes? d?e? ?(arros|blat de moro)\b/, /\bavoine\b/,
    ])) {
      return "breakfast_cereal";
    }
    if (hasAny(name, [
      /\bmostarda\b/, /\btomato sauce\b/, /\btumaca\b/, /\bbechamel\b/,
      /\bvinagreta\b/, /\bmayonnaise\b/, /\bali oli\b/, /\bhoumous\b/,
      /\bpasta de curry\b/,
    ])) {
      return "savory_sauce";
    }
    if (hasAny(name, [/\bmiel\b/, /\bmembrillo\b/])) return "sweet_spread";
    if (hasAny(name, [
      /\bgelatin\w*\b/, /\bpeladillas?\b/, /\bmalvavisco\b/,
      /\btartelettes?\b/, /\bcaram\b/, /\bsucre\b/,
    ])) {
      return "sweet_bakery";
    }
    if (hasAny(name, [/\bcappuccino\b/, /\blatte\b/, /\bmacchiato\b/, /\bice coffee\b/])) {
      return "hot_beverage";
    }
    if (hasAny(name, [/\bcurry\b/])) return "seasoning";
    if (hasAny(name, [/\btomates? secos? con aceite\b/])) return "olive";
    if (food.culinary_role === "dessert") return "sweet_dessert";
    if (food.culinary_role === "recipe_ingredient") return "non_exchangeable";

    return "non_exchangeable";
  }

  var COHORT = {
    breakfast_cereal: "carb_breakfast",
    bread: "carb_bread",
    dry_grain: "carb_staple",
    cooked_grain: "carb_staple",
    tuber: "carb_staple",
    cooked_tuber: "carb_staple",
    lean_meat: "protein_meal",
    fatty_meat: "protein_meal",
    minced_meat: "protein_meal",
    egg: "protein_meal",
    white_fish: "protein_meal",
    fatty_fish: "protein_meal",
    canned_fish: "protein_meal",
    seafood: "protein_meal",
    processed_meat: "protein_processed",
    processed_fish: "protein_processed_fish",
    plant_protein: "protein_plant",
    cooked_legume: "protein_plant",
    milk: "milk",
    plant_drink: "plant_drink",
    fermented_dairy: "fermented_dairy",
    fresh_cheese: "fresh_cheese",
    spoonable_fresh_dairy: "spoonable_fresh_dairy",
    spreadable_cheese: "fresh_cheese",
    aged_cheese: "aged_cheese",
    whole_fruit: "fruit",
    leafy_vegetable: "vegetable",
    cruciferous: "vegetable",
    fruiting_vegetable: "vegetable",
    root_vegetable: "vegetable",
    stalk_vegetable: "vegetable",
    other_vegetable: "vegetable",
    oil: "fat",
    nuts_seeds: "fat",
    avocado: "fat",
    olive: "fat",
    nut_spread: "fat",
    chocolate: "chocolate",
    cold_soup: "cold_soup",
    plant_savory_spread: "plant_spread",
    animal_savory_spread: "animal_spread",
    savory_spread: "plant_spread",
    organ_meat: "protein_offal",
    prepared_meal: "prepared_meal",
    fruit_beverage: "fruit_beverage",
    hot_beverage: "hot_beverage",
    soft_beverage: "soft_beverage",
    alcoholic_beverage: "alcoholic_beverage",
    seasoning: "seasoning",
    condiment: "condiment",
    savory_sauce: "savory_sauce",
    sweet_bakery: "sweet",
    sweet_dessert: "sweet",
    sweet_spread: "sweet",
    protein_supplement: "protein_supplement",
    baking_input: "carb_baking",
    non_exchangeable: "unknown",
    unknown: "unknown",
  };

  // UI practicality limits, mirrored in config/serving_policy.json. They are
  // not diet prescriptions: they decide whether an exact mathematical result
  // can be shown as a direct, understandable serving.
  var PORTIONS = {
    breakfast_cereal: { review: 120, hard: 250 },
    bread: { review: 180, hard: 300 },
    dry_grain: { review: 150, hard: 250 },
    cooked_grain: { review: 350, hard: 500 },
    tuber: { review: 400, hard: 550 },
    cooked_tuber: { review: 400, hard: 550 },
    lean_meat: { review: 250, hard: 400 },
    fatty_meat: { review: 250, hard: 400 },
    minced_meat: { review: 250, hard: 400 },
    processed_meat: { review: 100, hard: 180 },
    processed_fish: { review: 180, hard: 280 },
    egg: { review: 220, hard: 350 },
    white_fish: { review: 300, hard: 450 },
    fatty_fish: { review: 250, hard: 400 },
    canned_fish: { review: 200, hard: 300 },
    seafood: { review: 300, hard: 450 },
    plant_protein: { review: 300, hard: 450 },
    cooked_legume: { review: 300, hard: 450 },
    milk: { review: 400, hard: 550 },
    plant_drink: { review: 400, hard: 550 },
    fermented_dairy: { review: 300, hard: 450 },
    fresh_cheese: { review: 200, hard: 300 },
    spoonable_fresh_dairy: { review: 300, hard: 450 },
    spreadable_cheese: { review: 120, hard: 200 },
    aged_cheese: { review: 100, hard: 160 },
    whole_fruit: { review: 350, hard: 500 },
    leafy_vegetable: { review: 400, hard: 550 },
    cruciferous: { review: 400, hard: 550 },
    fruiting_vegetable: { review: 400, hard: 550 },
    root_vegetable: { review: 400, hard: 550 },
    stalk_vegetable: { review: 400, hard: 550 },
    other_vegetable: { review: 400, hard: 550 },
    oil: { review: 30, hard: 50 },
    nuts_seeds: { review: 60, hard: 100 },
    avocado: { review: 200, hard: 300 },
    olive: { review: 120, hard: 200 },
    nut_spread: { review: 60, hard: 100 },
    chocolate: { review: 60, hard: 100 },
    cold_soup: { review: 450, hard: 600 },
    plant_savory_spread: { review: 120, hard: 200 },
    animal_savory_spread: { review: 80, hard: 140 },
    savory_spread: { review: 120, hard: 200 },
    organ_meat: { review: 180, hard: 280 },
    prepared_meal: { review: 450, hard: 600 },
    fruit_beverage: { review: 400, hard: 550 },
    hot_beverage: { review: 400, hard: 550 },
    soft_beverage: { review: 400, hard: 550 },
    alcoholic_beverage: { review: 250, hard: 400 },
    seasoning: { review: 30, hard: 80 },
    condiment: { review: 40, hard: 100 },
    savory_sauce: { review: 120, hard: 200 },
    sweet_bakery: { review: 100, hard: 180 },
    sweet_dessert: { review: 200, hard: 300 },
    sweet_spread: { review: 80, hard: 140 },
    protein_supplement: { review: 80, hard: 140 },
    baking_input: { review: 150, hard: 250 },
    non_exchangeable: { review: 100, hard: 200 },
    unknown: { review: 300, hard: 500 },
  };

  function portionDecision(originFood, candidateFood, originAmount, equivalentAmount) {
    var originContext = inferContext(originFood);
    var candidateContext = inferContext(candidateFood);
    var policy = PORTIONS[candidateContext] || PORTIONS.unknown;
    var amount = Number(equivalentAmount);
    var baseAmount = Number(originAmount);
    var multiplier =
      Number.isFinite(baseAmount) && baseAmount > 0 ? amount / baseAmount : 1;

    if (!Number.isFinite(amount) || amount < 5 || amount > policy.hard) {
      return {
        status: "reject",
        reason: "outside_hard_practical_limit",
        context: candidateContext,
        multiplier: multiplier,
        reviewMax: policy.review,
        hardMax: policy.hard,
      };
    }

    // Very low-calorie vegetables can be mathematically exact at 450–500 g,
    // but that is not a useful direct card for the intended interface.
    if (
      COHORT[candidateContext] === "vegetable" &&
      amount > policy.review
    ) {
      return {
        status: "reject",
        reason: "vegetable_portion_not_practical",
        context: candidateContext,
        multiplier: multiplier,
        reviewMax: policy.review,
        hardMax: policy.hard,
      };
    }

    // Spoonable dairy above the review serving is exactly the failure mode
    // observed in the product audit (125 g yogurt -> 304–350 g alternative).
    if (
      [
        "fermented_dairy",
        "fresh_cheese",
        "spoonable_fresh_dairy",
        "spreadable_cheese",
        "aged_cheese",
      ].includes(candidateContext) &&
      amount > policy.review
    ) {
      return {
        status: "reject",
        reason: "dairy_portion_not_practical",
        context: candidateContext,
        multiplier: multiplier,
        reviewMax: policy.review,
        hardMax: policy.hard,
      };
    }

    var originCohort = COHORT[originContext];
    var candidateCohort = COHORT[candidateContext];
    var legitimateDryWetCarb =
      ["carb_breakfast", "carb_bread", "carb_staple"].includes(originCohort) &&
      candidateCohort === "carb_staple" &&
      amount <= policy.review;

    if (
      amount > policy.review ||
      (multiplier > 2.5 && !legitimateDryWetCarb)
    ) {
      return {
        status: "review",
        reason: amount > policy.review
          ? "above_review_serving"
          : "large_quantity_multiplier",
        context: candidateContext,
        multiplier: multiplier,
        reviewMax: policy.review,
        hardMax: policy.hard,
      };
    }

    return {
      status: "direct",
      reason: "practical_exact_serving",
      context: candidateContext,
      multiplier: multiplier,
      reviewMax: policy.review,
      hardMax: policy.hard,
    };
  }

  function compatibility(originFood, candidateFood) {
    var origin = inferContext(originFood);
    var candidate = inferContext(candidateFood);
    var originCohort = COHORT[origin] || "unknown";
    var candidateCohort = COHORT[candidate] || "unknown";

    if (
      origin === candidate &&
      ["unknown", "non_exchangeable"].includes(origin)
    ) {
      return {
        compatible: false,
        priority: 9,
        origin: origin,
        candidate: candidate,
        reason: "unclassified_context_requires_review",
      };
    }
    if (origin === candidate) {
      return { compatible: true, priority: 0, origin: origin, candidate: candidate, reason: "same_context" };
    }
    if (originCohort !== "unknown" && originCohort === candidateCohort) {
      return { compatible: true, priority: 1, origin: origin, candidate: candidate, reason: "same_cohort" };
    }

    var milkBridge =
      (origin === "milk" && candidate === "plant_drink") ||
      (origin === "plant_drink" && candidate === "milk");
    if (milkBridge) {
      return { compatible: true, priority: 2, origin: origin, candidate: candidate, reason: "milk_family_bridge" };
    }

    var carbBridge =
      ["carb_breakfast", "carb_bread", "carb_staple"].includes(originCohort) &&
      ["carb_breakfast", "carb_bread", "carb_staple"].includes(candidateCohort);
    if (carbBridge) {
      return { compatible: true, priority: 2, origin: origin, candidate: candidate, reason: "carb_secondary_bridge" };
    }

    var spoonableDairyBridge =
      (
        origin === "spoonable_fresh_dairy" &&
        ["fermented_dairy", "fresh_cheese"].includes(candidate)
      ) ||
      (
        candidate === "spoonable_fresh_dairy" &&
        ["fermented_dairy", "fresh_cheese"].includes(origin)
      );
    if (spoonableDairyBridge) {
      return {
        compatible: true,
        priority:
          [origin, candidate].includes("fermented_dairy") ? 1 : 2,
        origin: origin,
        candidate: candidate,
        reason: "spoonable_dairy_bridge",
      };
    }

    var spreadableCheeseBridge =
      (origin === "spreadable_cheese" && candidate === "fresh_cheese") ||
      (origin === "fresh_cheese" && candidate === "spreadable_cheese");
    if (spreadableCheeseBridge) {
      return {
        compatible: true,
        priority: 1,
        origin: origin,
        candidate: candidate,
        reason: "fresh_cheese_form_bridge",
      };
    }

    var plantSpreadBridge =
      (
        origin === "plant_savory_spread" &&
        ["avocado", "nut_spread"].includes(candidate)
      ) ||
      (
        candidate === "plant_savory_spread" &&
        ["avocado", "nut_spread"].includes(origin)
      );
    if (plantSpreadBridge) {
      return {
        compatible: true,
        priority: 1,
        origin: origin,
        candidate: candidate,
        reason: "plant_spread_bridge",
      };
    }

    return { compatible: false, priority: 9, origin: origin, candidate: candidate, reason: "context_mismatch" };
  }

  // Algunas familias comparten macros pero no uso culinario. Solo preguntamos
  // cuando la intención cambia de verdad el resultado; mozzarella es el primer
  // caso explícito (ensalada/frío frente a fundir/gratinar).
  function preparationUses(food) {
    var name = normalize(food && food.name);
    var context = inferContext(food);
    if (context === "spoonable_fresh_dairy") {
      return ["spoon", "cooking_sauce"];
    }
    if (context === "spreadable_cheese") return ["spread"];
    if (context === "plant_savory_spread" || context === "nut_spread") {
      return ["spread", "cooking_sauce"];
    }
    if (hasAny(name, [/\brallad\w*\b/, /\bgratin\w*\b/, /\bfundir\b/, /\bprovolone\b/, /\bfundid\w*\b/])) {
      return ["melt"];
    }
    if (hasAny(name, [/\bmozzarella\b/, /\bmozzarela\b/])) {
      return ["cold", "melt"];
    }
    if (hasAny(name, [
      /\bensalada\b/, /\bburgos\b/, /\brequeson\b/, /\bricotta\b/,
      /\bcottage\b/, /\bfeta\b/, /\bqueso fresco\b/, /\bmato\b/,
    ])) {
      return ["cold"];
    }
    if (context === "fresh_cheese") return ["cold"];
    return ["any"];
  }

  function usagePromptOptions(food) {
    var name = normalize(food && food.name);
    if (hasAny(name, [/\bmozzarella\b/, /\bmozzarela\b/])) {
      return ["cold", "melt", "any"];
    }
    return [];
  }

  function usageCompatibility(candidateFood, requestedUse) {
    if (!requestedUse || requestedUse === "any") {
      return { compatible: true, requested: "any", candidateUses: preparationUses(candidateFood) };
    }
    var uses = preparationUses(candidateFood);
    return {
      compatible: uses.includes("any") || uses.includes(requestedUse),
      requested: requestedUse,
      candidateUses: uses,
    };
  }

  global.PREMIUM_CONTEXT_VERSION = VERSION;
  global.PREMIUM_CONTEXT_COHORTS = COHORT;
  global.PREMIUM_PORTION_POLICIES = PORTIONS;
  global.inferPremiumContext = inferContext;
  global.getPremiumContextCompatibility = compatibility;
  global.getPremiumPortionDecision = portionDecision;
  global.getPremiumPreparationUses = preparationUses;
  global.getPremiumUsagePromptOptions = usagePromptOptions;
  global.getPremiumUsageCompatibility = usageCompatibility;
})(typeof window !== "undefined" ? window : globalThis);
