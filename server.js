 import express from 'express';
  import lark from '@larksuiteoapi/node-sdk';
  import OpenAI from 'openai';
  import crypto from 'crypto';

  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  const config = {
    feishu: {
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
      encryptKey: process.env.FEISHU_ENCRYPT_KEY
    },
    table: {
      appToken: process.env.TABLE_APP_TOKEN,
      tableId: process.env.TABLE_ID
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      enabled: process.env.OPENAI_ENABLED === 'true'
    }
  };

  let client, openai, cipher;

  function init() {
    if (!client) {
      client = new lark.Client({
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret
      });
    }

    // 初始化加密器
    if (!cipher && config.feishu.encryptKey) {
      cipher = new lark.AESCipher(config.feishu.encryptKey);
    }

    if (config.openai.enabled && !openai) {
      openai = new OpenAI({ apiKey: config.openai.apiKey });
    }
  }

  function extractUrls(text) {
    const regex = /(https?:\/\/[^\s<>]+)/g;
    return [...new Set(text.match(regex) || [])];
  }

  async function analyzeUrl(url) {
    if (!config.openai.enabled || !openai) {
      return { title: url, author: '未知', direction: '其他', tags: [] };
    }

    try {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: '分析链接返回JSON：{"title":"标题","author":"作者","direction":"技术/产品/设计/资讯/其他","tags":["标签"],"summary":"摘要"}'
        }, {
          role: 'user',
          content: `分析：${url}`
        }],
        response_format: { type: 'json_object' }
      });
      return JSON.parse(res.choices[0].message.content);
    } catch (err) {
      console.error('AI分析失败:', err.message);
      return { title: url, author: '未知', direction: '其他', tags: [] };
    }
  }

  async function saveToTable(data) {
    try {
      await client.bitable.appTableRecord.create({
        path: {
          app_token: config.table.appToken,
          table_id: config.table.tableId
        },
        data: {
          fields: {
            '链接URL': data.url,
            '标题': data.title || data.url,
            '分享时间': Date.now(),
            '原作者': data.author || '未知',
            '内容方向': data.direction || '其他',
            '标签': data.tags || [],
            '摘要': data.summary || '',
            '分享者': data.sharedBy || '',
            '群组': data.groupName || ''
          }
        }
      });
      console.log('✅ 保存成功:', data.url);
    } catch (err) {
      console.error('❌ 保存失败:', err.message);
    }
  }

  async function handleMessage(msg) {
    if (msg.message_type !== 'text') return;

    const text = JSON.parse(msg.content).text;
    const urls = extractUrls(text);

    if (urls.length === 0) return;

    console.log(`发现 ${urls.length} 个链接`);

    for (const url of urls) {
      const analysis = await analyzeUrl(url);
      await saveToTable({
        url,
        title: analysis.title,
        author: analysis.author,
        direction: analysis.direction,
        tags: analysis.tags,
        summary: analysis.summary,
        sharedBy: msg.sender?.sender_id?.user_id,
        groupName: msg.chat_id
      });
    }
  }

  // GET / 和 /webhook/event
  app.get(['/', '/webhook/event'], (req, res) => {
    res.json({
      status: 'ok',
      message: '🐿️ SquirrelStash is running!'
    });
  });

  // POST /webhook/event
  app.post('/webhook/event', async (req, res) => {
    init();

    let body = req.body;

    // 如果是加密消息，先解密
    if (body.encrypt) {
      console.log('=== 收到加密消息，正在解密 ===');
      try {
        const decryptedStr = cipher.decrypt(body.encrypt);
        body = JSON.parse(decryptedStr);
        console.log('✅ 解密成功');
      } catch (err) {
        console.error('❌ 解密失败:', err.message);
        console.error('❌ 错误详情:', err);
        return res.json({ code: 1, message: '解密失败' });
      }
    }

    // 添加详细日志
    console.log('=== 收到飞书请求 ===');
    console.log('完整请求体:', JSON.stringify(body, null, 2));
    console.log('请求类型:', body.type);
    console.log('Challenge:', body.challenge);

    // 飞书 URL 验证
    if (body.type === 'url_verification') {
      console.log('>>> 这是验证请求，返回 challenge');
      const response = { challenge: body.challenge };
      console.log('>>> 返回内容:', JSON.stringify(response));
      return res.json(response);
    }

    // 处理消息事件
    if (body.header?.event_type === 'im.message.receive_v1') {
      console.log('>>> 这是消息事件');
      setImmediate(() => handleMessage(body.event.message));
      return res.json({ code: 0 });
    }

    console.log('>>> 未知请求类型');
    return res.json({ code: 0 });
  });

  app.listen(PORT, () => {
    console.log(`🐿️ SquirrelStash 运行在端口 ${PORT}`);
  });




