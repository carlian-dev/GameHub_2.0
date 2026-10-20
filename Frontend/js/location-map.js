// js/location-map.js - config-driven Google Maps embed on the landing page.
// The admin API owns the toggle: when Google Maps is disabled (or /api/config
// fails), the host stays hidden and no Maps request is made.
(function () {
  const host = document.getElementById("mapFrame");
  if (!host) return;

  const COORDS = "8.1530406,125.1300626";

  async function init() {
    try {
      const data = await getAppConfig();
      const maps = data && data.integrations ? data.integrations.googleMaps : null;
      if (!maps || !maps.enabled) return;
      const key = typeof maps.apiKey === "string" ? maps.apiKey.trim() : "";
      const src = key
        ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${COORDS}&zoom=18`
        : `https://www.google.com/maps?q=${COORDS}&z=18&output=embed`;

      const iframe = document.createElement("iframe");
      iframe.src = src;
      iframe.loading = "lazy";
      iframe.title = "GameHub location map";
      iframe.referrerPolicy = "no-referrer-when-downgrade";
      iframe.allowFullscreen = true;
      host.appendChild(iframe);
      host.hidden = false;
    } catch {
      host.hidden = true;
    }
  }

  init();
})();
