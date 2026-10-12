// function/index.js - landing status logic. Pair: ../index.html <-> Backend/function/health.php.
// Purpose in plain words: on load it calls getHealth() from ../js/api.js, then writes the result
// into <div id="status">. Success example: "Connected: db=gamehub_2_0 ping=ok healthcheck_count=1"
// (green). Fail example: "Not connected: Failed to fetch (is php -S localhost:8000 running?)" (red).
// The Retry button simply runs refresh() again.
async function refresh() {
  const el = document.getElementById("status");
  el.textContent = "Checking...";
  el.className = "";
  try {
    const data = await getHealth();
    el.textContent = `Connected: db=${data.db} ping=${data.ping} healthcheck_count=${data.healthcheck_count}`;
    el.className = "ok";
  } catch (e) {
    el.textContent = `Not connected: ${e.message} (is php -S localhost:8000 running?)`;
    el.className = "err";
  }
}
document.getElementById("retry").addEventListener("click", refresh);
refresh();
