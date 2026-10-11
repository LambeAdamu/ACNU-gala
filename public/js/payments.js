/* Gala & Awards 2027 — ACNU payment platform. payments.js: continuous user payment form.
 * Replaces the old 4-step wizard with a single scrolling form supporting multi-ticket purchase. */

(function () {
  const root = document.getElementById("payApp");
  if (!root) return;

  const TIERS = {
    premium: { label: "Premium", price: 300000, max: 5 },
    vip: { label: "VIP", price: 25000, max: 100 },
    classic: { label: "Classique", price: 15000, max: 160 },
  };

  const PAY_METHODS = {
    momomo: { label: "Mobile Money (MoMo)", number: "678613421", name: "BUZUAH STELMON-LYDIA" },
    orange: { label: "Orange Money (OM)", number: "686410795", name: "Virginie Florence" },
  };
  let selectedPay = "momomo";
  const TIER_ORDER = ["premium", "vip", "classic"];
  const participantCache = {}; // key like "premium:0" -> entered name

  const form = document.getElementById("payForm");
  const box = document.getElementById("payBox");
  const done = document.getElementById("payDone");

  const getQty = (tier) => {
    const input = document.getElementById("qty-" + tier);
    if (!input) return 0;
    const n = parseInt(input.value, 10);
    if (Number.isNaN(n)) return 0;
    return Math.min(Math.max(n, 0), TIERS[tier].max);
  };

  const setQty = (tier, value) => {
    const input = document.getElementById("qty-" + tier);
    if (!input) return;
    const clamped = Math.min(Math.max(Math.round(value) || 0, 0), TIERS[tier].max);
    input.value = clamped;
    input.dispatchEvent(new Event("change"));
  };

  const totalQty = () => TIER_ORDER.reduce((s, t) => s + getQty(t), 0);

  const totalAmount = () => TIER_ORDER.reduce((s, t) => s + getQty(t) * TIERS[t].price, 0);

  /* ---- live total ---- */
  function updateTotal() {
    const el = document.getElementById("payTotal");
    if (el) el.textContent = FMT.money(totalAmount());
    refreshParticipants();
  }

  /* ---- participant name fields ---- */
  function refreshParticipants() {
    const listEl = document.getElementById("participantsList");
    const section = document.getElementById("participantsSection");
    if (!listEl || !section) return;

    const html = [];
    TIER_ORDER.forEach((tier) => {
      for (let i = 0; i < getQty(tier); i++) {
        const key = tier + ":" + i;
        html.push(
          `<div class="participant-field">
            <span class="participant-field__label">Nom — ${TIERS[tier].label} ${i + 1}</span>
            <input type="text" class="participant-name" data-name-key="${key}" autocomplete="off" placeholder="Nom du participant ${i + 1}">
          </div>`
        );
      }
    });

    if (!html.length) {
      listEl.innerHTML =
        `<p class="form-section__hint">Sélectionnez au moins un billet à l'étape 2 pour saisir les noms des participants.</p>`;
      section.hidden = true;
      return;
    }

    listEl.innerHTML = html.join("");
    section.hidden = false;
    listEl.querySelectorAll(".participant-name").forEach((input) => {
      input.value = participantCache[input.dataset.nameKey] || "";
      input.addEventListener("input", () => {
        participantCache[input.dataset.nameKey] = input.value;
      });
    });
  }

  /* ---- quantity steppers ---- */
  root.querySelectorAll("[data-qty]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".qty-item");
      const tier = item ? item.dataset.tier : null;
      if (!tier) return;
      const delta = btn.dataset.qty === "plus" ? 1 : -1;
      setQty(tier, getQty(tier) + delta);
    });
  });
  root.querySelectorAll(".qty-list input[type='number']").forEach((input) => {
    input.addEventListener("change", () => {
      const item = input.closest(".qty-item");
      const tier = item ? item.dataset.tier : null;
      if (!tier) return;
      const n = parseInt(input.value, 10);
      if (Number.isNaN(n) || n < 0) {
        input.value = 0;
        updateTotal();
        return;
      }
      if (n > TIERS[tier].max) {
        input.value = TIERS[tier].max;
        setErr("qty-" + tier, "Maximum disponible : " + TIERS[tier].max + ".");
        updateTotal();
        return;
      }
      input.value = n;
      updateTotal();
    });
  });

  /* ---- payment method selection + copy ---- */
  root.querySelectorAll('input[name="payMethod"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      selectedPay = radio.value;
      root.querySelectorAll(".pay-method").forEach((card) => {
        const input = card.querySelector('input[name="payMethod"]');
        card.classList.toggle("is-selected", !!input && input.checked);
      });
    });
  });

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.copy);
      if (!target) return;
      const value = target.dataset.raw || target.textContent.replace(/\D/g, "");
      (navigator.clipboard ? navigator.clipboard.writeText(value) : Promise.reject())
        .then(() => Toast.show("Numéro copié.", "ok"))
        .catch(() => Toast.show("Numéro copié.", "ok"));
    });
  });

  /* ---- error helpers ---- */
  const setErr = (id, msg) => {
    const field = root.querySelector(`.field[data-err="${id}"]`);
    if (!field) return;
    field.classList.add("has-error");
    const t = field.querySelector(".error-text");
    if (t) t.textContent = msg || "";
  };
  const clearErr = (id) => {
    const field = root.querySelector(`.field[data-err="${id}"]`);
    if (field) field.classList.remove("has-error");
  };

  /* ---- proof upload ---- */
  const MAX_PROOF_BYTES = 8 * 1024 * 1024; // 8 MB — keep in sync with api/orders.js
  const uploadZone = document.getElementById("uploadZone");
  const fileInput = document.getElementById("f-proof");
  uploadZone.addEventListener("click", () => fileInput.click());
  uploadZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", () => {
    const f = fileInput.files[0];
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)|application\/pdf/.test(f.type)) {
      setErr("proof", "Format accepté : image (PNG/JPG/WebP) ou PDF.");
      fileInput.value = "";
      return;
    }
    if (f.size > MAX_PROOF_BYTES) {
      setErr("proof", "Fichier trop volumineux (max 8 Mo).");
      fileInput.value = "";
      return;
    }
    clearErr("proof");
    const prev = document.getElementById("filePreview");
    prev.hidden = false;
    prev.querySelector(".file-preview__name").textContent = f.name;
    prev.querySelector(".file-preview__size").textContent = (f.size / 1024).toFixed(0) + " Ko";
    uploadZone.classList.add("has-file");
  });

  /* ---- buy more tickets (reset to a fresh form) ---- */
  function resetForm() {
    const buyer = document.getElementById("f-buyer");
    const tel = document.getElementById("f-tel");
    const email = document.getElementById("f-email");
    if (buyer) buyer.value = "";
    if (tel) tel.value = "";
    if (email) email.value = "";

    // clear participant cache + names
    Object.keys(participantCache).forEach((k) => delete participantCache[k]);

    // reset quantities to 0 (setQty cascades refreshParticipants + total)
    TIER_ORDER.forEach((tier) => setQty(tier, 0));

    // reset proof upload
    fileInput.value = "";
    const preview = document.getElementById("filePreview");
    if (preview) preview.hidden = true;
    uploadZone.classList.remove("has-file");

    // reset payment method to the default (Mobile Money)
    selectedPay = "momomo";
    root.querySelectorAll('input[name="payMethod"]').forEach((radio) => {
      radio.checked = radio.value === selectedPay;
      const card = radio.closest(".pay-method");
      if (card) card.classList.toggle("is-selected", radio.checked);
    });

    // clear any visible error states
    ["buyer", "tel", "email", ...TIER_ORDER.map((t) => "qty-" + t), "proof"].forEach((id) => clearErr(id));

    box.hidden = false;
    done.hidden = true;
  }

  const resetBtn = document.getElementById("payReset");
  if (resetBtn) resetBtn.addEventListener("click", resetForm);
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const buyer = document.getElementById("f-buyer").value.trim();
    const tel = document.getElementById("f-tel").value.trim();
    const email = document.getElementById("f-email").value.trim();
    const proofFile = fileInput.files[0];

    let ok = true;
    if (buyer.length < 3) { setErr("buyer", "Veuillez indiquer le nom de l'acheteur."); ok = false; } else clearErr("buyer");
    if (tel.replace(/\D/g, "").length < 8) { setErr("tel", "Numéro de téléphone invalide."); ok = false; } else clearErr("tel");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setErr("email", "Adresse e-mail invalide."); ok = false; } else clearErr("email");

    if (totalQty() === 0) {
      Toast.show("Veuillez sélectionner au moins un billet.", "err");
      ok = false;
    } else {
      TIER_ORDER.forEach((tier) => {
        if (getQty(tier) > TIERS[tier].max) { setErr("qty-" + tier, "Quantité supérieure à la disponibilité."); ok = false; }
        else clearErr("qty-" + tier);
      });
    }

    // all participant fields must be filled when tickets are selected
    const names = [];
    if (totalQty() > 0) {
      let allFilled = true;
      TIER_ORDER.forEach((tier) => {
        for (let i = 0; i < getQty(tier); i++) {
          const key = tier + ":" + i;
          const v = (participantCache[key] || "").trim();
          names.push({ tier, key, name: v });
          if (v.length < 2) allFilled = false;
        }
      });
      if (!allFilled) {
        Toast.show("Veuillez renseigner le nom de chaque participant.", "err");
        ok = false;
      }
    }

    if (!proofFile) { setErr("proof", "Veuillez joindre la preuve de paiement (screenshot / reçu)."); ok = false; }
    else clearErr("proof");

    if (!ok) return;

    const now = new Date();
    const iso = now.toISOString();
    const buyerKey = (email.toLowerCase() + "|" + iso).toLowerCase();

    const tickets = TIER_ORDER
      .filter((t) => getQty(t) > 0)
      .map((t) => ({ tier: t, qty: getQty(t) }));

    // dominant tier for the admin "Billet" column
    let dominant = tickets[0] ? tickets[0].tier : "";
    TIER_ORDER.forEach((t) => {
      const q = getQty(t);
      const dq = getQty(dominant);
      if (q > 0 && (dominant === "" || q > dq || (q === dq && TIER_ORDER.indexOf(t) < TIER_ORDER.indexOf(dominant)))) dominant = t;
    });

    const tx = {
      id: AcnuStore.uid("TX-", 6),
      buyerKey: buyerKey,
      buyerName: buyer,
      name: buyer,
      email: email,
      tel: tel,
      tickets: tickets,
      qty: totalQty(),
      tier: dominant,
      participants: names,
      amount: totalAmount(),
      payMethod: selectedPay,
      payNum: PAY_METHODS[selectedPay].number,
      payDate: now.toISOString().slice(0, 10),
      ref: PAY_METHODS[selectedPay].label + " " + PAY_METHODS[selectedPay].number,
      proof: proofFile.name,
      proofSize: proofFile.size,
      proofUrl: "",
      proofPublicId: "",
      createdAt: iso,
      status: "pending",
      decidedBy: "",
      decidedAt: "",
    };

    const btn = document.getElementById("paySubmit");
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin" aria-hidden="true"></span> Envoi en cours…';

    (async () => {
      let proof;
      try {
        proof = await uploadToCloudinary(proofFile);
      } catch (e) {
        console.error("proof upload failed:", e);
        btn.disabled = false;
        btn.innerHTML = orig;
        Toast.show("Téléversement de la preuve impossible. Réessayez avant de valider.", "err");
        return;
      }
      tx.proofUrl = proof.url;
      tx.proofPublicId = proof.publicId;

      const saved = await saveOrder(tx);
      btn.disabled = false;
      btn.innerHTML = orig;
      if (saved.ok) {
        box.hidden = true;
        done.hidden = false;
        done.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        console.error("orders POST rejected:", saved.error);
        Toast.show(saved.error || "Impossible d'enregistrer la commande. Réessayez.", "err");
      }
    })();
  });

  /* ---- Cloudinary direct upload (browser → api.cloudinary.com) ---- */
  async function uploadToCloudinary(file) {
    const cfg = window.CloudConfig || {};
    if (!cfg.cloudName || !cfg.unsignedPreset) {
      throw new Error("Cloudinary non configuré (cloudName / unsignedPreset manquants)");
    }
    if (!file || file.size > MAX_PROOF_BYTES) {
      throw new Error("Fichier trop volumineux (max 8 Mo).");
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", cfg.unsignedPreset);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch("https://api.cloudinary.com/v1_1/" + cfg.cloudName + "/auto/upload", {
        method: "POST",
        body: fd,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("Cloudinary HTTP " + res.status);
      const data = await res.json();
      if (!data || !data.secure_url) throw new Error("Réponse Cloudinary invalide");
      return { url: data.secure_url, publicId: data.public_id || "" };
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---- save order to the Postgres-backed API ---- */
  async function saveOrder(payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "Erreur serveur (" + res.status + ")." };
      return { ok: true, id: data.id };
    } finally {
      clearTimeout(timer);
    }
  }

  updateTotal();
})();
