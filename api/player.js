export default async function handler(req, res) {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: "Missing query" });
  }

  try {
    const r = await fetch(
      `https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=${encodeURIComponent(q)}`
    );

    const data = await r.json();

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "API error" });
  }
}
