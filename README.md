# backend-patch: thêm Pause / Resume cho vote-backend

Frontend cần MC bấm "Tạm dừng" rồi "Tiếp tục" và chạy lại đúng từ số giây còn
lại — backend hiện tại (`voteService.ts`, `session.routes.ts`) chưa hỗ trợ,
nên cần patch 3 chỗ:

## 1. Migration

Chạy `migrations/003_pause_resume_session.sql` trong Supabase SQL Editor
(sau `001` và `002`). Thêm 2 cột vào `sessions`:

- `remaining_seconds int` — số giây còn lại, chỉ có giá trị khi `status = 'paused'`.
- `paused_at timestamptz` — thời điểm bấm tạm dừng (phục vụ audit/log nếu cần).

Và mở rộng giá trị hợp lệ của `status` thành `'pending' | 'active' | 'paused' | 'closed'`
(trước đây có thể chỉ là `'active' | 'closed'` — kiểm tra lại constraint thật
trong DB của bạn và chỉnh migration nếu tên constraint khác).

**Quan trọng:** khi tạo session mới (hiện đang thao tác tay, chưa có API tạo),
nhớ set `status = 'pending'` làm giá trị khởi tạo, thay vì để trống — để user
join được và thấy câu hỏi trước khi MC bấm Start.

## 2. `src/services/voteService.ts`

Thay thế file cũ bằng file trong `backend-patch/src/services/voteService.ts`.
Thay đổi:

- `startSession`: reset `remaining_seconds`/`paused_at` về `null` khi bắt đầu.
- Thêm `pauseSession(sessionId)`: chỉ chạy được khi `status === 'active'`,
  tính `remaining_seconds = ended_at - now()`, set `status = 'paused'`,
  `ended_at = null` (quan trọng: nhờ vậy `upsertSelection` tự chặn ghi mới
  trong lúc tạm dừng mà không cần sửa gì thêm ở đó).
- Thêm `resumeSession(sessionId)`: chỉ chạy được khi `status === 'paused'`,
  set lại `ended_at = now() + remaining_seconds`, `status = 'active'`.

`upsertSelection`, `closeSession`, `getResults`, `countCurrentSelections`
giữ nguyên logic — không cần sửa vì chúng vốn đã kiểm tra `status === 'active'`.

## 3. `src/routes/session.routes.ts`

Thay thế bằng file trong `backend-patch/src/routes/session.routes.ts`. Thêm:

- `POST /session/:id/pause` (admin only) → gọi `pauseSession`.
- `POST /session/:id/resume` (admin only) → gọi `resumeSession`.

Cả hai trả lỗi `409` với `code` tương ứng (`session_not_active` /
`session_not_paused`) nếu gọi sai trạng thái, đúng convention lỗi đang có ở
route `/select`.

## Không cần sửa

- `closeSessionCron.ts`: vẫn hoạt động đúng — vì lúc `paused`, `ended_at` là
  `null` nên điều kiện `.lte('ended_at', now())` tự động không khớp, cron sẽ
  không đóng nhầm session đang tạm dừng.
- `close_session` SQL function: không đổi, vẫn chốt kết quả đúng cách bất kể
  session đi qua bao nhiêu lần pause/resume trước khi đóng.
