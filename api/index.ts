import "dotenv/config";
import { createApp } from "../src/app";

// Express app là 1 hàm callable (req, res) => void, nên export default trực tiếp
// app instance là hợp lệ với Vercel — KHÔNG export default createApp (đó là factory,
// không phải request handler).
const app = createApp();

export default app;
