/* Gala & Awards 2027 — ACNU payment platform. admin.js: verification console (Firebase auth + Firestore). Created on 2026-09-01. */

/* Implements the ADMIN flow:
 *   Login (email + password) → view pending payments → open transaction →
 *   check proof → approve or reject → recorded decision → user status updates. */

(function () {
  const gate = document.getElementById("gate");
  const app = document.getElementById("adminApp");
  if (!gate || !app) return;

  const email = document.getElementById("gateEmail");
  const password = document.getElementById("gatePass");
  const gateBtn = document.getElementById("gateSubmit");
  const gateHint = document.getElementById("gateHint");
  const logoutBtn = document.getElementById("logoutBtn");
  const whoAmI = document.getElementById("whoAmI");

  const passToggle = document.getElementById("gatePassToggle");
  if (passToggle && password) {
    passToggle.addEventListener("click", () => {
      const show = password.type === "password";
      password.type = show ? "text" : "password";
      passToggle.setAttribute("aria-pressed", String(show));
      passToggle.setAttribute("aria-label", show ? "Masquer le mot de passe" : "Afficher le mot de passe");
      const eye = passToggle.querySelector(".icon-eye");
      const eyeOff = passToggle.querySelector(".icon-eye-off");
      if (eye) eye.hidden = show;
      if (eyeOff) eyeOff.hidden = !show;
      password.focus();
    });
  }

  const tab = document.getElementById("txRows");
  const total = document.getElementById("statTotal");
  const pending = document.getElementById("statPending");
  const ok = document.getElementById("statOk");
  const rej = document.getElementById("statRej");

  const tierLabel = { premium: "Premium", vip: "VIP", classic: "Classique" };
  const methodLabel = { mtn: "MoMo MTN", orange: "MoMo Orange", virement: "Virement / Agence", momomo: "Mobile Money (MoMo)" };
  let currentList = [];

  /* ---- auth lifecycle --------------------------------- */
  let unsubscribe = null;

  const unlock = (user) => {
    gate.hidden = true;
    app.hidden = false;
    logoutBtn.hidden = false;
    whoAmI.textContent = "Connecté : " + user.email;
    renderAll();
    if (!unsubscribe) unsubscribe = TxApi.observe(renderAll);
  };

  const lock = (msg) => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    gate.hidden = false;
    app.hidden = true;
    logoutBtn.hidden = true;
    whoAmI.textContent = "";
    if (msg) {
      gateHint.hidden = false;
      gateHint.querySelector("span").textContent = msg;
    }
  };

  TxApi.onAuth((user) => {
    if (user) unlock(user); else lock();
  });

  gateBtn.addEventListener("click", async () => {
    gateHint.hidden = true;
    const em = email.value.trim();
    const pw = password.value;
    if (!em || !pw) {
      gateHint.hidden = false;
      gateHint.querySelector("span").textContent = "Email et mot de passe requis.";
      return;
    }
    gateBtn.disabled = true;
    gateBtn.innerHTML = '<span class="spin" aria-hidden="true"></span> Connexion…';
    try {
      await TxApi.signIn(em, pw);
    } catch (e) {
      const msg = authErrorMessage(e);
      gateHint.hidden = false;
      gateHint.querySelector("span").textContent = msg;
    } finally {
      gateBtn.disabled = false;
      gateBtn.innerHTML = "Se connecter";
    }
  });

  function authErrorMessage(e) {
    if (e && e.message === "non-autorise") return "Ce compte n'est pas autorisé à accéder à la console.";
    const code = (e && e.code) || "";
    switch (code) {
      case "auth/invalid-email": return "Adresse e-mail invalide.";
      case "auth/user-not-found": return "Aucun compte trouvé avec cet e-mail.";
      case "auth/wrong-password": return "Mot de passe incorrect.";
      case "auth/too-many-requests": return "Trop de tentatives. Réessayez plus tard.";
      case "auth/network-request-failed": return "Erreur réseau. Vérifiez que la page est servie en http(s), pas ouverte en fichier local (file://).";
      case "auth/invalid-credential": return "E-mail ou mot de passe incorrect.";
      default: return "Échec de connexion (" + (code || "inconnu") + "). Vérifiez la connexion Internet.";
    }
  }

  password.addEventListener("keydown", (e) => { if (e.key === "Enter") gateBtn.click(); });
  email.addEventListener("keydown", (e) => { if (e.key === "Enter") password.focus(); });

  logoutBtn.addEventListener("click", () => {
    TxApi.signOut().then(() => { password.value = ""; Toast.show("Déconnecté.", "ok"); });
  });

  /* ---- render ----------------------------------------- */
  function pill(status) {
    const map = { pending: ["pill--pending", "En attente"], approved: ["pill--approved", "Validée"], rejected: ["pill--rejected", "Rejetée"] };
    const [cls, label] = map[status] || map.pending;
    return `<span class="tx-status ${cls}">${label}</span>`;
  }

  function renderAll(list) {
    if (!list) return;
    currentList = list;
    total.textContent = list.length;
    pending.textContent = list.filter((t) => t.status === "pending").length;
    ok.textContent = list.filter((t) => t.status === "approved").length;
    rej.textContent = list.filter((t) => t.status === "rejected").length;

    if (!list.length) {
      tab.innerHTML = `<tr><td colspan="7"><div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
        <b>Aucune transaction</b>En attente de paiements soumis depuis la page Paiement.</div></td></tr>`;
      return;
    }

    tab.innerHTML = list
      .map((t) => {
        const proofSrc = t.proof && t.proofUrl ? "/api/proof/" + encodeURIComponent(t.id) : "";
        return `<tr>
        <td><b>${t.id}</b><br><small style="color:var(--ink-3)">${FMT.time(t.createdAt)}</small></td>
        <td>${t.name}<br><small style="color:var(--ink-3)">${t.email} · ${t.tel}</small></td>
        <td><small>${tierLabel[t.tier] || "—"}</small></td>
        <td><b style="color:var(--gold-2);white-space:nowrap">${FMT.money(t.amount)}</b><br>
          <small style="color:var(--ink-3)">${methodLabel[t.payMethod] || t.payMethod || "—"} · ${t.payDate || "—"}<br>Réf : ${t.ref || t.paynum}</small></td>
        <td>${proofSrc
          ? `<img class="tx-proof" src="${proofSrc}" alt="Preuve — ${t.id}" title="Cliquer pour agrandir" data-proof-url="${proofSrc}">`
          : `<small title="${t.proof || ''}">${t.proof ? t.proof.slice(0, 22) + (t.proof.length > 22 ? "…" : "") : "—"}</small>`}</td>
        <td>${pill(t.status)}</td>
        <td>${
          t.status === "pending"
            ? `<div class="tx-actions" role="group" aria-label="Décision pour ${t.id}">
                 <button class="btn btn--sm" data-view="${t.id}">Voir</button>
                 <button class="btn btn--sm btn--ok" data-decide="approved" data-id="${t.id}">Valider</button>
                 <button class="btn btn--sm btn--no" data-decide="rejected" data-id="${t.id}">Rejeter</button>
               </div>`
            : `<div class="tx-actions" role="group" aria-label="Actions pour ${t.id}">
                 <button class="btn btn--sm" data-view="${t.id}">Voir</button>
                 <small style="color:var(--ink-3)">${t.decidedBy} · ${t.decidedAt ? FMT.time(t.decidedAt) : ""}</small>
               </div>`
        }</td>
      </tr>`;
      })
      .join("");
  }

  /* ---- decide (shared by row buttons + modal) ---- */
  const decide = (id, decision, btn) => {
    const label = decision === "approved" ? "Valider" : "Rejeter";
    if (!window.confirm(`Confirmer la décision : ${label} la transaction ${id} ?`)) return Promise.resolve(false);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spin" aria-hidden="true"></span>';
    }
    return TxApi.update(id, {
      status: decision,
      decidedBy: TxApi.current() ? TxApi.current().email : "Admin ACNU",
      decidedAt: new Date().toISOString(),
    }).then(() => {
      Toast.show(
        decision === "approved" ? `${id} validée — statut utilisateur mis à jour.` : `${id} rejetée — statut utilisateur mis à jour.`,
        decision === "approved" ? "ok" : "err"
      );
      closeModal();
    });
  };

  /* ---- transaction detail modal ---- */
  const modal = document.getElementById("txModal");
  const modalApprove = document.getElementById("txModalApprove");
  const modalReject = document.getElementById("txModalReject");

  function fileType(name) {
    const ext = String(name || "").split(".").pop().toLowerCase();
    return { png: "PNG", jpg: "JPG", jpeg: "JPEG", webp: "WebP", pdf: "PDF" }[ext] || (ext ? ext.toUpperCase() : "");
  }

  function openModal(t) {
    if (!modal || !t) return;
    document.getElementById("txModalId").textContent = t.id;
    document.getElementById("txModalName").textContent = t.name || t.buyerName || "";
    document.getElementById("txModalContact").textContent = [t.email, t.tel].filter(Boolean).join(" · ");
    document.getElementById("txModalTier").textContent = tierLabel[t.tier] || "—";
    document.getElementById("txModalAmount").textContent = FMT.money(t.amount);
    document.getElementById("txModalMethod").textContent = methodLabel[t.payMethod] || t.payMethod || "—";
    document.getElementById("txModalRef").textContent =
      ["Réf : " + (t.ref || t.paynum || "—"), t.payDate || ""].filter(Boolean).join(" · ");
    document.getElementById("txModalStatus").innerHTML = pill(t.status);
    document.getElementById("txModalDate").textContent = FMT.time(t.createdAt);

    const doc = document.getElementById("txModalDoc");
    const docLabel = document.getElementById("txModalDocLabel");
    const proofName = t.proof || "preuve";
    const docUrl = t.proof && t.proofUrl ? "/api/proof/" + encodeURIComponent(t.id) : "";
    if (docUrl && proofName !== "preuve") {
      doc.href = docUrl;
      doc.classList.remove("doc-card--disabled");
      docLabel.textContent = `${proofName} · Preuve de paiement${fileType(proofName) ? " · " + fileType(proofName) : ""}`;
    } else if (docUrl) {
      doc.href = docUrl;
      doc.classList.remove("doc-card--disabled");
      docLabel.textContent = "Document joint · Preuve de paiement";
    } else {
      doc.href = "#";
      doc.classList.add("doc-card--disabled");
      docLabel.textContent = proofName ? `${proofName} · Preuve de paiement — image non disponible` : "Aucun document joint";
    }

    const canDecide = t.status === "pending";
    modalApprove.disabled = !canDecide;
    modalReject.disabled = !canDecide;
    modal.hidden = false;
  }

  function closeModal() {
    if (modal) modal.hidden = true;
  }

  tab.addEventListener("click", (e) => {
    const view = e.target.closest("[data-view]");
    if (view) {
      openModal(currentList.find((x) => x.id === view.dataset.view));
      return;
    }
    const btn = e.target.closest("[data-decide]");
    if (!btn) return;
    decide(btn.dataset.id, btn.dataset.decide, btn);
  });

  if (modal) {
    document.getElementById("txModalClose").addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    const doc = document.getElementById("txModalDoc");
    doc.addEventListener("click", (e) => {
      if (doc.classList.contains("doc-card--disabled")) e.preventDefault();
    });
    modalApprove.addEventListener("click", () => {
      const t = currentList.find((x) => x.id === document.getElementById("txModalId").textContent);
      if (t) decide(t.id, "approved");
    });
    modalReject.addEventListener("click", () => {
      const t = currentList.find((x) => x.id === document.getElementById("txModalId").textContent);
      if (t) decide(t.id, "rejected");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });
  }

  /* ---- proof lightbox ---- */
  const lightbox = document.getElementById("proofLightbox");
  const lightboxImg = document.getElementById("proofLightboxImg");
  if (lightbox && lightboxImg) {
    const openLightbox = (url) => {
      lightboxImg.src = url;
      lightbox.hidden = false;
    };
    const closeLightbox = () => {
      lightbox.hidden = true;
      lightboxImg.src = "";
    };
    tab.addEventListener("click", (e) => {
      const thumb = e.target.closest(".tx-proof");
      if (!thumb) return;
      openLightbox(thumb.dataset.proofUrl || thumb.src);
    });
    const closeBtn = document.getElementById("proofLightboxClose");
    if (closeBtn) closeBtn.addEventListener("click", closeLightbox);
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !lightbox.hidden) closeLightbox();
    });
  }

  TxApi.seed();
})();