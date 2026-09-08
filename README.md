# vote-backend

Backend API cho hệ thống bình chọn tiết mục văn nghệ (Kahoot-style).

## Setup

```bash
npm install
cp .env.example .env
# Điền SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FRONTEND_ORIGIN, ADMIN_EMAILS vào .env
```

## Chạy migrations (Supabase SQL Editor)

Chạy theo đúng thứ tự, sau khi đã có schema gốc + RLS:

1. `migrations/001_close_session_function.sql` — function chốt kết quả cuối cùng (atomic)
2. `migrations/002_add_vote_logs_option_fk.sql` — FK để trang log join được sang tên đáp án

## Development

```bash
npm run dev
```

Server chạy tại `http://localhost:4000`. Endpoint kiểm tra: `GET /health`.

## Build & chạy production

```bash
npm run build
npm start
```

## API Endpoints

| Method | Endpoint | Auth | Mô tả |
|---|---|---|---|
| POST | `/api/join` | User | `{sessionId}` — ghi log join (idempotent) |
| POST | `/api/select` | User | `{sessionId, optionId \| null}` — chọn/đổi đáp án, chỉ khi session đang active |
| GET | `/api/select/count/:sessionId` | User | Số lượng đã chọn hiện tại |
| GET | `/api/session/:id` | User | Thông tin câu hỏi + đáp án + trạng thái |
| POST | `/api/session/:id/start` | Admin | `{durationSeconds}` — mở vote |
| POST | `/api/session/:id/close` | Admin | Khóa vote thủ công + chốt kết quả |
| GET | `/api/results/:sessionId` | User | Bảng xếp hạng đầy đủ (chỉ khi đã closed) |
| GET | `/api/logs?sessionId=&userId=&action=&page=&pageSize=` | Admin | Log hành động, có filter + phân trang |

## Cơ chế khóa vote

Backend **không tự polling nền** để khóa vote — điều này có chủ đích, để backend
không cần chạy như 1 process liên tục 24/7 và có thể deploy trên cả nền tảng
serverless (Vercel, v.v.) nếu muốn, không bắt buộc phải là Railway/Render/VPS.

Thay vào đó: trang **admin/màn hình điều khiển** (frontend) tự đếm ngược dựa trên
`started_at + duration_seconds` lấy từ `/api/session/:id`, và khi về 0 thì tự động
gọi `POST /session/:id/close`. Vẫn có nút "Khóa ngay" thủ công trên trang admin để
đóng sớm hơn hoặc phòng trường hợp tự động gọi bị trễ (mất mạng, tab bị lag...).

**Lớp phòng hộ ở backend** (`upsertSelection` trong `voteService.ts`): mọi request
`/select` đều bị chặn nếu `now() > sessions.ended_at`, kể cả khi `status` chưa kịp
chuyển sang `closed` (vì admin gọi `/close` trễ vài giây). Nhờ vậy dữ liệu vẫn đúng
thời điểm dù việc khóa chính thức có bị trễ một chút.

**Lưu ý vận hành:** vì không có tiến trình nền tự khóa, nếu trang admin bị đóng/mất
mạng đúng lúc hết giờ mà chưa kịp gọi `/close`, session sẽ ở trạng thái "quá giờ
nhưng vẫn active" cho tới khi có ai đó gọi lại `/close` (mở lại trang admin và bấm
"Khóa ngay" là đủ, không mất dữ liệu vì `upsertSelection` đã tự chặn ghi mới rồi).
Nếu muốn thêm 1 lớp dự phòng nữa mà không cần tự chạy server riêng, có thể dùng
1 dịch vụ cron ngoài miễn phí (cron-job.org, GitHub Actions scheduled workflow...)
gọi định kỳ 1 endpoint kiểm tra - đây là tuỳ chọn, không bắt buộc cho quy mô sự kiện
150 người có admin theo dõi trực tiếp.

## Lưu ý bảo mật

- `SUPABASE_SERVICE_ROLE_KEY` chỉ dùng ở backend, không bao giờ đưa vào frontend.
- `FRONTEND_ORIGIN` trong CORS phải là domain thật, không dùng `*`.
- `ADMIN_EMAILS` liệt kê email admin, phân cách bởi dấu phẩy, không khoảng trắng.
