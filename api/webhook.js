import lark from '@larksuiteoapi/node-sdk';
  import OpenAI from 'openai';

  const config = {
    feishu: {
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET
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

  let client, openai;

  function init() {
    if (!client) {
      client = new lark.Client({
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret
      });
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

  export default async function handler(req, res) {
    init();

    if (req.method === 'GET') {
      return res.json({
        status: 'ok',
        message: '🐿️ SquirrelStash is running!'
      });
    }

    if (req.method === 'POST') {
      const body = req.body;

      // 飞书 URL 验证
      if (body.type === 'url_verification') {
        return res.json({ challenge: body.challenge });
      }

      // 处理消息事件
      if (body.header?.event_type === 'im.message.receive_v1') {
        setImmediate(() => handleMessage(body.event.message));
        return res.json({ code: 0 });
      }

      return res.json({ code: 0 });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }



