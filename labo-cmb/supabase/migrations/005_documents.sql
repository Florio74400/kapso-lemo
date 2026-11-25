-- Rapports PDF générés à la demande (WhatsApp), téléchargeables par un lien non devinable pendant 30 jours.
create table if not exists documents (
  token text primary key,
  company_id uuid not null references companies(id) on delete cascade,
  filename text not null,
  body bytea not null,
  created_at timestamptz not null default now()
);
alter table documents enable row level security;
