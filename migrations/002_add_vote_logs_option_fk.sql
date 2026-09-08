-- Chạy sau khi đã có schema gốc. FK này cần thiết để route /logs
-- có thể "embed" options(label) trực tiếp qua Supabase JS client.
alter table vote_logs
  add constraint vote_logs_option_id_fkey
  foreign key (option_id) references options(id);
