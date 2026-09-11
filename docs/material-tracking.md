# Suivi des conduites PEHD et PVC

Cette évolution distingue la soudure préalable du PEHD de l’emboîtement du PVC pendant la pose. La pose inclut le remblai immédiat lorsque celui-ci s’applique. Les passages particuliers restent comptés une seule fois dans le linéaire posé, sans module ni pondération supplémentaire.

## Paramétrer Kong

Dans Structure réseau, ouvrir une révision et choisir PVC pour chaque sous-tronçon de T12 et T19. Les quantités déjà saisies restent inchangées. La méthode de calcul affiche alors les grilles PEHD et PVC. Le poids de soudure de la grille PEHD est transféré à la pose PVC : 33,6138 + 13,5631 = 47,1769 %. Il s’agit de la grille de transition convenue, pas d’une pondération économique issue du DQE.

Un sous-tronçon correspond à une portion d’un matériau. Pour un front mixte, créer des sous-tronçons distincts PEHD et PVC ; le même diamètre peut figurer dans chacun. Les identifiants existants de front, de sous-tronçon et de diamètre sont conservés.

Les configurations activées enregistrent `materialTracking: 1` et `localities[].zones[].material`. Les rapports gardent leur structure JSON existante. Pour le PVC, le champ `s` n’est pas collecté. La soudure n’est pas déduite de la pose.

## Calcul et historique

Les longueurs sont plafonnées à la référence de chaque portion pour l’indice ; les cumuls bruts restent disponibles. La soudure utilise uniquement le linéaire PEHD comme dénominateur. Les activités linéaires contribuent au prorata des longueurs, tandis que les regards sont agrégés une seule fois, par nombre d’ouvrages et état d’avancement. Sans regard, les poids applicables sont renormalisés.

Les anciennes configurations sans `materialTracking: 1` conservent le calcul historique. L’activation sur un projet qui contient déjà des rapports est bloquée : une migration distincte et vérifiée est nécessaire. Le matériau d’une portion utilisée dans un rapport est verrouillé. L’indice de continuité historique reste visible uniquement dans l’ancien mode.

Pour le nouveau mode, pose supérieure à fouille produit une alerte mais ne réduit pas les quantités : certains passages particuliers n’ont pas de tranchée ouverte. La comparaison pose/soudure concerne seulement le PEHD. Aucune règle fouille ≤ soudure n’est introduite. Le contrôle du linéaire de référence et la justification des écarts restent nécessaires.

Les deux courbes prévues, pose et indice global, sont saisies dans Planning contractuel. Leur définition doit correspondre à celle du réalisé. Le mode matériaux n’utilise pas le planning historique de Dispersion en remplacement d’un planning absent.

## Livraison et vérification

Déployer ensemble `index.html` et `material-model.js`. Les schémas SQL versionnés stockent déjà configuration et rapports en JSONB ; cette évolution ne change ni les tables, ni les rôles, ni les politiques d’accès. La base de production n’a pas été interrogée ou modifiée pour ces tests.

Lancer `node tests/materials.test.cjs`. Pour la comparaison exacte avec la version précédente, fournir son fichier HTML via `SIYO_BASELINE=/chemin/vers/index-original.html node tests/materials.test.cjs`. La source de référence est le commit `9917793c77466c9696f2f02bdfd147394c5641eb`, blob `b764ab07a5d340d13b5aaec8f45976ed5b27d0e5`.

Les tests couvrent les calculs PVC, PEHD et mixtes, les mêmes diamètres sur deux matériaux, les corrections, les passages particuliers, l’absence de regards, les rapports, les exports, les verrous d’historique et la sauvegarde/relecture simulée du paramétrage. La comparaison historique utilise des données de contrôle, pas les rapports réels de production.

La vérification visuelle sur navigateur et téléphone reste à effectuer avant publication : l’ouverture de l’aperçu local a été bloquée par la politique du navigateur de l’environnement de travail. Vérifier notamment les sélecteurs de matériau, les colonnes de saisie PVC, les tableaux mixtes, l’impression PDF et les graphiques avec les bibliothèques réelles.
