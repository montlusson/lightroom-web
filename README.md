# Lightroom Web

Clone web d'Adobe Lightroom : import RAW, développement non destructif sur GPU, bibliothèque persistante et export multi-formats. 100 % local — aucune donnée ne quitte le navigateur.

## Démarrage

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # build de production dans dist/
```

Des images de démonstration sont fournies dans `public/samples/` (2 JPEG + 1 DNG de test).

## Fonctionnalités

### Import
- Glisser-déposer n'importe où dans l'application, ou bouton **Importer**
- Formats standards : JPEG, PNG, WebP, GIF, BMP, AVIF
- **RAW** : DNG, CR2, CR3, NEF, ARW, ORF, RW2, RAF, PEF, SRW et 15 autres — l'aperçu JPEG pleine résolution embarqué est extrait par analyse binaire du conteneur (`src/lib/raw.js`), sans dépendance WASM
- Miniatures générées à l'import, orientation EXIF respectée

### Développement (non destructif)
Moteur WebGL2 (`src/lib/engine.js`) — un fragment shader applique tout le pipeline en temps réel :
- **Balance des blancs** : température, teinte
- **Tonalité** : exposition (EV), contraste, hautes lumières, ombres, blancs, noirs
- **Présence** : vibrance, saturation
- **Couleur (TSL)** : teinte / saturation / luminance sur 8 canaux de couleur
- **Détail** : netteté (masque flou)
- **Effets** : vignettage, grain
- Rotation 90°, avant/après (maintenir), réinitialisation, 6 paramètres prédéfinis
- Histogramme RVB temps réel
- Les réglages sont stockés comme métadonnées — l'original n'est jamais modifié

### Bibliothèque
- Persistance complète en **IndexedDB** (originaux + aperçus + réglages)
- Recherche, filtres (note minimale, RAW, retouchées), tris, taille de vignettes
- Notes 0–5 étoiles, badges RAW / retouchée, suppression
- Pellicule (filmstrip) dans le module Développement
- Raccourcis : `G` grille · `D` développement · `0–5` note

### Tableau de bord
Statistiques du catalogue : volumes, RAW, retouchées, stockage, répartition des notes, formats, imports récents.

### Export
JPEG / PNG / WebP, réglage de qualité, redimensionnement (1080 / 2048 / 4096 px ou taille d'origine). Rendu pleine résolution via le même shader que l'aperçu.

### Fonctions v3 — gestion d'image de base

**⬚ Recadrage** (`src/components/CropTool.jsx`) — bouton « Recadrer » dans le module Développement.
Recadrage manuel interactif sur le canvas : poignées de redimensionnement (coins + bords),
déplacement, grille des tiers, assombrissement hors zone. Formats prédéfinis : Libre, Original,
1:1, 4:3, 3:2, 16:9, 9:16, 4:5 (les coins conservent le ratio verrouillé). Non destructif :
stocké en coordonnées normalisées dans les réglages, appliqué par le shader (offset/scale UV) —
l'aperçu, l'export, les Reels et la vignette de bibliothèque suivent automatiquement.
La rotation 90° transforme la géométrie du recadrage et des masques pour rester ancrée.

**📈 Courbe de tonalité** (`src/lib/curve.js` + `src/components/CurvePanel.jsx`) — panneau
« Courbe de tonalité ». Éditeur à points de contrôle (clic pour ajouter, glisser pour ajuster,
double-clic pour retirer, jusqu'à 8 points), interpolation cubique monotone (Fritsch-Carlson),
histogramme de luminance en arrière-plan. Cuite en LUT 256 entrées envoyée au GPU en texture.

**🎭 Masquage intelligent** (`src/lib/masks.js` + `src/components/MaskPanel.jsx`) — panneau
« Masquage », jusqu'à 3 masques par photo :
- **Sujet (IA)** : saliency heuristique (distance colorimétrique au fond estimé sur les bords + prior central)
- **Ciel (IA)** : suivi de gradient depuis le bord supérieur avec tolérance adaptative
- **Radial** et **Linéaire** : gradients positionnables par curseurs (centre, taille, contour progressif, rotation)

Chaque masque a ses réglages locaux (exposition, contraste, ombres, saturation, température)
appliqués dans le shader, une option d'inversion, et s'affiche en surimpression rouge quand il
est sélectionné. Les masques IA sont recalculés de façon déterministe (rien de lourd à persister)
et restent ancrés à l'image à travers recadrage et rotation.

### Fonctions v2 (inspirées des versions Lightroom 2025-2026)

**🎬 Reels / vidéos** (`src/lib/video.js`) — bouton « Reel » dans la barre de navigation.
Crée une vidéo MP4 (ou WebM selon le navigateur) à partir des photos développées :
formats 9:16 / 1:1 / 16:9, durée par photo réglable, effet Ken Burns, fondus enchaînés.
Les réglages de développement sont appliqués via le moteur WebGL avant le rendu.

**✨ Suppression des poussières (IA)** (`src/lib/retouch.js`) — bouton dans le module Développement.
Un clic analyse toute l'image : détection d'anomalies locales (écart à la médiane de voisinage),
filtrage par composantes connexes (taches compactes **et** fils/fibres allongés), inpainting par
convolution normalisée. Non destructif : l'original est conservé, la retouche est annulable.

**⧉ Recherche de doublons** (`src/lib/similarity.js`) — bouton « Doublons » dans la bibliothèque.
Hash perceptuel 160 bits (gradients horizontaux + verticaux + signature couleur), regroupement
par distance de Hamming, organisation en **piles** dans la grille (badge ▣ N, clic pour déplier).
Le leader de pile est la photo la mieux notée.

**☺ Tri assisté des portraits** (`src/lib/faces.js`) — bouton « Visages » dans la bibliothèque.
Détecte les visages (API FaceDetector native quand disponible, sinon heuristique de teint) et
score chaque portrait sur la **netteté des yeux** (variance laplacienne de la bande oculaire) et
les **yeux ouverts** (clusters sombres de pupilles à étendue verticale suffisante — un œil fermé
ou un sourcil ne produit qu'une ligne fine). Badge « Meilleur portrait » + attribution 5★ en un clic.

## Architecture

```
src/
├── App.jsx               # layout, drag & drop global, raccourcis clavier
├── store.js              # état global (Zustand) + pipeline d'import
├── lib/
│   ├── db.js             # persistance IndexedDB
│   ├── raw.js            # extraction d'aperçus JPEG des fichiers RAW
│   ├── engine.js         # moteur WebGL2 (crop, courbe LUT, masques) + histogramme
│   ├── adjustments.js    # modèle de réglages, presets, rotation de géométrie
│   ├── curve.js          # interpolation cubique monotone -> LUT 256
│   ├── masks.js          # masques sujet/ciel (IA), radial, linéaire
│   ├── exporter.js       # rendu pleine résolution + encodage
│   ├── photo.js          # masterOf() : image retouchée IA sinon master
│   ├── video.js          # rendu Reel (MediaRecorder + Ken Burns)
│   ├── retouch.js        # suppression poussières/fils (détection + inpainting)
│   ├── similarity.js     # hash perceptuel + regroupement des doublons
│   └── faces.js          # détection de visages + scores yeux nets / ouverts
└── components/
    ├── TopNav.jsx        # barre de navigation / modules
    ├── Dashboard.jsx     # tableau de bord
    ├── Library.jsx       # grille + filtres + barre d'état
    ├── Develop.jsx       # canvas WebGL + panneaux de réglages
    ├── CropTool.jsx      # overlay de recadrage interactif + overlay de masque
    ├── CurvePanel.jsx    # éditeur de courbe de tonalité
    ├── MaskPanel.jsx     # gestion des masques + réglages locaux
    ├── Filmstrip.jsx     # pellicule
    ├── Histogram.jsx     # histogramme RVB SVG
    ├── ExportDialog.jsx  # dialogue d'export
    ├── ReelDialog.jsx    # création de Reels vidéo
    ├── DuplicatesDialog.jsx # analyse des doublons + piles
    ├── FacesDialog.jsx   # tri assisté des portraits
    ├── Slider.jsx        # slider style Lightroom (double-clic = reset)
    ├── Stars.jsx         # notation
    └── Toasts.jsx        # notifications
```

Stack : React 19 · Vite 6 · Tailwind CSS 4 · Zustand · WebGL2 · IndexedDB.

## Limites connues
- Le développement RAW travaille sur l'aperçu JPEG embarqué (fidèle à la prise de vue), pas sur une dématriçage complet du capteur — un décodeur libraw/WASM peut être branché dans `raw.js` sans changer le reste du pipeline.
- Les masques Sujet/Ciel sont des heuristiques (saliency et suivi de gradient), pas des réseaux de segmentation — un modèle ONNX/WebGPU peut remplacer `computeSubjectMask`/`computeSkyMask` sans toucher au pipeline.
- Courbe de tonalité composite RVB (pas de courbes par canal).
