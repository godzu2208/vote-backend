import 'dotenv/config';
import { createApp } from './app';
import { startCloseSessionWatcher } from './cron/closeSessionCron';

const PORT = Number(process.env.PORT) || 4000;

const app = createApp();

startCloseSessionWatcher();

app.listen(PORT, () => {
  console.log(`[vote-backend] đang chạy tại http://localhost:${PORT}`);
});
