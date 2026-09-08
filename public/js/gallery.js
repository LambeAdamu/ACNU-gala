/* Gala & Awards 2027 — ACNU payment platform. gallery.js: virtual tour. Created fresh on 2026-09-01. */

/* Scroll the virtual tour through the "Quelques images de la dernière
 * édition" reel. Autoplay pauses on hover/focus/visibility/reduced-motion;
 * every control is operable by keyboard. */

(function () {
  const root = document.getElementById("tour");
  if (!root) return;

  const slides = Array.from(root.querySelectorAll(".tour__slide"));
  const thumbs = Array.from(root.querySelectorAll(".tour__thumb"));
  const counter = document.getElementById("tourStatus");
  const prev = document.getElementById("tourPrev");
  const next = document.getElementById("tourNext");
  const play = document.getElementById("tourPlay");

  let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let index = 0;
  let timer = null;
  let autoplay = !reduced;

  const setActive = (i) => {
    index = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle("is-active", k === index));
    thumbs.forEach((t, k) => {
      t.classList.toggle("is-active", k === index);
      t.setAttribute("aria-current", k === index ? "true" : "false");
    });
    if (counter) counter.textContent = `${String(index + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`;
  };

  const start = () => {
    stop();
    if (autoplay && !reduced) timer = setInterval(() => setActive(index + 1), 5200);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  if (play) {
    play.addEventListener("click", () => {
      autoplay = !autoplay;
      renderPlay();
      autoplay ? start() : stop();
    });
  }
  const renderPlay = () => {
    if (!play) return;
    play.innerHTML = autoplay
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none"/></svg>';
    play.setAttribute("aria-label", autoplay ? "Mettre en pause la visite" : "Lancer la visite automatique");
    play.setAttribute("aria-pressed", String(!autoplay));
  };

  if (prev) prev.addEventListener("click", () => { setActive(index - 1); start(); });
  if (next) next.addEventListener("click", () => { setActive(index + 1); start(); });

  thumbs.forEach((t, k) => t.addEventListener("click", () => { setActive(k); start(); }));

  // Pause while hovering or focused (WAI carousel guidance)
  root.addEventListener("focusin", stop);
  root.addEventListener("focusout", () => {
    if (document.hasFocus() && !root.matches(":hover")) start();
  });
  root.addEventListener("mouseenter", stop);
  root.addEventListener("mouseleave", start);

  // Pause when offscreen / hidden tab
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));

  // Keyboard: arrows when the panel has focus
  root.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); setActive(index - 1); start(); }
    if (e.key === "ArrowRight") { e.preventDefault(); setActive(index + 1); start(); }
  });

  // Honour reduced-motion toggled live
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const onMq = (e) => {
    reduced = e.matches || reduced;
    if (reduced) {
      autoplay = false;
      stop();
      renderPlay();
      setActive(index); // render final static state
    }
  };
  if (mq.addEventListener) mq.addEventListener("change", onMq);

  renderPlay();
  setActive(0);
  start();
})();