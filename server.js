const axios = require('axios');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// 初始化 Express
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 配置
const BASE_URL = 'https://rnr.valuegb.com/RNR_TW/rnr_action.jsp';
const MAX_SIM_PER_NAME = 5;
const TEST_SIMS = 100000; // 測試 100 個 ICCID（可改為 100000）
const BATCH_SIZE = 5;
const MIN_DELAY_MS = 2000;
const MAX_DELAY_MS = 5000;

// 存儲激活任務狀態
const tasks = new Map(); // 任務 ID -> { status, results, prefix }

// 隨機 User-Agent 列表
const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.114 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Mobile/15E148 Safari/604.1',
];

// 隨機選擇 User-Agent
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// 隨機延遲
function randomDelay() {
  const delay = Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// 生成隨機英文姓名
function generateName() {
  const firstNames = ['FUNG', 'CHAN', 'WONG', 'LEUNG', 'TAM', 'HO', 'LI', 'CHEUNG'];
  const middleNames = ['CHI', 'MAN', 'WAI', 'KA', 'YING', 'HIN', 'SIU'];
  const lastNames = ['KAUN', 'MING', 'HOI', 'YIN', 'TUNG', 'SHAN', 'KIT'];
  return `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${
    middleNames[Math.floor(Math.random() * middleNames.length)]
  } ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
}

// 生成護照號碼
function generatePassportNumber() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let passport = '';
  for (let i = 0; i < 5; i++) {
    passport += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  passport += Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return passport;
}

// 提交激活請求
async function activateSIM(iccid, name, passportNumber) {
  try {
    const response = await axios.post(
      BASE_URL,
      new URLSearchParams({
        e_name: name,
        iccid: iccid,
        id_type: 'passport',
        id_code: passportNumber,
        hkid: '',
        licensee: 'vgb',
      }).toString(),
      {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://rnr.valuegb.com/RNR_TW/rnr.jsp?lang=zh&type=vgb',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 60000,
      }
    );

    const result = {
      iccid,
      name,
      passportNumber,
      status: '',
      message: '',
    };

    switch (parseInt(response.data)) {
      case 0:
        result.status = '成功';
        result.message = '實名登記已完成';
        break;
      case 6:
        result.status = '失敗';
        result.message = '請勿重複提交';
        break;
      case 5:
        result.status = '失敗';
        result.message = 'SIM 卡類型不符';
        break;
      case 3:
        result.status = '失敗';
        result.message = 'SIM 卡已完成登記，無需再次登記';
        break;
      case 2:
        result.status = '失敗';
        result.message = '請輸入有效的 ICCID 號碼';
        break;
      case 10:
        result.status = '失敗';
        result.message = '你的 SIM 卡無效，請檢查並重試';
        break;
      default:
        result.status = '失敗';
        result.message = `未知回應: ${response.data}`;
    }

    console.error(`ICCID: ${iccid}, 狀態: ${result.status}, 訊息: ${result.message}`);
    return result;
  } catch (error) {
    const errorMsg = `激活 ${iccid} 失敗: ${error.message}`;
    console.error(errorMsg);
    return {
      iccid,
      name,
      passportNumber,
      status: '失敗',
      message: errorMsg,
    };
  }
}

// 記錄結果到 CSV
async function logResult(result) {
  const logEntry = `${result.iccid},${result.name},${result.passportNumber},${result.status},${result.message}\n`;
  await fs.appendFile('activation_log.csv', logEntry);
}

// 初始化 CSV 文件
async function initLogFile() {
  const header = 'ICCID,英文姓名,護照號碼,狀態,訊息\n';
  await fs.writeFile('activation_log.csv', header);
}

// 激活 SIM 卡主邏輯
async function activateSIMs(prefix, taskId) {
  if (!/^\d{15}$/.test(prefix)) {
    tasks.set(taskId, { status: 'failed', message: '錯誤：ICCID 前綴必須為 15 位數字', results: [] });
    console.error(`任務 ${taskId}: 無效 ICCID 前綴 ${prefix}`);
    return;
  }

  tasks.set(taskId, { status: 'running', results: [], prefix });
  console.error(`任務 ${taskId}: 開始 SIM 卡激活，使用前綴: ${prefix}`);

  await initLogFile();
  let currentName = generateName();
  let nameCount = 0;
  const nameUsage = new Map();
  const results = [];

  for (let i = 0; i < TEST_SIMS; i += BATCH_SIZE) {
    const batch = [];
    for (let j = 0; j < BATCH_SIZE && i + j < TEST_SIMS; j++) {
      const suffix = (i + j).toString().padStart(5, '0');
      const iccid = prefix + suffix;

      if (nameCount >= MAX_SIM_PER_NAME) {
        currentName = generateName();
        nameCount = 0;
        while (nameUsage.has(currentName) && nameUsage.get(currentName) >= MAX_SIM_PER_NAME) {
          currentName = generateName();
        }
      }

      nameUsage.set(currentName, (nameUsage.get(currentName) || 0) + 1);
      nameCount++;

      const passportNumber = generatePassportNumber();
      batch.push(activateSIM(iccid, currentName, passportNumber));
    }

    const batchResults = await Promise.all(batch);
    for (const result of batchResults) {
      await logResult(result);
      results.push(result);
    }

    tasks.set(taskId, { status: 'running', results, prefix });
    await randomDelay();
  }

  tasks.set(taskId, { status: 'completed', results, prefix });
  console.error(`任務 ${taskId}: 激活完成，結果已記錄到 activation_log.csv`);
}

// Web 表單路由
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>SIM 卡激活</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #333; }
          .form-container { max-width: 500px; }
          input[type="text"] { width: 100%; padding: 8px; margin: 10px 0; }
          input[type="submit"] { padding: 10px 20px; background: #ff6f00; color: white; border: none; cursor: pointer; }
          input[type="submit"]:hover { background: #e65f00; }
        </style>
      </head>
      <body>
        <h1>輸入 ICCID 前綴</h1>
        <div class="form-container">
          <form action="/activate" method="post">
            <label>ICCID 前綴（15 位數字）:</label>
            <input type="text" name="iccid_prefix" placeholder="例如 898520624103438" required>
            <input type="submit" value="開始激活">
          </form>
        </div>
      </body>
    </html>
  `);
});

// 處理表單提交
app.post('/activate', async (req, res) => {
  const prefix = req.body.iccid_prefix;
  const taskId = Date.now().toString(); // 簡單的任務 ID

  // 啟動激活任務（後台運行）
  activateSIMs(prefix, taskId).catch((error) => {
    console.error(`任務 ${taskId} 錯誤: ${error.message}`);
    tasks.set(taskId, { status: 'failed', message: error.message, results: [] });
  });

  // 立即返回響應，告知客戶任務正在運行
  res.send(`
    <html>
      <head>
        <title>SIM 卡激活</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #333; }
        </style>
      </head>
      <body>
        <h1>激活任務已啟動</h1>
        <p>正在處理 ICCID 前綴：${prefix}</p>
        <p>任務 ID：${taskId}</p>
        <p>請稍後訪問 <a href="/status/${taskId}">任務狀態</a> 查看進度或結果。</p>
        <p><a href="/">返回表單</a></p>
      </body>
    </html>
  `);
});

// 檢查任務狀態
app.get('/status/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  const task = tasks.get(taskId);

  if (!task) {
    res.send(`
      <html>
        <head><title>任務不存在</title><meta charset="utf-8"></head>
        <body>
          <h1>任務不存在</h1>
          <p>無效的任務 ID：${taskId}</p>
          <p><a href="/">返回表單</a></p>
        </body>
      </html>
    `);
    return;
  }

  if (task.status === 'failed') {
    res.send(`
      <html>
        <head><title>任務失敗</title><meta charset="utf-8"></head>
        <body>
          <h1>任務失敗</h1>
          <p>ICCID 前綴：${task.prefix}</p>
          <p>錯誤：${task.message}</p>
          <p><a href="/">返回表單</a></p>
        </body>
      </html>
    `);
    return;
  }

  res.send(`
    <html>
      <head>
        <title>SIM 卡激活結果</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #333; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
          .success { color: green; }
          .failure { color: red; }
        </style>
      </head>
      <body>
        <h1>SIM 卡激活結果（前綴：${task.prefix}）</h1>
        <p>任務狀態：${task.status === 'running' ? '運行中' : '已完成'}</p>
        <p>已處理 ${task.results.length} / ${TEST_SIMS} 個 ICCID</p>
        <p><a href="/download/${taskId}">下載結果 CSV</a></p>
        <table>
          <tr>
            <th>ICCID</th>
            <th>英文姓名</th>
            <th>護照號碼</th>
            <th>狀態</th>
            <th>訊息</th>
          </tr>
          ${task.results
            .map(
              (r) => `
                <tr>
                  <td>${r.iccid}</td>
                  <td>${r.name}</td>
                  <td>${r.passportNumber}</td>
                  <td class="${r.status === '成功' ? 'success' : 'failure'}">${r.status}</td>
                  <td>${r.message}</td>
                </tr>`
            )
            .join('')}
        </table>
        <p><a href="/">返回表單</a></p>
      </body>
    </html>
  `);
});

// 下載 CSV
app.get('/download/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  const task = tasks.get(taskId);

  if (!task) {
    res.status(404).send('任務不存在');
    return;
  }

  const filePath = 'activation_log.csv';
  try {
    await fs.access(filePath);
    res.download(filePath, `activation_log_${task.prefix}.csv`);
  } catch (error) {
    res.status(404).send('結果文件不可用，請檢查任務狀態');
  }
});

// 啟動服務器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.error(`服務器運行在端口 ${PORT}`);
});