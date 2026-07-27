(function initAnonymousTelemetry(global) {
  "use strict";

  var OPT_OUT_KEY = "revolucionat_telemetry_optout";
  var resultsShown = false;
  var resultInteraction = false;

  function enabled() {
    try {
      return global.localStorage.getItem(OPT_OUT_KEY) !== "1";
    } catch {
      return false;
    }
  }

  function track(eventName, payload) {
    if (!enabled()) return;
    var body = JSON.stringify({
      event: String(eventName || ""),
      payload: payload && typeof payload === "object" ? payload : {},
    });
    try {
      fetch("/api/telemetry", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true,
      }).catch(function () {});
    } catch {}
  }

  global.trackAnonymousEvent = track;
  global.setAnonymousTelemetryEnabled = function (value) {
    try {
      if (value) global.localStorage.removeItem(OPT_OUT_KEY);
      else global.localStorage.setItem(OPT_OUT_KEY, "1");
    } catch {}
  };
  global.isAnonymousTelemetryEnabled = enabled;
  global.markAnonymousResultsShown = function () {
    resultsShown = true;
    resultInteraction = false;
  };
  global.markAnonymousResultInteraction = function () {
    resultInteraction = true;
  };

  global.addEventListener("pagehide", function () {
    if (!enabled() || !resultsShown || resultInteraction) return;
    var body = JSON.stringify({ event: "abandon", payload: {} });
    try {
      navigator.sendBeacon(
        "/api/telemetry",
        new Blob([body], { type: "application/json" }),
      );
    } catch {}
  });
})(typeof window !== "undefined" ? window : globalThis);
