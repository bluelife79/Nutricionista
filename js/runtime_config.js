(function initRuntimeConfig(global) {
  "use strict";

  const defaults = Object.freeze({
    release: "premium-v2.5-rc-1",
    semanticEmbeddingsEnabled: true,
    remoteRerankEnabled: false,
    llmJudgeEnabled: false,
    familyFirstEnabled: false,
    resultBatchSize: 8,
    familyVisibleLimit: 6,
    preparedVisibleLimit: 8,
  });

  const overrides =
    global.REVOLUCIONAT_RUNTIME_OVERRIDES &&
    typeof global.REVOLUCIONAT_RUNTIME_OVERRIDES === "object"
      ? global.REVOLUCIONAT_RUNTIME_OVERRIDES
      : {};
  const config = Object.freeze({ ...defaults, ...overrides });

  global.REVOLUCIONAT_RUNTIME_CONFIG = config;
  global.SEMANTIC_EMBEDDINGS_ENABLED =
    config.semanticEmbeddingsEnabled !== false;
  global.RERANK_ENABLED = config.remoteRerankEnabled === true;
  global.LLM_JUDGE_ENABLED = config.llmJudgeEnabled === true;
})(typeof window !== "undefined" ? window : globalThis);
