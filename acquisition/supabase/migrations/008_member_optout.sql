-- STOP d'un early adopter : on arrête tout contact et on efface ses réponses (prénom et étape gardés pour les statistiques).
alter table members add column if not exists opted_out_at timestamptz;
