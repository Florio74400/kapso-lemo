-- Lecteurs : personnes de l'entreprise cliente (direction, marketing...) autorisées à interroger
-- les retours par WhatsApp, sans pouvoir créer de collecte.
alter table companies add column if not exists reader_phones text[] not null default '{}';
