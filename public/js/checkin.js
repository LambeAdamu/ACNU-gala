/* Gala & Awards 2027 — ACNU. checkin.js: door presence console.
 * Firebase login (admin-compatible session behaviour) → live QR camera scanner
 * → staff-only ticket lookup/check-in → presence dashboard.
 * Every scan performs a fresh server call; ticket status is never cached. */

(function () {
  const gate = document.getElementById("gate");
  const app = document.getElementById("checkinApp");
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

  const codePattern = /^[0-9A-HJKMNP-TV-Z]{16}$/;
  const tierLabel = { premium: "Premium", vip: "VIP", classic: "Classic" };
  const statusLabel = { valid: "Valide", used: "Utilisé", revoked: "Annulé" };

  const rowsEl = document.getElementById("ticketRows");
  const filterPresence = document.getElementById("filterPresence");
  const filterTier = document.getElementById("filterTier");
  const filterCount = document.getElementById("filterCount");
  const loadError = document.getElementById("loadError");
  const statTotal = document.getElementById("statTotal");
  const statPresent = document.getElementById("statPresent");
  const statAbsent = document.getElementById("statAbsent");
  const tierClassic = document.getElementById("tierClassic");
  const tierVip = document.getElementById("tierVip");
  const tierPremium = document.getElementById("tierPremium");
  const refreshBtn = document.getElementById("refreshBtn");

  const scanOpen = document.getElementById("scanOpen");
  const scanModal = document.getElementById("scanModal");
  const scanClose = document.getElementById("scanClose");
  const scanCancel = document.getElementById("scanCancel");
  const scanStatus = document.getElementById("scanStatus");
  const scanVideo = document.getElementById("scanVideo");
  const scanCanvas = document.getElementById("scanCanvas");

  const ticketModal = document.getElementById("ticketModal");
  const ticketModalClose = document.getElementById("ticketModalClose");
  const ticketDoneBtn = document.getElementById("ticketDoneBtn");
  const ticketRevokedBanner = document.getElementById("ticketRevokedBanner");
  const ticketHolder = document.getElementById("ticketHolder");
  const ticketTier = document.getElementById("ticketTier");
  const ticketStatus = document.getElementById("ticketStatus");
  const ticketUsedAt = document.getElementById("ticketUsedAt");
  const ticketUsedBy = document.getElementById("ticketUsedBy");
  const ticketMsg = document.getElementById("ticketMsg");
  const ticketMarkBtn = document.getElementById("ticketMarkBtn");
  const ticketModalCode = document.getElementById("ticketModalCode");

  let currentUser = null;
  let refreshTimer = null;
  let activeTicket = null;
  let closeTimer = null;
  let scanStream = null;
  let scanActive = false;
  let scanTimer = null;
  let scanCanvasCtx = null;
  let lastCode = "";
  let lastCodeAt = 0;
  const POLL_MS = 30000;
  const SCAN_INTERVAL_MS = 180;
  const SAME_CODE_COOLDOWN_MS = 4000;

  const esc = (s) =>
    String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function staffToken() {
    if (!currentUser) return Promise.reject(new Error("non-autorise"));
    return currentUser.getIdToken(true);
  }

  function timeOnly(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Douala",
    }).format(date);
  }

  function dayTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Douala",
    }).format(date);
  }

  /* ---- REST plumbing --------------------------------- */
  async function apiGet(path) {
    const token = await staffToken();
    const res = await fetch(path, {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "Erreur serveur (" + res.status + ").");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function apiPost(path) {
    const token = await staffToken();
    const res = await fetch(path, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "Erreur serveur (" + res.status + ").");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ---- load-failure banner ---------------------------- */
  function showLoadError(code) {
    if (!loadError) return;
    loadError.hidden = false;
    loadError.innerHTML =
      '<span class="load-error__msg">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' +
      '<span>Impossible de charger les billets (' + esc(code) + ').</span></span>' +
      '<button type="button" class="btn btn--sm" id="loadRetry">Réessayer</button>';
    const retry = document.getElementById("loadRetry");
    if (retry) retry.addEventListener("click", () => refresh(false));
  }

  function hideLoadError() {
    if (!loadError) return;
    loadError.hidden = true;
    loadError.innerHTML = "";
  }

  function pill(status) {
    const key = statusLabel[status] ? status : "valid";
    return `<span class="tx-status pill--${key}">${statusLabel[key]}</span>`;
  }

  function renderSummary(summary) {
    const data = summary || { total: 0, byStatus: {}, byTier: {} };
    const byStatus = data.byStatus || {};
    statTotal.textContent = data.total || 0;
    statPresent.textContent = byStatus.used || 0;
    statAbsent.textContent = byStatus.valid || 0;
    const byTier = data.byTier || {};
    tierClassic.textContent = byTier.classic || 0;
    tierVip.textContent = byTier.vip || 0;
    tierPremium.textContent = byTier.premium || 0;
  }

  function renderRows(list) {
    if (!list || !list.length) {
      rowsEl.innerHTML = `<tr><td colspan="5"><div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
        <b>Aucun billet</b>Aucun billet ne correspond à ce filtre.</div></td></tr>`;
      return;
    }

    rowsEl.innerHTML = list
      .map((ticket) => {
        const used = ticket.usedAt
          ? `${esc(dayTime(ticket.usedAt))}${ticket.usedBy ? " · " + esc(ticket.usedBy) : ""}`
          : "—";
        return `<tr>
          <td><span class="ticket-code">${esc(ticket.code)}</span></td>
          <td>${esc(ticket.holderName)}</td>
          <td><small>${esc(ticket.tierLabel || tierLabel[ticket.tier] || ticket.tier)}</small></td>
          <td>${pill(ticket.status)}</td>
          <td><small style="color:var(--ink-3)">${used}</small></td>
        </tr>`;
      })
      .join("");
  }

  async function refresh(silent) {
    const params = new URLSearchParams();
    if (filterPresence.value) params.set("status", filterPresence.value);
    if (filterTier.value) params.set("tier", filterTier.value);
    const query = params.toString();
    try {
      const data = await apiGet("/api/tickets" + (query ? "?" + query : ""));
      hideLoadError();
      renderSummary(data.summary);
      renderRows(data.data);
      filterCount.textContent =
        (data.count || 0) + " billet(s) affiché(s)" + (data.capped ? " · limite atteinte" : "");
      return true;
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403)) {
        lock("Ce compte n'est pas autorisé au contrôle d'accès.");
        return false;
      }
      const code = (e && e.status) ? e.status : "réseau";
      console.error("tickets fetch failed (" + code + "):", e && e.message);
      showLoadError(code);
      if (!silent) Toast.show("Lecture des billets impossible. Vérifiez la connexion.", "err");
      return false;
    }
  }

  /* ---- auth lifecycle --------------------------------- */
  const unlock = (user) => {
    gate.hidden = true;
    app.hidden = false;
    logoutBtn.hidden = false;
    whoAmI.textContent = "Connecté : " + user.email;
    currentUser = user;
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    refresh(true);
    refreshTimer = setInterval(() => refresh(true), POLL_MS);
  };

  const lock = (msg) => {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    currentUser = null;
    stopScanner(true);
    closeTicketModal(false);
    hideLoadError();
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
    if (e && e.message === "non-autorise") return "Ce compte n'est pas autorisé au contrôle d'accès.";
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

  filterPresence.addEventListener("change", () => refresh(false));
  filterTier.addEventListener("change", () => refresh(false));
  refreshBtn.addEventListener("click", () => refresh(false));

  /* ---- QR decoding ------------------------------------- */
  function extractCode(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    const direct = raw.toUpperCase();
    if (codePattern.test(direct)) return direct;
    try {
      const url = new URL(raw);
      const match = url.pathname.match(/\/t\/([^/]+)\/?$/i);
      if (match) {
        const code = decodeURIComponent(match[1]).trim().toUpperCase();
        if (codePattern.test(code)) return code;
      }
    } catch {
      /* not a URL */
    }
    return "";
  }

  function setScanStatus(message, tone) {
    if (!scanStatus) return;
    scanStatus.textContent = message;
    scanStatus.dataset.tone = tone || "";
  }

  function stopScanner(hideModal) {
    scanActive = false;
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    if (scanStream) {
      scanStream.getTracks().forEach((track) => track.stop());
      scanStream = null;
    }
    if (scanVideo) scanVideo.srcObject = null;
    if (hideModal && scanModal) scanModal.hidden = true;
  }

  function scheduleScan(delay) {
    if (!scanActive) return;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scanFrame, delay);
  }

  function scanFrame() {
    if (!scanActive || !scanVideo) return;
    if (!scanCanvasCtx) {
      scanCanvasCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
    }
    if (!scanCanvasCtx || scanVideo.readyState < 2 || !scanVideo.videoWidth) {
      scheduleScan(SCAN_INTERVAL_MS);
      return;
    }
    try {
      if (scanCanvas.width !== scanVideo.videoWidth || scanCanvas.height !== scanVideo.videoHeight) {
        scanCanvas.width = scanVideo.videoWidth;
        scanCanvas.height = scanVideo.videoHeight;
      }
      scanCanvasCtx.drawImage(scanVideo, 0, 0, scanCanvas.width, scanCanvas.height);
      const image = scanCanvasCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
      const decoded = window.jsQR ? window.jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" }) : null;
      if (decoded) {
        const code = extractCode(decoded.data);
        if (code) {
          const now = Date.now();
          if (!(code === lastCode && now - lastCodeAt < SAME_CODE_COOLDOWN_MS)) {
            lastCode = code;
            lastCodeAt = now;
            setScanStatus("Billet détecté…");
            stopScanner(true);
            openTicket(code);
            return;
          }
        }
      }
    } catch (e) {
      /* A decode error must never break the loop. */
    }
    scheduleScan(SCAN_INTERVAL_MS);
  }

  async function startScanner() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setScanStatus("La caméra n'est pas disponible sur cet appareil.", "err");
      if (scanModal) scanModal.hidden = false;
      return;
    }
    if (!scanModal) return;
    scanModal.hidden = false;
    setScanStatus("Ouverture de la caméra…");
    stopScanner(false);
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      scanVideo.srcObject = scanStream;
      await scanVideo.play().catch(() => {});
      scanActive = true;
      setScanStatus("Présentez le QR code du billet devant la caméra.");
      scheduleScan(0);
    } catch (error) {
      const name = (error && error.name) || "";
      let message = "Impossible d'ouvrir la caméra.";
      if (name === "NotAllowedError" || name === "SecurityError") {
        message = "Accès à la caméra refusé. Autorisez la caméra dans les réglages du navigateur, puis réessayez.";
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        message = "Aucune caméra détectée sur cet appareil.";
      } else if (name === "NotReadableError") {
        message = "La caméra est déjà utilisée par une autre application.";
      }
      setScanStatus(message, "err");
      stopScanner(false);
    }
  }

  scanOpen.addEventListener("click", startScanner);
  scanClose.addEventListener("click", () => stopScanner(true));
  scanCancel.addEventListener("click", () => stopScanner(true));

  scanModal.addEventListener("click", (e) => {
    if (e.target === scanModal) stopScanner(true);
  });

  /* ---- single-ticket popup ----------------------------- */
  async function openTicket(code) {
    try {
      const data = await apiGet("/api/tickets/" + encodeURIComponent(code));
      showTicket(data.ticket);
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403)) {
        lock("Ce compte n'est pas autorisé au contrôle d'accès.");
        return;
      }
      if (e && e.status === 404) {
        Toast.show("Billet introuvable.", "err");
      } else {
        console.error("ticket lookup failed (" + ((e && e.status) || "réseau") + "):", e && e.message);
        Toast.show("Lecture du billet impossible. Réessayez.", "err");
      }
      startScanner();
    }
  }

  function resetTicketPopup(ticket) {
    ticketRevokedBanner.hidden = true;
    ticketMsg.hidden = true;
    ticketMsg.textContent = "";
    ticketMsg.dataset.tone = "";
    ticketMarkBtn.hidden = true;
    ticketMarkBtn.disabled = false;
    ticketMarkBtn.textContent = "Marquer présent";
    ticketMarkBtn.classList.remove("btn--ok");
    ticketMarkBtn.classList.add("btn--ok");

    ticketModalCode.textContent = ticket.code;
    ticketHolder.textContent = ticket.holderName || "—";
    ticketTier.textContent = ticket.tierLabel || tierLabel[ticket.tier] || ticket.tier || "—";
    ticketStatus.innerHTML = pill(ticket.status);
    ticketUsedAt.textContent = ticket.usedAt ? dayTime(ticket.usedAt) : "—";
    ticketUsedBy.textContent = ticket.usedBy ? "par " + ticket.usedBy : "";
    ticketUsedBy.hidden = !ticket.usedBy;
  }

  function showTicket(ticket) {
    if (!ticket || !ticketModal) return;
    activeTicket = ticket;
    resetTicketPopup(ticket);

    if (ticket.status === "revoked") {
      /* Cancelled always wins: never offer a check-in action. */
      ticketRevokedBanner.hidden = false;
      ticketMsg.hidden = false;
      ticketMsg.dataset.tone = "err";
      ticketMsg.textContent = "Billet annulé — refus d'entrée.";
    } else if (ticket.status === "used") {
      ticketMsg.hidden = false;
      ticketMsg.dataset.tone = "warn";
      ticketMsg.textContent =
        "Déjà utilisé" +
        (ticket.usedAt ? " à " + timeOnly(ticket.usedAt) : "") +
        (ticket.usedBy ? " par " + ticket.usedBy : "") +
        ".";
    } else {
      ticketMarkBtn.hidden = false;
    }

    ticketModal.hidden = false;
  }

  function closeTicketModal(resume) {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    if (activeTicket) {
      lastCode = activeTicket.code;
      lastCodeAt = Date.now();
    }
    if (ticketModal) ticketModal.hidden = true;
    activeTicket = null;
    if (resume && currentUser) {
      setTimeout(() => { if (currentUser) startScanner(); }, 250);
    }
  }

  ticketModalClose.addEventListener("click", () => closeTicketModal(true));
  ticketDoneBtn.addEventListener("click", () => closeTicketModal(true));
  ticketModal.addEventListener("click", (e) => {
    if (e.target === ticketModal) closeTicketModal(true);
  });

  ticketMarkBtn.addEventListener("click", async () => {
    if (!activeTicket) return;
    const code = activeTicket.code;
    ticketMarkBtn.disabled = true;
    ticketMarkBtn.innerHTML = '<span class="spin" aria-hidden="true"></span> Validation…';
    try {
      const data = await apiPost("/api/tickets/" + encodeURIComponent(code));
      showTicket(data.ticket);
      ticketMsg.hidden = false;
      ticketMsg.dataset.tone = "ok";
      ticketMsg.textContent = "Présent marqué" + (data.ticket.usedAt ? " à " + timeOnly(data.ticket.usedAt) : "") + ".";
      ticketMarkBtn.hidden = true;
      refresh(true);
      closeTimer = setTimeout(() => closeTicketModal(true), 2400);
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403)) {
        lock("Ce compte n'est pas autorisé au contrôle d'accès.");
        return;
      }
      const ticket = e && e.data && e.data.ticket;
      if (ticket) {
        showTicket(ticket);
        Toast.show(e.data.error || "Billet non validé.", "err");
      } else {
        console.error("check-in failed (" + ((e && e.status) || "réseau") + "):", e && e.message);
        Toast.show("Validation impossible. Réessayez.", "err");
        ticketMarkBtn.disabled = false;
        ticketMarkBtn.textContent = "Marquer présent";
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (ticketModal && !ticketModal.hidden) { closeTicketModal(true); return; }
    if (scanModal && !scanModal.hidden) stopScanner(true);
  });
})();
