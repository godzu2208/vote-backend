-- Thêm hỗ trợ Pause/Resume cho session.
-- Chạy sau 001 và 002.
--
-- Cơ chế:
--  - 'pending': session vừa tạo, user có thể join và xem câu hỏi nhưng CHƯA được chọn.
--  - 'active':  admin đã bấm Start (hoặc Resume) -> đang đếm ngược, cho phép chọn.
--  - 'paused':  admin bấm Stop -> đếm ngược dừng lại, remaining_seconds lưu số giây còn lại,
--               ended_at = null (không có hạn chót trong lúc pause).
--  - 'closed':  đã chốt kết quả (qua RPC close_session).

alter table sessions
  add column if not exists remaining_seconds integer,
  add column if not exists paused_at timestamptz;

-- Nới lỏng/])cập nhật constraint status nếu DB đang enforce enum bằng check constraint.
-- Bỏ qua nếu constraint tên khác - chỉnh lại tên cho đúng schema thật của bạn.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'sessions_status_check'
  ) then
    alter table sessions drop constraint sessions_status_check;
  end if;
  alter table sessions add constraint sessions_status_check
    check (status in ('pending', 'active', 'paused', 'closed'));
exception when others then
  raise notice 'Bỏ qua việc cập nhật status check constraint: %', sqlerrm;
end $$;
