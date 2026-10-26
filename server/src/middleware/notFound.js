export function notFound(req, res) {
  res.status(404).json({ ok: false, error: "Not found", path: req.path });
}
