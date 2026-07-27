#!/usr/bin/env node

"use strict";

const assert = require("assert");
const { createEngine } = require("./lib/algorithm_harness");

const AMOUNT_BY_CONTEXT = {
  breakfast_cereal: 40,
  bread: 60,
  dry_grain: 60,
  cooked_grain: 150,
  tuber: 200,
  cooked_tuber: 200,
  lean_meat: 120,
  fatty_meat: 120,
  minced_meat: 120,
  egg: 100,
  white_fish: 150,
  fatty_fish: 150,
  canned_fish: 80,
  seafood: 150,
  plant_protein: 120,
  cooked_legume: 150,
  milk: 200,
  plant_drink: 200,
  fermented_dairy: 125,
  fresh_cheese: 100,
  spoonable_fresh_dairy: 150,
  spreadable_cheese: 40,
  aged_cheese: 40,
  whole_fruit: 150,
  oil: 10,
  nuts_seeds: 20,
  avocado: 80,
  olive: 50,
  nut_spread: 20,
  plant_savory_spread: 40,
};

function blocks(result) {
  return ["intercambios", "familia", "preparados"].flatMap((block) =>
    (result[block] || []).map((candidate) => ({ block, candidate })),
  );
}

function pairOrder(sequence, ids) {
  return ids
    .map((id) => sequence.findIndex((candidate) => candidate.id === id))
    .filter((position) => position >= 0);
}

async function main() {
  const engine = createEngine();
  const core = engine.foods.filter(
    (food) =>
      engine.window.getPremiumExchangeScope(food).status === "exchange_core",
  );
  let comparisons = 0;
  let hiddenChecked = 0;
  let guidancePairs = 0;
  const orderViolations = [];
  const hiddenViolations = [];
  const guidanceViolations = [];

  for (const origin of core) {
    const context = engine.window.inferPremiumContext(origin);
    const amount = AMOUNT_BY_CONTEXT[context] || 100;
    const [base, doubled] = await Promise.all([
      engine.calculate(origin, amount, { usageMode: "any" }),
      engine.calculate(origin, amount * 2, { usageMode: "any" }),
    ]);

    for (const { block, candidate } of blocks(base)) {
      hiddenChecked += 1;
      const guidance = engine.window.getPremiumChoiceGuidance(candidate);
      const scope = engine.window.getPremiumExchangeScope(candidate);
      if (
        guidance.level === "hidden" ||
        (candidate.flags || []).includes("hidden") ||
        scope.status === "not_publishable"
      ) {
        hiddenViolations.push(`${origin.name}/${block} → ${candidate.name}`);
      }
    }

    for (const block of ["intercambios", "familia", "preparados"]) {
      const baseAll = base[block] || [];
      const doubledAll = doubled[block] || [];
      const baseItems = baseAll.slice(0, 12);
      const doubledItems = doubledAll.slice(0, 12);
      const baseAllIds = new Set(baseAll.map((candidate) => candidate.id));
      const doubledAllIds = new Set(
        doubledAll.map((candidate) => candidate.id),
      );
      const sameCandidatePool =
        baseAllIds.size === doubledAllIds.size &&
        [...baseAllIds].every((id) => doubledAllIds.has(id));
      const doubledById = new Map(
        doubledAll.map((candidate) => [candidate.id, candidate]),
      );
      const allStatusesSame =
        sameCandidatePool &&
        baseAll.every(
          (candidate) =>
            doubledById.get(candidate.id)?.premiumPortionStatus ===
            candidate.premiumPortionStatus,
        );
      const stableIds = baseItems
        .filter((candidate) => {
          const other = doubledById.get(candidate.id);
          return (
            other &&
            doubledItems.some((item) => item.id === candidate.id) &&
            other.premiumPortionStatus === candidate.premiumPortionStatus
          );
        })
        .map((candidate) => candidate.id);

      if (sameCandidatePool && allStatusesSame) {
        const leftOrder = pairOrder(baseItems, stableIds);
        const rightOrder = pairOrder(doubledItems, stableIds);
        for (let left = 0; left < stableIds.length; left += 1) {
          for (let right = left + 1; right < stableIds.length; right += 1) {
            comparisons += 1;
            const leftBefore = leftOrder[left] < leftOrder[right];
            const rightBefore = rightOrder[left] < rightOrder[right];
            if (leftBefore !== rightBefore) {
              orderViolations.push(
                `${origin.name}/${block}: ${stableIds[left]} ↔ ${stableIds[right]}`,
              );
            }
          }
        }
      }

      for (let index = 0; index < baseItems.length; index += 1) {
        const occasional = baseItems[index];
        if (
          engine.window.getPremiumChoiceGuidance(occasional).level !==
          "occasional"
        ) {
          continue;
        }
        for (let later = index + 1; later < baseItems.length; later += 1) {
          const preferred = baseItems[later];
          if (
            engine.window.getPremiumChoiceGuidance(preferred).level !==
              "preferred" ||
            preferred.premiumIdentityRepeat === true
          ) {
            continue;
          }
          const occasionalBase =
            Number(occasional._scoreBeforeChoiceGuidance) || 0;
          const preferredBase =
            Number(preferred._scoreBeforeChoiceGuidance) || 0;
          if (preferredBase < occasionalBase * 0.9) continue;
          guidancePairs += 1;
          guidanceViolations.push(
            `${origin.name}/${block}: ${occasional.name} (${occasionalBase.toFixed(3)}) ` +
              `adelanta a ${preferred.name} (${preferredBase.toFixed(3)})`,
          );
        }
      }
    }
  }

  assert.strictEqual(
    hiddenViolations.length,
    0,
    `Reaparecen alimentos ocultos: ${hiddenViolations.slice(0, 10).join("; ")}`,
  );
  assert.strictEqual(
    orderViolations.length,
    0,
    `Duplicar cantidad altera el orden sin cambiar el estado de ración: ` +
      orderViolations.slice(0, 10).join("; "),
  );
  assert.strictEqual(
    guidanceViolations.length,
    0,
    `Una opción ocasional adelanta a una preferente de calidad comparable: ` +
      guidanceViolations.slice(0, 10).join("; "),
  );

  console.log(
    `PASS C13-metamórfico: ${core.length} orígenes, ${comparisons} pares estables, ` +
      `${hiddenChecked} tarjetas sin ocultos y ${guidancePairs} pares de guía controlados`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
