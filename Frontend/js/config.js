// GameHub_2.0 config - the ONLY place storing the Backend address.
// Purpose in plain words: if you move Backend to another port or computer,
// you change it HERE once instead of in every file.
// Example: Express on port 8001 -> const API_BASE_URL = "http://localhost:8001";
// All files in api.js use this variable via `${API_BASE_URL}/api/...`.
const API_BASE_URL = "http://localhost:8000";
