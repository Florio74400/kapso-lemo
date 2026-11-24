# LEMO – deux applications indépendantes

| Dossier | Usage | Numéro WhatsApp | Déploiement |
|---|---|---|---|
| `labo-cmb/` | Labo Compagnie du Mont-Blanc : parcours skieur (inscription, info du matin, questions, retours) et **Jarvis**, l'assistant des cadres qui interroge les retours | Kapso Sandbox (+56 9 2040 3095), testeurs inscrits uniquement | Service Railway `labo-cmb`, schéma `labo_cmb` de la base Supabase |
| `acquisition/` | Outil d'acquisition (logique à redéfinir) | LEMO (+1 208-485-0838) | Service Railway `lemo-mini`, schéma `public` de la base Supabase |

Les deux codes évoluent séparément : une modification dans un dossier n'affecte pas l'autre.
Chaque dossier contient son propre README, ses tests (`npm test`) et ses migrations.
