/* ============================================================
   薅羊毛页面
   ------------------------------------------------------------
   数据来自 /.netlify/functions/deals（服务端抓什么值得买），
   本身已经带 10 分钟 CDN 缓存；这里再加一层本地缓存，
   并在页面上显示倒计时，到点自动刷新。
   ============================================================ */
(function () {
  "use strict";

  var app = document.getElementById("deals-app");
  if (!app) return;

  var ENDPOINT = app.getAttribute("data-endpoint") || "/.netlify/functions/deals";
  var INTERVAL = parseInt(app.getAttribute("data-interval") || "600", 10); // 秒
  var CACHE_KEY = "dealsCacheV1";

  var listEl = document.getElementById("deals-list");
  var statusText = document.getElementById("deals-status-text");
  var refreshBtn = document.getElementById("deals-refresh");
  var filterBar = document.getElementById("deals-filters");

  var payload = null;
  var filter = "all";
  var nextAt = 0;
  var timer = null;

  /* ---------- 本地缓存（无痕模式会抛异常，忽略就好）---------- */
  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.deals || !obj.deals.length) return null;
      return obj;
    } catch (e) {
      return null;
    }
  }

  function writeCache(obj) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
    } catch (e) {
      /* 忽略 */
    }
  }

  /* ---------- 工具 ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function matchesFilter(d) {
    if (filter === "all") return true;
    if (filter === "absolute") return !!d.isAbsolute;
    if (filter === "low") {
      var all = (d.badges || []).concat(d.tags || []).join(" ");
      return /历史低价|新低|低于常卖价|绝对值/.test(all);
    }
    if (filter === "coupon") return /券|返|积分/.test(d.price || "");
    return true;
  }

  /* ---------- 渲染一张卡片 ---------- */
  function buildCard(d) {
    var card = el("article", "deal" + (d.isAbsolute ? " deal--absolute" : ""));

    /* 图片 */
    if (d.image) {
      var thumbLink = el("a", "deal__thumb");
      thumbLink.href = d.url;
      thumbLink.target = "_blank";
      thumbLink.rel = "noopener noreferrer";
      var img = document.createElement("img");
      img.src = d.image;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      /* smzdm 的图挂了就把整个缩略图区域去掉，别留个破图标 */
      img.addEventListener("error", function () {
        if (thumbLink.parentNode) thumbLink.parentNode.removeChild(thumbLink);
      });
      thumbLink.appendChild(img);
      card.appendChild(thumbLink);
    }

    var body = el("div", "deal__body");

    /* 徽章 */
    var badges = (d.badges || []).slice();
    if (d.isAbsolute && badges.indexOf("绝对值") < 0) badges.unshift("绝对值");
    if (badges.length) {
      var bWrap = el("div", "deal__badges");
      badges.forEach(function (b) {
        bWrap.appendChild(el("span", "deal__badge" + (b === "绝对值" ? " deal__badge--top" : ""), b));
      });
      body.appendChild(bWrap);
    }

    /* 标题 */
    var title = el("h3", "deal__title");
    var a = el("a", null, d.title);
    a.href = d.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    title.appendChild(a);
    body.appendChild(title);

    /* 价格行 */
    var priceRow = el("div", "deal__pricerow");
    if (d.price) priceRow.appendChild(el("span", "deal__price", d.price));
    if (d.mall) priceRow.appendChild(el("span", "deal__mall", d.mall));
    if (priceRow.childNodes.length) body.appendChild(priceRow);

    /* 描述 */
    if (d.desc) body.appendChild(el("p", "deal__desc", d.desc));

    /* 标签 + 品牌 + 时间 */
    var meta = el("div", "deal__meta");
    (d.tags || []).slice(0, 3).forEach(function (t) {
      meta.appendChild(el("span", "deal__tag", t));
    });
    if (d.brand && d.brand !== d.mall) meta.appendChild(el("span", "deal__tag", d.brand));
    if (d.time) meta.appendChild(el("time", "deal__time", d.time));
    if (meta.childNodes.length) body.appendChild(meta);

    card.appendChild(body);
    return card;
  }

  /* ---------- 渲染整个列表 ---------- */
  function render() {
    if (!payload) return;
    var deals = payload.deals.filter(matchesFilter);

    listEl.innerHTML = "";

    if (!deals.length) {
      var empty = el("p", "deals__empty", "这个筛选条件下暂时没有好价，换个条件试试。");
      listEl.appendChild(empty);
      return;
    }

    var frag = document.createDocumentFragment();
    deals.forEach(function (d) {
      frag.appendChild(buildCard(d));
    });
    listEl.appendChild(frag);
  }

  /* ---------- 状态栏 ---------- */
  function setStatus(text, kind) {
    statusText.textContent = text;
    var dot = app.querySelector(".deals__dot");
    if (dot) dot.className = "deals__dot" + (kind ? " is-" + kind : "");
  }

  function tickCountdown() {
    if (!payload || !nextAt) return;
    var left = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
    var mm = Math.floor(left / 60);
    var ss = left % 60;
    setStatus(
      "已更新 " + payload.updated + " · " + payload.count + " 条好价 · " +
      mm + ":" + String(ss).padStart(2, "0") + " 后自动刷新",
      payload.stale ? "warn" : "ok"
    );
    if (left <= 0) load(true);
  }

  /* ---------- 拉数据 ---------- */
  var loading = false;

  function load(force) {
    if (loading) return;
    loading = true;

    var url = ENDPOINT + (force ? "?t=" + Date.now() : "");
    setStatus(force ? "正在刷新…" : "正在加载好价…", "loading");

    fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.ok || !data.deals || !data.deals.length) {
          throw new Error(data && data.error ? data.error : "返回数据为空");
        }
        payload = data;
        writeCache(data);
        nextAt = Date.now() + INTERVAL * 1000;
        render();
        tickCountdown();
      })
      .catch(function (err) {
        var cached = readCache();
        if (cached) {
          payload = cached;
          render();
          setStatus("源站暂时取不到（" + err.message + "），显示的是上次缓存 · " + cached.updated, "warn");
          nextAt = Date.now() + 60 * 1000;
        } else {
          setStatus("加载失败：" + err.message + "，请稍后点「刷新」重试", "err");
          listEl.innerHTML = "";
          listEl.appendChild(el("p", "deals__empty", "暂时取不到好价数据。可能是源站限流，过一会儿再试。"));
        }
      })
      .finally(function () {
        loading = false;
      });
  }

  /* ---------- 交互 ---------- */
  if (filterBar) {
    filterBar.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".deals__filter") : null;
      if (!btn) return;
      filter = btn.getAttribute("data-filter");
      filterBar.querySelectorAll(".deals__filter").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      render();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      load(true);
    });
  }

  /* 页面切回前台时，如果已经过期就立刻刷一次 */
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && nextAt && Date.now() > nextAt) load(true);
  });

  /* ---------- 启动 ---------- */
  var cached = readCache();
  if (cached) {
    /* 先用缓存把页面渲染出来，避免白屏；同时后台悄悄拉新的 */
    payload = cached;
    render();
    setStatus("显示缓存（" + cached.updated + "），正在获取最新好价…", "loading");
    load(false);
  } else {
    load(false);
  }

  timer = setInterval(tickCountdown, 1000);
  window.addEventListener("pagehide", function () {
    if (timer) clearInterval(timer);
  });
})();
