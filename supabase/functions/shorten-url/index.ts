Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
      },
    });
  }

  try {
    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'url requerida' }), { status: 400 });
    }

    const res = await fetch(
      `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`,
      { headers: { 'User-Agent': 'ortopedia-caseros/1.0' } }
    );

    if (res.ok) {
      const short = (await res.text()).trim();
      if (short.startsWith('https://is.gd/')) {
        return new Response(JSON.stringify({ url: short }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // Fallback: devolver la URL original si is.gd falla
    return new Response(JSON.stringify({ url }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
