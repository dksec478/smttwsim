const axios = require('axios');
const fs = require('fs').promises;

// 配置
const BASE_URL = 'https://rnr.valuegb.com/RNR_TW/rnr_action.jsp';
const PREFIX = '898520624103438'; // 客戶提供的前綴
const MAX_SIM_PER_NAME = 5; // 每個姓名最多用於 5 張 SIM 卡
const TEST_SIMS = 10; // 測試 10 個 ICCID
const BATCH_SIZE = 5; // 每批處理 5 個

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
      {
        e_name: name,
        iccid: iccid,
        id_type: 'passport',
        id_code: passportNumber,
        hkid: '', // 護照無需 HKID
        licensee: 'vgb',
      },
      {
        timeout: 60000, // 60 秒超時
      }
    );

    // 處理回應（根據 HTML 的 popup0 錯誤代碼）
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
        result Depp
        result.status = '失敗';
        result.message = '請輸入有效的 ICCID 號碼';
        break;
      case 10:
        result.status = '失敗';
        result.message = '你的 SIM 卡無效，請檢查並重試';
        break;
      default:
        result.status = '失敗';
        result.message = '上傳失敗，請稍後再試';
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
  await initLogFile();
  let currentName = generateName();
  let nameCount = 0;

  for (let i = 0; i < TEST_SIMS; i += BATCH_SIZE) {
    const batch = [];
    for (let j = 0; j < BATCH_SIZE && i + j < TEST_SIMS; j++) {
      const suffix = (i + j).toString().padStart(5, '0');
      const iccid = PREFIX + suffix;

      // 檢查姓名使用次數
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

    // 並行處理批次
    const results = await Promise.all(batch);
    for (const result of results) {
      await logResult(result);
      console.log(`ICCID: ${result.iccid}, 狀態: ${result.status}, 訊息: ${result.message}`);
    }

    // 批次間隔 1 秒
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log('測試完成，結果已記錄到 activation_log.csv');
}

// 啟動腳本
main().catch((error) => {
  console.error('腳本運行錯誤:', error);
});