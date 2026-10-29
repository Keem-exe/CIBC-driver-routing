// Shared plumbing for the serverless functions in /api.
export const endpoint = (methods, fn) => async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!methods.includes(req.method)) {
    res.setHeader("Allow", methods.join(", "));
    return res.status(405).json({ error: `Use ${methods.join(" or ")}` });
  }
  try {
    const input = req.method === "GET" ? req.query : (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {});
    res.status(200).json(await fn(input));
  } catch (e) {
    const status = e.status ?? (e instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error(e);
    res.status(status).json({ error: status >= 500 ? "Internal error" : e.message });
  }
};
