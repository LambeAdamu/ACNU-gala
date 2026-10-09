/* ------------------------------------------------------------------
 * Hero media: progressive enhancement.
 * Does nothing unless [data-hero-media] carries a non-empty
 * data-video-src. Users who prefer reduced motion keep the poster.
 * ------------------------------------------------------------------ */
(function () {
  "use strict";

  function init() {
    const host = document.querySelector("[data-hero-media]");
    if (!host) return;

    const src = (host.getAttribute("data-video-src") || "").trim();
    if (!src) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const poster = host.getAttribute("data-poster") || "";
    const video = document.createElement("video");
    video.className = "hero__video";
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.setAttribute("tabindex", "-1");
    if (poster) video.poster = poster;
    video.src = src;
    host.appendChild(video);
    host.classList.add("is-video");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
