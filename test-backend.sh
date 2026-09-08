#!/usr/bin/env bash
# ==============================================================================
# Smoke test cho vote-backend (bao gồm cả pause/resume mới thêm).
#
# YÊU CẦU TRƯỚC KHI CHẠY:
#   1. Backend đang chạy (npm run dev), đã áp dụng migrations 001, 002, 003.
#   2. Đã tạo 2 user test trong Supabase Auth (Authentication > Users > Add user,
#      chọn "Auto Confirm User" để khỏi cần verify email):
#        - 1 user thường:  USER_EMAIL  (domain phải khớp ALLOWED_EMAIL_DOMAIN)
#        - 1 user admin:   ADMIN_EMAIL (domain khớp + có trong ADMIN_EMAILS của backend)
#      Cả hai đặt password bất kỳ, set vào biến bên dưới.
#   3. Đã tạo 1 session test bằng tay trong Supabase (bảng `sessions` + `options`):
#        insert into sessions (id, question, status)
#          values ('11111111-1111-1111-1111-111111111111', 'Tiết mục nào hay nhất?', 'pending');
#        insert into options (session_id, label, sort_order) values
#          ('11111111-1111-1111-1111-111111111111', 'Múa dân gian', 1),
#          ('11111111-1111-1111-1111-111111111111', 'Nhảy hiện đại', 2),
#          ('11111111-1111-1111-1111-111111111111', 'Hát acoustic', 3),
#          ('11111111-1111-1111-1111-111111111111', 'Kịch câm', 4);
#      Copy đúng id đó vào SESSION_ID bên dưới.
#
# CÁCH CHẠY:
#   chmod +x test-backend.sh
#   ./test-backend.sh
#
# CẦN CÀI: curl, jq (sudo apt install jq / brew install jq)
# ==============================================================================
set -euo pipefail

# ---------- CẤU HÌNH - SỬA CÁC GIÁ TRỊ NÀY ----------
API_BASE_URL="http://localhost:4000"
SUPABASE_URL="https://xhwforduvbfnuggdesjs.supabase.co"
SUPABASE_ANON_KEY="your-anon-key-here"

USER_EMAIL="test@rever.vn"
USER_PASSWORD="Rever@123"

ADMIN_EMAIL="linh@rever.vn"
ADMIN_PASSWORD="Linh2051120137?"

SESSION_ID="11111111-1111-1111-1111-111111111111"
DURATION_SECONDS=8   # để ngắn cho dễ test, sẽ tự đóng khi hết giờ (cron 2s)
# -----------------------------------------------------

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
info() { printf "  \033[36m→\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗ %s\033[0m\n" "$1"; }

get_token() {
  local email="$1" password="$2"
  curl -s -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"password\":\"${password}\"}" \
    | jq -r '.access_token'
}

call() {
  # call METHOD PATH TOKEN [BODY]
  local method="$1" path="$2" token="$3" body="${4:-}"
  if [ -n "$body" ]; then
    curl -s -w "\n%{http_code}" -X "$method" "${API_BASE_URL}${path}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -s -w "\n%{http_code}" -X "$method" "${API_BASE_URL}${path}" \
      -H "Authorization: Bearer ${token}"
  fi
}

show() {
  # show LABEL RESPONSE(body+status trộn, dòng cuối là status code)
  local label="$1" raw="$2"
  local status body
  status=$(echo "$raw" | tail -n1)
  body=$(echo "$raw" | sed '$d')
  echo "  ${label} -> HTTP ${status}"
  echo "$body" | jq . 2>/dev/null | sed 's/^/    /' || echo "    $body"
}

bold "0. Health check"
curl -s "${API_BASE_URL}/health" | jq .
echo

bold "1. Đăng nhập lấy token"
USER_TOKEN=$(get_token "$USER_EMAIL" "$USER_PASSWORD")
ADMIN_TOKEN=$(get_token "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
[ "$USER_TOKEN" != "null" ] && [ -n "$USER_TOKEN" ] && ok "Lấy được token user" || { fail "Không lấy được token user - kiểm tra email/password"; exit 1; }
[ "$ADMIN_TOKEN" != "null" ] && [ -n "$ADMIN_TOKEN" ] && ok "Lấy được token admin" || { fail "Không lấy được token admin - kiểm tra email/password"; exit 1; }
echo

bold "2. User join session (idempotent - gọi 2 lần, lần 2 phải alreadyJoined:true)"
show "join lần 1" "$(call POST /api/join "$USER_TOKEN" "{\"sessionId\":\"$SESSION_ID\"}")"
show "join lần 2" "$(call POST /api/join "$USER_TOKEN" "{\"sessionId\":\"$SESSION_ID\"}")"
echo

bold "3. Xem thông tin session (phải đang 'pending')"
show "GET /session" "$(call GET /api/session/$SESSION_ID "$USER_TOKEN")"
echo

bold "4. User cố chọn đáp án khi CHƯA start -> phải bị chặn (409 session_not_active)"
OPTION_ID=$(curl -s "${API_BASE_URL}/api/session/${SESSION_ID}" -H "Authorization: Bearer ${USER_TOKEN}" | jq -r '.options[0].id')
info "Dùng optionId đầu tiên: $OPTION_ID"
show "POST /select (lúc pending)" "$(call POST /api/select "$USER_TOKEN" "{\"sessionId\":\"$SESSION_ID\",\"optionId\":\"$OPTION_ID\"}")"
echo

bold "5. Admin bấm Start (durationSeconds=$DURATION_SECONDS)"
show "POST /session/:id/start" "$(call POST /api/session/$SESSION_ID/start "$ADMIN_TOKEN" "{\"durationSeconds\":$DURATION_SECONDS}")"
show "GET /session (phải 'active', có ended_at)" "$(call GET /api/session/$SESSION_ID "$USER_TOKEN")"
echo

bold "6. User chọn đáp án khi đang active -> phải thành công"
show "POST /select" "$(call POST /api/select "$USER_TOKEN" "{\"sessionId\":\"$SESSION_ID\",\"optionId\":\"$OPTION_ID\"}")"
show "GET /select/count" "$(call GET /api/select/count/$SESSION_ID "$USER_TOKEN")"
echo

bold "7. Admin bấm Pause -> status phải chuyển 'paused', remainingSeconds > 0"
show "POST /session/:id/pause" "$(call POST /api/session/$SESSION_ID/pause "$ADMIN_TOKEN")"
show "GET /session (ended_at phải null, remaining_seconds có giá trị)" "$(call GET /api/session/$SESSION_ID "$USER_TOKEN")"
echo

bold "8. User cố chọn đáp án khi đang paused -> phải bị chặn (409 session_not_active)"
show "POST /select (lúc paused)" "$(call POST /api/select "$USER_TOKEN" "{\"sessionId\":\"$SESSION_ID\",\"optionId\":\"$OPTION_ID\"}")"
echo

bold "9. Admin bấm Resume -> status quay lại 'active', ended_at được tính lại"
show "POST /session/:id/resume" "$(call POST /api/session/$SESSION_ID/resume "$ADMIN_TOKEN")"
show "GET /session" "$(call GET /api/session/$SESSION_ID "$USER_TOKEN")"
echo

bold "10. Đợi hết giờ để cron tự đóng (kiểm tra closeSessionCron.ts)..."
sleep $((DURATION_SECONDS + 4))
show "GET /session (phải tự chuyển 'closed')" "$(call GET /api/session/$SESSION_ID "$USER_TOKEN")"
echo

bold "11. Xem kết quả (chỉ user thường cũng xem được, vì đã closed)"
show "GET /results" "$(call GET /api/results/$SESSION_ID "$USER_TOKEN")"
echo

bold "12. Admin xem logs"
show "GET /logs" "$(call GET "/api/logs?sessionId=$SESSION_ID" "$ADMIN_TOKEN")"
echo

bold "13. Kiểm tra phân quyền: user thường gọi endpoint admin -> phải 403"
show "POST /session/:id/start (bằng user thường)" "$(call POST /api/session/$SESSION_ID/start "$USER_TOKEN" "{\"durationSeconds\":10}")"

bold "HOÀN TẤT."
