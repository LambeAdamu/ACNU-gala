/* Gala & Awards 2027 — ACNU payment platform. main.js: shared init/wiring. Created fresh on 2026-09-01. */

/* ------------------------------------------------------------------
 * Store: tiny localStorage layer shared by user flow and admin console.
 * Key shape: { id, ref, paynum, name, email, tel, purpose, amount,
 *              createdAt, status: pending|approved|rejected, decidedBy, decidedAt }
 * ------------------------------------------------------------------ */
const AcnuStore = {
  KEY: "acnu_payment_tx_v1",
  read() {
    try {
      const raw = localStorage.getItem(this.KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },
  write(list) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  },
  add(tx) {
    const list = this.read();
    list.unshift(tx);
    const ok = this.write(list);
    this.emit();
    return ok;
  },
  update(id, patch) {
    const list = this.read().map((t) => (t.id === id ? { ...t, ...patch } : t));
    this.write(list);
    this.emit();
    return list.find((t) => t.id === id);
  },
  find(id) {
    return this.read().find((t) => t.id === id);
  },
  listen(fn) {
    (this._listeners = this._listeners || []).push(fn);
    return () => { this._listeners = this._listeners.filter((f) => f !== fn); };
  },
  emit() {
    (this._listeners || []).forEach((fn) => fn(this.read()));
  },
  uid(prefix, len) {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let s = "";
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return prefix + s;
  },
};

/* ------------------------------------------------------------------
 * Toast feedback (aria-live polite; never steals focus)
 * ------------------------------------------------------------------ */
const Toast = {
  show(message, type = "info", ms = 4200) {
    const box = document.getElementById("toasts") || this._ensureBox();
    const t = document.createElement("div");
    t.className = `toast toast--${type}`;
    t.setAttribute("role", "status");
    const icon =
      type === "ok"
        ? "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        : type === "err"
        ? "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        : "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z";
    t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icon}"/></svg><span></span>`;
    t.querySelector("span").textContent = message;
    box.appendChild(t);
    setTimeout(() => {
      t.classList.add("is-leaving");
      setTimeout(() => t.remove(), 260);
    }, ms);
  },
  _ensureBox() {
    const box = document.createElement("div");
    box.className = "toasts";
    box.id = "toasts";
    box.setAttribute("aria-live", "polite");
    document.body.appendChild(box);
    return box;
  },
};

/* ------------------------------------------------------------------
 * Header: transparent→scrolled + mobile nav toggle
 * ------------------------------------------------------------------ */
function initHeader() {
  const header = document.querySelector(".header");
  if (header) {
    const onScroll = () => header.classList.toggle("header--scrolled", window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  const toggle = document.getElementById("navToggle");
  const nav = document.getElementById("nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
    });
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a")) {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
  }
}

/* ------------------------------------------------------------------
 * Autonumber / format helpers
 * ------------------------------------------------------------------ */
const FMT = {
  money(n) {
    return Number(n).toLocaleString("fr-FR").replace(/\u202f/g, " ") + " FCFA";
  },
  time(iso) {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  },
};

/* ------------------------------------------------------------------
 * Reveal on scroll (IntersectionObserver; static under reduced motion)
 * ------------------------------------------------------------------ */
function initReveal() {
  const items = document.querySelectorAll("[data-reveal]");
  if (!items.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    items.forEach((el) => el.classList.add("is-in"));
    return;
  }
  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add("is-in");
          obs.unobserve(en.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  items.forEach((el) => obs.observe(el));
}

/* ------------------------------------------------------------------
 * FAQ accordion
 * ------------------------------------------------------------------ */
function initFaq() {
  document.querySelectorAll(".faq__item").forEach((item) => {
    const q = item.querySelector(".faq__q");
    const a = item.querySelector(".faq__a");
    if (!q || !a) return;
    q.addEventListener("click", () => {
      const open = item.getAttribute("data-open") === "true";
      if (open) {
        item.setAttribute("data-open", "false");
        a.style.maxHeight = "0px";
        q.setAttribute("aria-expanded", "false");
      } else {
        item.setAttribute("data-open", "true");
        a.style.maxHeight = a.scrollHeight + "px";
        q.setAttribute("aria-expanded", "true");
      }
    });
    q.setAttribute("aria-expanded", item.getAttribute("data-open") === "true");
    if (item.getAttribute("data-open") === "true") {
      a.style.maxHeight = a.scrollHeight + "px";
    }
  });
}

/* ------------------------------------------------------------------
 * Payment section: hidden until a [data-pay-cta] link reveals it
 * ------------------------------------------------------------------ */
function initPaiement() {
  const pay = document.getElementById("paiement");
  if (!pay) return;

  const reveal = (e) => {
    const link = e.target.closest("[data-pay-cta]");
    if (!link) return;
    if (pay.hidden) {
      e.preventDefault();
      revealPay();
    }
  };

  function revealPay() {
    if (!pay.hidden) return;
    pay.hidden = false;
    requestAnimationFrame(() => {
      const revealEls = pay.querySelectorAll("[data-reveal]");
      revealEls.forEach((el) => el.classList.add("is-in"));
      pay.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (window.location.hash === "#paiement") revealPay();

  document.addEventListener("click", reveal);
}

document.addEventListener("DOMContentLoaded", () => {
  initHeader();
  initReveal();
  initFaq();
  initPaiement();
});