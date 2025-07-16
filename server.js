const axios = require('axios');
const fs = require('fs').promises;

// 配置
const BASE_URL = 'https://rnr.valuegb.com/RNR_TW/rnr_action.jsp';
const PREFIX = '898520624103438'; // 客戶提供的前綴
const MAX_SIM_PER_NAME = 5; // 每個姓名最多用於 5 張 SIM 卡
const TEST_SIMS = 100; // 測試 100 個 ICCID（可改為 100000）
const BATCH_SIZE = 5; // 每批處理 5 個
const MIN_DELAY_MS = 2000; // 最小延遲 2 秒
const MAX_DELAY_MS = 5000; // 最大延遲 5 秒

// 隨機 User-Agent 列表，模擬不同設備
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

// 生成隨機英文姓名（例如 FUNG CHI KAUN）
function generateName() {
  const firstNames = ['FUNG', 'CHAN', 'WONG', 'LEUNG', 'TAM', 'HO', 'LI', 'CHEUNG'];
  const middleNames = ['CHI', 'MAN', 'WAI', 'KA', 'YING', 'HIN', 'SIU'];
  const lastNames = ['KAUN', 'MING', 'HOI', 'YIN', 'TUNG', 'SHAN', 'KIT'];
  return `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${
    middleNames[Math.floor(Math.random() * middleNames.length)]
  } ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
}

// 生成護照號碼（5 個字母 + 3 位數字）
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

// 跟踪姓名使用次數
const nameUsage = new Map();

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

    return result;
  } catch (error) {
    return {
      iccid,
      name,
      passportNumber,
      status: '失敗',
      message: `請求失敗: ${error.message}`,
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

// 主函數
async function main() {
  console.log('開始 SIM 卡激活...');
  await initLogFile();
  let currentName = generateName();
  let nameCount = 0;

  for (let i = 0; i < TEST_SIMS; i += BATCH_SIZE) {
    const batch = [];
    for (let j = 0; j < BATCH_SIZE && i + j < TEST_SIMS; j++) {
      const suffix = (i + j).toString().padStart(5, '0');
      const iccid = PREFIX + suffix;

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

    const results = await Promise.all(batch);
    for (const result of results) {
      await logResult(result);
      console.log(`ICCID: ${result.iccid}, 狀態: ${result.status}, 訊息: ${result.message}`);
    }

    await randomDelay(); // 隨機延遲 2-5 秒
  }

  console.log('激活完成，結果已記錄到 activation_log.csv');
}

// 啟動腳本
main().catch((error) => {
  console.error('腳本運行錯誤:', error);
});