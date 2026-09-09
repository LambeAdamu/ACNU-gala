export default function handler() {
  return new Response("min-ok:" + Date.now(), { headers: { "content-type": "text/plain" } });
}