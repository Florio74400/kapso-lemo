-- Réglages de l'outil d'acquisition : adresse qui reçoit l'alerte à chaque parcours terminé.
alter table companies add column if not exists alert_email text;
