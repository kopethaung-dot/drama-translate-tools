// Cloudflare Worker — receives PUT requests from the Cloud Function and
// writes the file into the R2 bucket, then returns its public URL.
// Bind an R2 bucket named SUBTITLE_BUCKET in the Worker's settings, and set
// an UPLOAD_SECRET environment variable that matches R2_WORKER_SECRET in
// the Cloud Functions config. Set PUBLIC_BASE_URL to your R2 public bucket
// URL or custom domain (e.g. https://videos.yourdomain.com).

export default {
  async fetch(request, env) {
    if (request.method !== "PUT") {
      return new Response("Method not allowed", { status: 405 });
    }

    const secret = request.headers.get("X-Upload-Secret");
    if (secret !== env.UPLOAD_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!key) return new Response("Missing key", { status: 400 });

    await env.SUBTITLE_BUCKET.put(key, request.body, {
      httpMetadata: {
        contentType: request.headers.get("Content-Type") || "application/octet-stream",
      },
    });

    const publicUrl = `${env.PUBLIC_BASE_URL}/${key}`;
    return new Response(JSON.stringify({ url: publicUrl }), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
