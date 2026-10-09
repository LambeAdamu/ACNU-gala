# ACNU Gala & Awards 2027 — Lot 2 (Batch 2) : rapport de réalisation

- Branche : `ux-batch-2` (créée à partir de `main` @ `b91d608`)
- Date : 2026-10-09
- Statut : implémenté, validé, commit par tâche. Non poussé, non déployé.

---

## 1. Résumé

Le site est restructuré en **trois vues routées** (accueil, à-propos, billets) sur des ancres de type
`#/route`, avec un héro événementiel prêt pour la vidéo, un mot des organisateurs (brouillon),
une grille tarifaire « Choisissez votre place », une page À propos (mission + prix + défilement des
lauréats) et un routeur qui conserve la compatibilité de tous les liens existants.

Le bloc billetterie (`#paiement`) est déplacé tel quel dans la vue billets ; son **hash reste
identique** (preuve §4) : aucune ligne de son contenu interne n'a été modifiée, seul l'attribut
`hidden` du nœud racine a été retiré.

---

## 2. Ce qui a été fait (par tâche)

### T5 — Héro événementiel + section media (partiel)
- `public/index.html` : nouveau bloc `hero hero--event` (kicker « 3e édition · Gala & Awards 2027 »,
  titre exact Addendum A avec `Célébrer l'excellence. Inspirer la jeunesse. Façonner les leaders de demain.`,
  sous-titre, 3 faits (Organisateur ACNU / Lieu Douala, Cameroun / Billets à partir de 15 000 FCFA),
  2 CTA). Les `.edition-card` et `.moon` de l'ancien héro sont supprimés.
- Gobelet media : `<div class="hero__media" data-hero-media data-video-src="">`. `public/js/hero-media.js`
  (créé) injecte `<video>` autoplay/muted/loop **uniquement si** `data-video-src` est renseigné et hors
  `prefers-reduced-motion` (amélioration progressive, aucun impact tant que la vidéo n'est pas fournie).

### T3 — Navigation / routing
- `public/index.html` : en-tête = 3 entrées « Accueil » / « À propos » / « Payer des billets » avec
  `data-route` + `data-label-en`. Lien marque → `#/accueil`.
- `public/js/main.js` : `initPaiement()` remplacé par `initRouter()` :
  - routes : `#/accueil` (défaut, y compris `#`, `#/`, inconnue), `#/a-propos`, `#/billets` ;
  - anciens ancrages conservés : `#paiement`→billets, `#apropos`→a-propos, `#prix`→a-propos puis
    `scrollIntoView(#prix)`, `#partenaires`/`#contact`/`#faq`/`#organisateur`/`#tarifs`/`#presentation`→accueil
    puis défilement vers la section ;
  - état actif du menu (`is-active`, `aria-current="page"`).
- Pied de page mis à jour (Accueil / À propos / Prix & distinctions / Partenariats / Payer des billets /
  Espace administrateur).

### T7 — Message de l'équipe organisatrice
- `public/index.html` : section `#organisateur` avec le brouillon 100–150 mots (signature « L'équipe
  d'organisation ACNU », mention « Texte provisoire à valider »). Aucun budget, aucune offre partenariale,
  aucun téléphone/email au-delà du pied de page.

### T8 — Grille tarifaire
- Section `#tarifs` : 3 billets **Classic 15 000** (160 places), **VIP 25 000** (100 places, mis en avant),
  **Premium 300 000 FCFA** (5 places), chacun « Payer des billets » → `#/billets`.

### T6 — Page À propos + victoire nominative
- `public/index.html` : vue `#view-apropos` = lede verbatim Addendum A + section prix/distinctions
  (déplacée de l'accueil) + lauréats en défilement (`#laureats`, track `data-marquee-track` +
  bandeau vide `data-marquee-empty`).
- `public/data/winners.js` (créé) : `window.GALA_WINNERS = []` avec commentaire de schéma. **Le rendu
  fonctionne avec zéro donnée** (bande masquée). `initMarquee()` duplique la piste pour une boucle
  parfaite, pause au survol/au focus, coupée sous motion réduit.
- Pricing ≠ 3 cartes identiques : remplacé par une grille tarifaire (exception documentée, §6).

### T1–T2 — Nettoyage & corrections (T8)
- Id de section `#apropos` renommé `#presentation` (évite le conflit de route).
- Typo « Récepissé » → « Récépissé » (2 occurrences : carte contact + FAQ).
- Suppression des tirets cadratins (`—`) du contenu non gelé (meta, titres, bande confiance, FAQ,
  partenariats) → remplacés par `·`, `,` ou « soit 10 ans ». **3 tirets cadratins subsistent dans
  `#paiement` (gelé, §6).**
- Greps de contrôle : plus aucun `href="index.html"`, `#apropos`, `TBD`/`TODO`/`FIXME`, `.moon`/`.edition-card`
  dans le HTML. Balises appariées (150 `div`, 12 `section`, 17 `article`).

### Ajout documenté (hors périmètre initial)
- CTA « Je m'engage » des packages partenaires pointent toujours `#paiement` (ancien comportement),
  désormais mappé sur la vue billets par le routeur. Non modifié (comportement d'origine).

---

## 3. Fichiers modifiés / créés

| Fichier | Modification |
|---|---|
| `public/index.html` | 3 vues, héro, organisateur, tarifs, à-propos+lauréats, pied de page, scripts |
| `public/js/main.js` | `initRouter()` + `initMarquee()` (remplace `initPaiement`) ; `AcnuStore`/`Toast`/`FMT`/header/reveal/FAQ intacts |
| `public/js/hero-media.js` | créé : vidéo d'héro progressive (no-op par défaut) |
| `public/data/winners.js` | créé : données lauréats vides (schéma commenté) |
| `public/css/styles.css` | appends espacés de noms `view-*`, `hero--event`, `organisateur*`, `tarif*`, `apropos*`, `marquee*`, active nav |
| `.gitignore` | ignore `_source/` (source propriétaire ; jamais commité/déployé) |

Commits (dans cet ordre) : `adf8350`, `c7dc6e8`, `c0047ce`, `0f84f43`.

---

## 4. Preuve de non-régression (bloc gelé `#paiement`)

Méthode : script jetable `hash-paiement.js` (hors repo) qui scanne `index.html`, isole la balise racine
`<section id="paiement">…</section>` (occurrence end-to-end), retire **uniquement** l'attribut `hidden` du
nœud racine, puis calcule SHA-1 sur le contenu restant.

- **AVANT** (début de session) : `960128e446f2081686fe894fdb750f9b2dd4d4b9` — longueur 10916 octets
- **APRÈS** (fin de session)  : `960128e446f2081686fe894fdb750f9b2dd4d4b9` — longueur 10916 octets

Identiques. Aucun changement interne au bloc billetterie (aucune id/classe/texte/ordre modifié).

Gel respecté : `public/js/payments.js`, `public/js/firebase.js`, `firestore.rules`, `public/admin.html`,
`public/js/admin.js`, `api/*` non touchés.

---

## 5. Hypothèses & décisions d'architecture (T2/IA)

- **Découpage des vues** : accueil = héro + bande confiance + présentation + organisateur + tarifs +
  partenariats + pourquoi + contact + FAQ ; à-propos = lede + mission + prix/distinctions + lauréats ;
  billets = bloc `#paiement` seul, déplacé tel quel.
- **Prix & distinctions** : déplacé de l'accueil vers la page À propos (cohérence éditoriale) ; l'ancre
  historique `#prix` reste fonctionnelle (route → à-propos + défilement).
- **Page À propos** : titre « Notre mission » + lede exact Addendum A ; aucun autre contenu factuel inventé.
- **Fallback lauréats** : données vides par défaut + bandeau « Les lauréats de cette édition seront
  annoncés prochainement. » (pas de « TBD » imprimé).
- **Priorité de tarifs** : Classic avant VIP avant Premium (l'ordre actuel du formulaire est Premium/VIP/Classic,
  les plans restent inchangés dans `#paiement`).
- **Préfixes de route** `#/` : choix courant et sûr pour le déploiement statique (Vercel).

---

## 6. Conflits résolus : règle (Addendum B / skill) | valeur | retenu

| Règle | Valeur proposée | Retenu |
|---|---|---|
| Page d'accueil ≥ 4 éléments texte max dans le héro | kicker + titre + sous-titre (3) + rangée de faits | 4 éléments — la rangée de faits est une **déviation documentée** (info clé événement) |
| Zéro tiret cadratin | — | Non atteignable à 100 % : 3 tirets cadratins subsistent **dans le bloc gelé** `#paiement` (lignes ~712, 833, 834). Règle supérieure « ne pas toucher au gel » retenue |
| Pas de 3 cartes identiques | — | Grille tarifaire à 3 niveaux = **exception** (la skill l'autorise explicitement pour les grilles de prix) |
| Un seul marquee par page | 1 (lauréats) | conforme |
| Pas de numérotation d'eyebrows | « Featured · Prix & distinctions 2027 » | remplacé par « Prix & distinctions 2027 » (sans numéro/« Featured ») |
| Pas de modification des styles globaux/frozen | — | Toute la nouveauté est namespace (`hero--event`, `organisateur*`, `tarif*`, `apropos*`, `marquee*`, `view`) |
| ≤ 2 familles / ≤ 4 graisses | — | respecté (Playfair + Inter, 2–3 graisses) |
| Motion réduite | — | vidéo non injectée ; marquee figé ; reveal instantané (règles `prefers-reduced-motion` ajoutées) |

---

## 7. Bloqué — à débloquer côté propriétaire

- `_source/DOC_MARKETING_ACNU_REVUE.docx` **absent** → brève/copies exactes et préparation des images
  impossibles ; pas de `pandoc`/`unzip` disponibles.
- Images sources (image2/22/23/24/310.jpg, etc.) **absentes** → posters héro + cartes (`cards/ceremonie.jpg`,
  `influence.jpg`, `vitrine.jpg`, `label.jpg`, `hero/hero-poster.jpg`) non produits.
- **Faits TBD** (côté client) : date, mois/année, heure, nom du lieu, réseaux sociaux, influences par catégorie.
  Rien n'a été inventé : les informations TBD sont **omises** de la page (pas de « TBD » visuel) et la
  puce heure n'est pas affichée.
- Signature officielle du message organisateur : « TBD → L'équipe d'organisation ACNU » en attendant validation.

---

## 8. Validation & vérification locale

- `node --check` OK sur `main.js`, `hero-media.js`, `winners.js`.
- Équilibre des balises HTML vérifié (div/section/article/ul/li).
- Hash gelé identique avant/après (§4).
- Greps de non-régression : aucun résidu (`index.html` liens directs, `#apropos`, `TBD`, `.moon`, etc.).

À vérifier en local (depuis `public/`) :

```
python -m http.server 8080
```

puis consulter `http://localhost:8080/#/accueil`, `#/a-propos`, `#/billets`, et les anciennes ancres
`#paiement`, `#prix`, `#contact`.