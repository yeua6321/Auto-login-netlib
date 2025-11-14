const axios = require('axios');
const { chromium } = require('playwright');

const token = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID;
const accounts = process.env.ACCOUNTS;

if (!accounts) {
  console.log('❌ 未配置账号');
  process.exit(1);
}

// 解析多个账号，支持逗号或分号分隔
const accountList = accounts.split(/[,;]/).map(account => {
  const [user, pass] = account.split(":").map(s => s.trim());
  return { user, pass };
}).filter(acc => acc.user && acc.pass);

if (accountList.length === 0) {
  console.log('❌ 账号格式错误，应为 username1:password1,username2:password2');
  process.exit(1);
}

// 新增：将密码隐藏显示
function maskPassword(pass) {
  if (!pass) return '****';
  return pass.length <= 2 ? '*'.repeat(pass.length) : '****' + pass.slice(-2);
}

async function sendTelegram(message) {
  // 检查配置
  if (!token || !chatId) {
    console.log('⚠️ Telegram 未配置');
    console.log(`  BOT_TOKEN: ${token ? '✅ 已设置' : '❌ 未设置'}`);
    console.log(`  CHAT_ID: ${chatId ? '✅ 已设置' : '❌ 未设置'}`);
    return;
  }

  const now = new Date();
  const hkTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const timeStr = hkTime.toISOString().replace('T', ' ').substr(0, 19) + " HKT";

  const fullMessage = `🎉 Netlib 登录通知\n\n登录时间：${timeStr}\n\n${message}`;

  try {
    console.log(`📤 正在发送 Telegram 消息到 ${chatId}...`);
    
    const response = await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`, 
      {
        chat_id: chatId,
        text: fullMessage
      }, 
      { timeout: 15000 }
    );
    
    if (response.data.ok) {
      console.log('✅ Telegram 通知发送成功');
    } else {
      console.log('❌ Telegram API 返回错误:', JSON.stringify(response.data, null, 2));
    }
    
  } catch (e) {
    console.log('⚠️ Telegram 发送失败');
    
    // 详细错误信息
    if (e.response) {
      console.log('HTTP 状态码:', e.response.status);
      console.log('错误信息:', JSON.stringify(e.response.data, null, 2));
      
      // 常见错误提示
      if (e.response.status === 404) {
        console.log('💡 Bot Token 无效，请检查 BOT_TOKEN');
      } else if (e.response.status === 400) {
        console.log('💡 Chat ID 错误，或者你还没有给机器人发送过 /start');
      } else if (e.response.status === 401) {
        console.log('💡 Bot Token 未授权');
      }
    } else if (e.code === 'ECONNABORTED') {
      console.log('💡 请求超时，检查网络连接');
    } else if (e.code === 'ENOTFOUND') {
      console.log('💡 无法连接到 Telegram API，检查网络或代理设置');
    } else {
      console.log('错误详情:', e.message);
    }
  }
}

async function loginWithAccount(user, pass) {
  console.log(`\n🚀 开始登录账号: ${user}`);
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  let page;
  let result = { user, success: false, message: '' };
  
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(30000);
    
    console.log(`📱 ${user} - 正在访问网站...`);
    await page.goto('https://www.netlib.re/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    
    console.log(`🔑 ${user} - 点击登录按钮...`);
    await page.click('text=Login', { timeout: 5000 });
    
    await page.waitForTimeout(2000);
    
    console.log(`📝 ${user} - 填写用户名...`);
    await page.fill('input[name="username"], input[type="text"]', user);
    await page.waitForTimeout(1000);
    
    console.log(`🔒 ${user} - 填写密码...`);
    await page.fill('input[name="password"], input[type="password"]', pass);
    await page.waitForTimeout(1000);
    
    console.log(`📤 ${user} - 提交登录...`);
    await page.click('button:has-text("Validate"), input[type="submit"]');
    
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);
    
    // 检查登录是否成功
    const pageContent = await page.content();
    
    if (pageContent.includes('exclusive owner') || pageContent.includes(user)) {
      console.log(`✅ ${user} - 登录成功`);
      result.success = true;
      result.message = `✅ ${user} 登录成功`;
    } else {
      console.log(`❌ ${user} - 登录失败`);
      result.message = `❌ ${user} 登录失败`;
    }
    
  } catch (e) {
    console.log(`❌ ${user} - 登录异常: ${e.message}`);
    result.message = `❌ ${user} 登录异常: ${e.message}`;
  } finally {
    if (page) await page.close();
    await browser.close();
  }
  
  return result;
}

async function main() {
  console.log(`🔍 发现 ${accountList.length} 个账号需要登录`);
  
  const results = [];
  
  for (let i = 0; i < accountList.length; i++) {
    const { user, pass } = accountList[i];
    console.log(`\n📋 处理第 ${i + 1}/${accountList.length} 个账号: ${user}`);
    
    const result = await loginWithAccount(user, pass);
    results.push(result);
    
    // 如果不是最后一个账号，等待一下再处理下一个
    if (i < accountList.length - 1) {
      console.log('⏳ 等待3秒后处理下一个账号...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // 汇总所有结果并发送一条消息
  const successCount = results.filter(r => r.success).length;
  const totalCount = results.length;
  
  let summaryMessage = `📊 登录汇总: ${successCount}/${totalCount} 个账号成功\n\n`;
  
  results.forEach(result => {
    summaryMessage += `${result.message}\n`;
  });
  
  await sendTelegram(summaryMessage);
  
  console.log('\n✅ 所有账号处理完成！');
}

main().catch(console.error);
