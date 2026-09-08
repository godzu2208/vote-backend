import { Request } from 'express';
import { UAParser } from 'ua-parser-js';

/**
 * Lấy IP thật của client, có tính đến trường hợp chạy sau reverse proxy
 * (Railway/Render đều set X-Forwarded-For). Nhớ bật `app.set('trust proxy', 1)`
 * ở server.ts để req.ip đọc đúng header này.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/** Lấy chuỗi User-Agent thô từ request. Lưu nguyên dạng này vào DB (đừng lưu bản đã rút gọn -
 * lưu thô để không mất thông tin, chỉ rút gọn lúc hiển thị bằng formatUserAgent()). */
export function getRawUserAgent(req: Request): string {
  return req.headers['user-agent'] || 'unknown';
}

/**
 * Rút gọn User-Agent thô thành dạng dễ đọc cho trang log,
 * ví dụ: "Chrome 128 on iOS (mobile)" thay vì chuỗi UA thô dài dòng.
 * Dùng khi TRẢ dữ liệu về cho trang /admin/logs, không dùng lúc ghi vào DB.
 */
export function formatUserAgent(raw: string | null | undefined): string {
  if (!raw) return 'unknown';
  const parser = new UAParser(raw);
  const browser = parser.getBrowser();
  const os = parser.getOS();
  const device = parser.getDevice();

  const parts = [
    browser.name ? `${browser.name} ${browser.version ?? ''}`.trim() : null,
    os.name ? `on ${os.name} ${os.version ?? ''}`.trim() : null,
    device.type ? `(${device.type})` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' ') : raw;
}
