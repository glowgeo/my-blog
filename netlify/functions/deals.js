/* ============================================================
   薅羊毛数据接口（Netlify Function）
   ------------------------------------------------------------
   数据来源：什么值得买「精选好价」feed
     https://www.smzdm.com/jingxuan/

   为什么用 Netlify Function 而不是 GitHub Actions：
     10 分钟一更新 = 一天 144 次。如果用 Actions 提交到仓库，
     一年会攒下 5 万多次提交、上百 MB 历史。
     用 Function + CDN 缓存就完全没有这个问题，
     而且免费额度（12.5 万次/月）我们只用到 4000 多次。

   服务端抓取，所以没有浏览器跨域问题；
   结果缓存 10 分钟，对源站的压力是每小时最多 6 次请求。
   ============================================================ */

const SOURCE_URL = "https://www.smzdm.com/jingxuan/";
const CACHE_SECONDS = 600; // 10 分钟
const FETCH_TIMEOUT = 9000; // 单次尝试上限（函数本身有 10 秒硬上限）
const FETCH_ATTEMPTS = 2; // 冷启动/抖动时再试一次

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/* ---------- 小工具 ---------- */

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/* 从 onclick 里挖出埋着的数据，例如 'mall_name':'京东'
   注意下标：m[0] 形如  'mall_name':'京东'
   0 是起始引号，1..n 是 key，然后依次是 ' : ' ，最后一个是收尾引号。
   所以值从 key.length + 4 开始，到倒数第一个字符为止。 */
function pickFromOnclick(chunk, key) {
  const re = new RegExp("'" + key + "':'(?:[^'\\\\]|\\\\.)*'");
  const m = chunk.match(re);
  if (!m) return "";
  const val = m[0].slice(key.length + 4, -1);
  return decodeEntities(val.replace(/\\'/g, "'").replace(/\\\\/g, "\\")).trim();
}

function bjTime(ts) {
  const n = Number(ts);
  if (!n) return "";
  const d = new Date(n * 1000);
  if (isNaN(d.getTime())) return "";
  const bj = new Date(d.getTime() + (8 * 60 + d.getTimezoneOffset()) * 60000);
  const p = (x) => String(x).padStart(2, "0");
  return `${bj.getMonth() + 1}/${bj.getDate()} ${p(bj.getHours())}:${p(bj.getMinutes())}`;
}

/* ---------- 核心：解析好价列表 ---------- */

function parseDeals(html) {
  const out = [];
  const seen = new Set();

  const titleRe =
    /<h5 class="feed-block-title">\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  let m;
  while ((m = titleRe.exec(html)) !== null) {
    const url = m[1];
    const title = stripTags(m[2]);
    if (!url || !title) continue;
    const idMatch = url.match(/\/p\/(\d+)/);
    const id = idMatch ? idMatch[1] : url;
    if (seen.has(id)) continue;
    seen.add(id);

    /* 本条的范围：往前 1500 字符取图片/时间；
       往后一直到「下一条 feed-row-wide」为止，避免串到隔壁。
       （不能只往后取固定长度——onclick 动辄几百字符，会把描述挤出去）*/
    const before = html.slice(Math.max(0, m.index - 1500), m.index);
    let nextBlock = html.indexOf("feed-row-wide", m.index + 10);
    if (nextBlock < 0) nextBlock = html.length;
    const after = html.slice(m.index, Math.min(nextBlock, m.index + 12000));

    /* 图片：取前面最后一个 img */
    let image = "";
    const imgs = before.match(/<img[^>]+src="([^"]+)"/g);
    if (imgs && imgs.length) {
      const last = imgs[imgs.length - 1].match(/src="([^"]+)"/);
      if (last) image = last[1];
    }

    /* 发布时间 */
    const tsMatch = before.match(/timesort="(\d+)"/);
    const time = tsMatch ? bjTime(tsMatch[1]) : "";

    /* 价格 */
    let price = "";
    const pm = after.match(/<a class="z-highlight"[^>]*>([\s\S]*?)<\/a>/);
    if (pm) price = stripTags(pm[1]);

    /* 官方打的小标签，如「低于常卖价」「商品好评率98%」 */
    const tags = [];
    const tm = after.match(/<span class="feed-block-tags">([\s\S]*?)<\/span>/);
    if (tm) {
      const its = tm[1].match(/<i>([\s\S]*?)<\/i>/g) || [];
      for (const it of its) {
        const t = stripTags(it);
        if (t) tags.push(t);
      }
    }

    /* 描述 */
    let desc = "";
    const dm = after.match(/<div class="feed-block-descripe">([\s\S]*?)<\/div>/);
    if (dm) {
      desc = stripTags(dm[1].replace(/<a[^>]*>[\s\S]*?<\/a>/g, ""));
      if (desc.length > 110) desc = desc.slice(0, 110).replace(/[，,、；;]$/, "") + "…";
    }

    /* 分类标签（绝对值 / 今日必买 / 历史新低 / 手慢无 …）
       注意：match() 加了 g 之后返回的是「整个匹配」而不是捕获组，
       所以要自己把标签名前面的属性部分截掉。 */
    const badges = [];
    const bm = after.match(/tag-level\d[^>]*>[^<]+<\/a>/g) || [];
    for (const b of bm) {
      const t = stripTags(b.replace(/^[^>]*>/, "").replace(/<\/a>$/, ""));
      if (t && badges.indexOf(t) < 0) badges.push(t);
    }

    /* 商城 / 品牌 / 分类 */
    const mall = pickFromOnclick(after, "mall_name");
    const brand = pickFromOnclick(after, "brand");
    const category = pickFromOnclick(after, "cate_level1");

    out.push({
      id,
      title,
      url,
      price,
      image,
      time,
      tags,
      badges,
      mall,
      brand,
      category,
      desc,
      isAbsolute: badges.indexOf("绝对值") >= 0,
    });
  }

  /* 有「绝对值」的排前面，其余按时间倒序 */
  out.sort((a, b) => {
    if (a.isAbsolute !== b.isAbsolute) return a.isAbsolute ? -1 : 1;
    return 0;
  });

  return out;
}

/* ---------- HTTP 处理 ---------- */

async function fetchPage() {
  let lastErr = new Error("未知错误");

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(SOURCE_URL, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          Referer: "https://www.smzdm.com/",
          "Upgrade-Insecure-Requests": "1",
          "Cache-Control": "no-cache",
        },
      });
      if (!res.ok) throw new Error(`源站返回 HTTP ${res.status}`);
      const html = await res.text();

      /* 源站有风控：请求太频繁会被丢一个腾讯验证码页面过来。
         这里明确识别出来，免得把验证码页当成正常页面去解析。 */
      if (/TCaptcha|captcha\.qq\.com|__captcha/i.test(html)) {
        throw new Error("被源站风控拦了（要求人机验证），稍后会自动重试");
      }
      /* 被拦时也可能返回一个很短的页面，用长度再兜一层 */
      if (html.length < 5000) throw new Error("返回内容过短，可能被拦截");

      return html;
    } catch (err) {
      lastErr = err;
      /* 还有下一次机会的话，稍微等一下再试 */
      if (attempt < FETCH_ATTEMPTS) await new Promise((r) => setTimeout(r, 300));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr;
}

function nowLabel() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(
    d.getUTCHours()
  )}:${p(d.getUTCMinutes())}`;
}

async function buildPayload() {
  const html = await fetchPage();
  const deals = parseDeals(html);
  if (!deals.length) throw new Error("页面结构变了，一条都没解析出来");
  return {
    ok: true,
    updated: nowLabel(),
    source: "什么值得买",
    sourceUrl: SOURCE_URL,
    count: deals.length,
    absoluteCount: deals.filter((d) => d.isAbsolute).length,
    deals,
  };
}

/* 进程内缓存：Netlify 的热实例会复用，能进一步减少对源站的请求 */
let memo = { at: 0, payload: null };

exports.handler = async () => {
  const now = Date.now();

  if (memo.payload && now - memo.at < CACHE_SECONDS * 1000) {
    return respond(memo.payload, Math.round((CACHE_SECONDS * 1000 - (now - memo.at)) / 1000));
  }

  try {
    const payload = await buildPayload();
    memo = { at: now, payload };
    return respond(payload, CACHE_SECONDS);
  } catch (err) {
    /* 失败了也把旧数据端出去，总比空白强 */
    if (memo.payload) {
      return respond(Object.assign({}, memo.payload, { stale: true, error: err.message }), 60);
    }
    return {
      statusCode: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};

function respond(payload, maxAge) {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify(payload),
  };
}

/* 导出给本地测试用 */
exports._parseDeals = parseDeals;
exports._buildPayload = buildPayload;
