-- Suivi du recontact par le fondateur : date du dernier clic « Envoyer depuis mon WhatsApp » dans le CRM.
alter table members add column if not exists contacted_at timestamptz;
