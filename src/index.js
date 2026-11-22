// SturmKnoten 2027 – server-side entry point.
// Public placeholder assets are served by Cloudflare's static-assets layer.
// No customer APIs are enabled until authentication and authorization exist.
export default {
  async fetch() {
    return new Response("Nicht gefunden", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
};
