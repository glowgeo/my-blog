/**
 * 每日新闻抓取
 * ------------------------------------------------------------------
 * 用法：node tools/fetch-news.mjs
 * 输出：data/news.json
 *
 * 设计要点：
 *   1. 零依赖 —— 自己解析 RSS，不装任何 npm 包
 *   2. 抓取失败时保留上一次的数据，不会把页面搞空
 *   3. 会过滤掉推广软文（比如界面新闻的 ETF 荐股稿）
 *
 * 这个脚本由 .github/workflows/news.yml 每天自动跑一次。
 * ------------------------------------------------------------------
 */

import fs from "node:fs";
import path from "node:path";

/* ============================================================
   新闻源配置
   想加源就在这里加一条。exclude 是软文过滤规则。
   ============================================================ */
const SOURCES = [
  {
    name: "要闻",
    source: "中国新闻网",
    homepage: "https://www.chinanews.com.cn/",
    url: "https://www.chinanews.com.cn/rss/scroll-news.xml",
    limit: 14,
  },
  {
    name: "财经",
    source: "界面新闻",
    homepage: "https://www.jiemian.com/",
    url: "https://a.jiemian.com/index.php?m=article&a=rss",
    limit: 10,
    // 界面新闻里「有连云」发的全是 ETF 荐股软文，直接整条丢掉
    excludeAuthor: /有连云|基金|证券|理财/,
    // 标题里带基金代码的也是荐股稿
    excludeTitle: /ETF|指数基金|净值|涨幅榜|标的指数|\(\d{6}\)|（\d{6}）/,
  },
  {
    name: "科技",
    source: "少数派",
    homepage: "https://sspai.com/",
    url: "https://sspai.com/feed",
    limit: 8,
  },
];

const OUT_FILE = path.join(process.cwd(), "data", "news.json");
const TIMEOUT_MS = 25000;

/* ============================================================
   RSS 解析（够用就好，不追求完整实现 XML 规范）
   ============================================================ */

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

function pick(block, tagName) {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  let v = m[1].trim();
  const cd = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cd) v = cd[1].trim();
  return decodeEntities(v);
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * 把 RSS 描述里的官样套话剪掉，只留真正的内容。
 * 例如：「中新网济南9月23日电 (孙倩)“黄河流域是……」→「“黄河流域是……」
 */
function cleanSummary(raw) {
  let s = stripTags(raw);

  // 去掉开头的「中新网XX9月23日电 (记者 某某)」
  s = s.replace(/^[\s\u3000]*中新[网社][^，。]{0,25}?电\s*/, "");
  s = s.replace(/^[\s\u3000]*(?:据)?新华社[^，。]{0,20}?电\s*/, "");
  s = s.replace(/^[\s\u3000]*[（(](?:记者|通讯员)[^)）]{0,25}[)）]\s*/, "");
  s = s.replace(/^[\s\u3000]*题[:：]\s*/, "");

  // 去掉各家模板尾巴
  s = s.replace(/[\s\u3000]*查看全文[\s\u3000]*$/g, "");
  s = s.replace(/[\s\u3000]*阅读全文[\s\u3000]*$/g, "");
  s = s.replace(/[\s\u3000]*点击(?:查看|阅读)[^。]{0,10}$/g, "");

  s = s.trim();
  if (s.length > 80) s = s.slice(0, 80).replace(/[，,、；;]$/, "") + "…";
  return s;
}

/** 摘要和标题基本一样时就没必要显示了 */
function sameAsTitle(summary, title) {
  const norm = (x) => x.replace(/[\s\u3000“”"'「」【】〔〕:：，,。.、·—\-]/g, "");
  const a = norm(summary);
  const b = norm(title);
  if (!a) return true;
  return a === b || (a.length > 8 && (b.startsWith(a) || a.startsWith(b)));
}

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    items.push({
      title: stripTags(pick(b, "title")),
      link: pick(b, "link") || pick(b, "guid"),
      summary: cleanSummary(pick(b, "description")),
      author: stripTags(pick(b, "author")),
      pubDate: pick(b, "pubDate") || pick(b, "dc:date"),
    });
  }
  return items;
}

/* ============================================================
   抓取
   ============================================================ */

async function fetchFeed(cfg) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(cfg.url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; personal-blog-news-bot/1.0; +https://github.com/)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    if (!/<(rss|feed|channel)/i.test(xml)) throw new Error("返回的不是 RSS");
    return parseFeed(xml);
  } finally {
    clearTimeout(timer);
  }
}

function timeLabel(pubDate) {
  const d = new Date(pubDate);
  if (isNaN(d.getTime())) return "";
  // 统一按北京时间显示
  const bj = new Date(d.getTime() + (8 * 60 + d.getTimezoneOffset()) * 60000);
  const hh = String(bj.getHours()).padStart(2, "0");
  const mm = String(bj.getMinutes()).padStart(2, "0");
  const today = new Date(Date.now() + 8 * 3600 * 1000);
  const sameDay = bj.toISOString().slice(0, 10) === today.toISOString().slice(0, 10);
  return sameDay ? `${hh}:${mm}` : `${bj.getMonth() + 1}/${bj.getDate()} ${hh}:${mm}`;
}

function filterItems(items, cfg) {
  return items.filter((it) => {
    if (!it.title || !it.link) return false;
    if (cfg.excludeTitle && cfg.excludeTitle.test(it.title)) return false;
    if (cfg.excludeAuthor && cfg.excludeAuthor.test(it.author)) return false;
    return true;
  });
}

/* ============================================================
   每日 60 秒（vikiboss/60s 的静态 CDN 数据源）
   ------------------------------------------------------------
   这个服务自己每天自动更新，仓库里已经有 630+ 天的历史。
   我们只管取当天那份 JSON，取不到就退回到昨天、前天。
   ============================================================ */
const S60_MIRRORS = [
  "https://cdn.jsdmirror.com/gh/vikiboss/60s-static-host@main/static",
  "https://cdn.jsdelivr.net/gh/vikiboss/60s-static-host@main/static",
];

function bjDate(offsetDays = 0) {
  const bj = new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400000);
  return bj.toISOString().slice(0, 10);
}

async function fetch60s() {
  for (const offset of [0, -1, -2]) {
    const date = bjDate(offset);
    for (const base of S60_MIRRORS) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        const res = await fetch(`${base}/60s/${date}.json`, {
          signal: ctrl.signal,
          headers: { Accept: "application/json" },
        });
        clearTimeout(timer);
        if (!res.ok) continue;
        const j = await res.json();
        if (!Array.isArray(j.news) || !j.news.length) continue;
        console.log(`✓ 每日 60 秒：取到 ${date} 的 ${j.news.length} 条`);
        return {
          date: j.date || date,
          news: j.news,
          // 图片直接引 CDN，不下载进仓库（否则一年能撑到上百 MB）
          image: `${base}/images/${date}.png`,
        };
      } catch {
        /* 换下一个镜像重试 */
      }
    }
  }
  console.warn("✗ 每日 60 秒：所有镜像都没取到，跳过");
  return null;
}

/* ============================================================
   Bing 每日壁纸（做首页动态背景）
   ============================================================ */
async function fetchBing() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(
      "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN",
      { signal: ctrl.signal, headers: { Accept: "application/json" } }
    );
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const img = j.images && j.images[0];
    if (!img) throw new Error("返回结构异常");
    const url = img.url.startsWith("http") ? img.url : "https://www.bing.com" + img.url;
    console.log(`✓ Bing 每日壁纸：${img.copyright || "已取到"}`);
    return { url, copyright: img.copyright || "" };
  } catch (err) {
    console.warn(`✗ Bing 每日壁纸取不到：${err.message}`);
    return null;
  }
}

/* ============================================================
   主流程
   ============================================================ */

function readOld() {
  try {
    return JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const old = readOld();
  const oldBySection = {};
  if (old && Array.isArray(old.sections)) {
    for (const s of old.sections) oldBySection[s.name] = s.items;
  }

  const sections = [];
  let okCount = 0;

  for (const cfg of SOURCES) {
    let items = [];
    try {
      const raw = await fetchFeed(cfg);
      items = filterItems(raw, cfg);
      okCount++;
      console.log(`✓ ${cfg.source} · ${cfg.name}：抓到 ${raw.length} 条，过滤后 ${items.length} 条`);
    } catch (err) {
      console.warn(`✗ ${cfg.source} · ${cfg.name} 抓取失败：${err.message}`);
      if (oldBySection[cfg.name]) {
        items = oldBySection[cfg.name];
        console.warn(`  → 沿用上一次的 ${items.length} 条数据`);
      }
    }

    const seen = new Set();
    const picked = [];
    for (const it of items) {
      const key = it.title.replace(/\s/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      const summary = sameAsTitle(it.summary, it.title) ? "" : it.summary;
      picked.push({
        title: it.title,
        link: it.link,
        summary,
        time: timeLabel(it.pubDate),
      });
      if (picked.length >= cfg.limit) break;
    }

    sections.push({ name: cfg.name, source: cfg.source, homepage: cfg.homepage, items: picked });
  }

  if (okCount === 0) {
    console.error("所有源都抓取失败了，保留原文件不动。");
    process.exit(1);
  }

  const now = new Date();
  const bj = new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60000);
  const pad = (n) => String(n).padStart(2, "0");
  const label = `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())} ${pad(
    bj.getHours()
  )}:${pad(bj.getMinutes())}`;

  const out = { updated: label, sections };

  // 每日 60 秒 + 每日背景：取不到就沿用上一次的，绝不能覆盖成空
  const [daily, bing] = await Promise.all([fetch60s(), fetchBing()]);
  if (daily) out.daily = daily;
  else if (old && old.daily) {
    out.daily = old.daily;
    console.warn("  → 沿用上一次的每日 60 秒数据");
  }
  if (bing) out.bing = bing;
  else if (old && old.bing) {
    out.bing = old.bing;
    console.warn("  → 沿用上一次的壁纸");
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\n已写入 ${path.relative(process.cwd(), OUT_FILE)}`);
  console.log(`共 ${sections.reduce((n, s) => n + s.items.length, 0)} 条，${okCount}/${SOURCES.length} 个源成功`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
