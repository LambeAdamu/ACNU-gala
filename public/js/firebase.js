/* Gala & Awards 2027 — ACNU. firebase.js: Firebase init + Firestore-backed transaction store.
 * Load AFTER firebase-config.js and the compat SDKs, BEFORE payments.js/admin.js. */

const firApp = firebase.initializeApp(FireConfig);
const firAuth = firebase.auth(firApp);
/* Firestore/Storage SDKs are optional: the admin console loads only app+auth,
 * and no page reads or writes Firestore any more (orders live in Postgres). */
const firDb = firebase.firestore ? firebase.firestore(firApp) : null;
const firStorage = firebase.storage ? firebase.storage(firApp) : null;

const TX_COLL = "transactions";
const TX_QUERY = firDb ? firDb.collection(TX_COLL).orderBy("createdAt", "desc") : null;

/* Firestore-backed store mirroring AcnuStore's read shape, with a
 * localStorage fallback (AcnuStore) so the payment page keeps working offline. */
const TxApi = {
  async add(tx) {
    if (firDb) {
      try {
        await firDb.collection(TX_COLL).doc(tx.id).set(tx);
        return true;
      } catch (e) {
        if (AcnuStore.add(tx)) return true;
        return false;
      }
    }
    return AcnuStore.add(tx);
  },

  async update(id, patch) {
    try {
      await firDb.collection(TX_COLL).doc(id).update(patch);
    } catch (e) {
      AcnuStore.update(id, patch);
    }
  },

  async readAll() {
    try {
      const snap = await TX_QUERY.get();
      return snap.docs.map((d) => d.data());
    } catch (e) {
      return AcnuStore.read();
    }
  },

  async findLast(email, n) {
    try {
      const snap = await firDb.collection(TX_COLL).where("email", "==", email).limit(n || 5).get();
      return snap.docs.map((d) => d.data());
    } catch (e) {
      return AcnuStore.read().filter((t) => t.email === email).slice(0, n || 5);
    }
  },

  observe(cb) {
    try {
      return TX_QUERY.onSnapshot((snap) => cb(snap.docs.map((d) => d.data())), () => cb(AcnuStore.read()));
    } catch (e) {
      return () => {};
    }
  },

  async signIn(email, password) {
    const cred = await firAuth.signInWithEmailAndPassword(email, password);
    return cred.user;
  },

  signOut() {
    return firAuth.signOut();
  },

  current() {
    return firAuth.currentUser;
  },

  onAuth(cb) {
    return firAuth.onAuthStateChanged((u) => cb(u));
  },

  seed() {
    if (!firDb || localStorage.getItem("acnu_seeded")) return;
    const legacy = AcnuStore.read();
    if (!legacy.length) { localStorage.setItem("acnu_seeded", "1"); return; }
    const col = firDb.collection(TX_COLL);
    Promise.all(legacy.map((t) => col.doc(t.id).set(t).catch(() => {})))
      .then(() => localStorage.setItem("acnu_seeded", "1"))
      .catch(() => {});
  },
};