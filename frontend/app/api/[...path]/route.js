export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function proxy(request, context) {
  const { path } = await context.params;
  const base = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
  const target = new URL('/' + path.map(encodeURIComponent).join('/'), base);
  target.search = request.nextUrl.search;
  const headers = new Headers();
  for (const name of ['cookie', 'content-type', 'origin', 'x-csrf-token']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'content-disposition', 'retry-after']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    for (const value of upstream.headers.getSetCookie())
      responseHeaders.append('set-cookie', value);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json(
      {
        error:
          'ShopFlow API is unavailable. Start the API and database, then retry the same request.',
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
