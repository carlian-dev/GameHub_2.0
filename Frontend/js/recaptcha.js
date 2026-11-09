// js/recaptcha.js - config-driven Google reCAPTCHA v2 (checkbox).
// The admin Settings page owns the toggle and keys. Nothing loads from Google
// unless GET /api/config says reCAPTCHA is enabled with a site key, so local
// development and a disabled integration behave exactly as before.
//
// Usage (after js/config.js + js/api.js):
//   GameHubRecaptcha.render(document.getElementById("recaptchaSlot"));
//   const token = await GameHubRecaptcha.token(); // "" when disabled
//   GameHubRecaptcha.reset();                     // after a rejected submit
(function () {
  const SCRIPT_ID = "gh-recaptcha-script";
  let configPromise = null;
  let scriptPromise = null;
  let widgetId = null;
  let host = null;

  function normalize(data) {
    const recaptcha = data && data.integrations ? data.integrations.recaptcha : null;
    if (!recaptcha || recaptcha.enabled !== true) {
      return { enabled: false, siteKey: "" };
    }
    const siteKey = typeof recaptcha.siteKey === "string" ? recaptcha.siteKey.trim() : "";
    return siteKey ? { enabled: true, siteKey } : { enabled: false, siteKey: "" };
  }

  function config() {
    if (!configPromise) {
      configPromise = getAppConfig()
        .then(normalize)
        .catch(() => {
          // Transient failures must not pin the page to "disabled": the next
          // call retries instead of hiding the widget forever.
          configPromise = null;
          return { enabled: false, siteKey: "" };
        });
    }
    return configPromise;
  }

  function loadScript() {
    if (window.grecaptcha && typeof window.grecaptcha.render === "function") {
      return Promise.resolve();
    }
    if (scriptPromise) return scriptPromise;

    // A tag left behind by an earlier attempt tells us nothing: its load/error
    // event may already have fired before we attach listeners, which would
    // leave the promise pending forever. Replace it with a fresh load instead.
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) existing.remove();

    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
      script.async = true;
      script.defer = true;

      function fail() {
        script.remove();
        reject(new Error("reCAPTCHA is unavailable"));
      }

      script.onload = () => {
        if (window.grecaptcha && typeof window.grecaptcha.render === "function") {
          resolve();
        } else {
          fail();
        }
      };
      script.onerror = fail;
      document.head.appendChild(script);
    }).catch((err) => {
      // Never cache a failure: the next render() may retry the load.
      scriptPromise = null;
      throw err;
    });
    return scriptPromise;
  }

  function widgetTheme(el) {
    const wanted = el.dataset.recaptchaTheme;
    if (wanted === "dark" || wanted === "light") return wanted;
    return document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  }

  async function render(el) {
    if (!el) return false;
    host = el;
    const cfg = await config();
    if (!cfg.enabled) {
      el.hidden = true;
      return false;
    }
    try {
      await loadScript();
      await new Promise((resolve) => window.grecaptcha.ready(resolve));
      if (widgetId === null) {
        // The container must be visible before Google measures it.
        el.hidden = false;
        widgetId = window.grecaptcha.render(el, {
          sitekey: cfg.siteKey,
          theme: widgetTheme(el),
        });
      }
      el.hidden = false;
      return true;
    } catch (e) {
      // A blocked/failed widget must not break the form; the server still
      // enforces the token if the integration is enabled.
      el.hidden = true;
      if (window.console && console.warn) {
        console.warn("[gamehub] reCAPTCHA could not be loaded:", e && e.message ? e.message : e);
      }
      return false;
    }
  }

  /** Current widget response, or "" when disabled / not rendered yet. */
  async function token() {
    const cfg = await config();
    if (!cfg.enabled) return "";
    if (widgetId === null || !window.grecaptcha) return "";
    try {
      return window.grecaptcha.getResponse(widgetId) || "";
    } catch {
      return "";
    }
  }

  function reset() {
    if (widgetId === null || !window.grecaptcha) return;
    try {
      window.grecaptcha.reset(widgetId);
    } catch {
      /* widget already gone */
    }
  }

  window.GameHubRecaptcha = { config, render, token, reset };
})();
