/* ============================================================
   小游戏 —— 2048 / 贪吃蛇 / 记忆翻牌
   ------------------------------------------------------------
   纯前端实现，没有任何第三方依赖。
   最高分只存在浏览器的 localStorage 里，不会上传到任何地方。
   ============================================================ */
(function () {
  "use strict";

  /* 不在游戏页就直接退出，避免在其它页面白跑一遍 */
  if (!document.getElementById("game-g2048")) return;

  function $(id) {
    return document.getElementById(id);
  }

  /* ---------- localStorage 读写 ----------
     无痕模式下会抛异常，所以全部包起来，失败就静默忽略 */
  function load(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }

  function save(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      /* 忽略 */
    }
  }

  /* 当前激活的游戏，几个模块都要读 */
  var activeGame = "g2048";

  /* ---------- 滑动操作（手机）---------- */
  function addSwipe(el, cb) {
    if (!el) return;
    var sx = 0;
    var sy = 0;
    var tracking = false;

    el.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches.length !== 1) return;
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        tracking = true;
      },
      { passive: true }
    );

    el.addEventListener(
      "touchend",
      function (e) {
        if (!tracking) return;
        tracking = false;
        var t = e.changedTouches[0];
        var dx = t.clientX - sx;
        var dy = t.clientY - sy;
        /* 位移太小就当成点击，忽略 */
        if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
        if (Math.abs(dx) > Math.abs(dy)) cb(dx > 0 ? "right" : "left");
        else cb(dy > 0 ? "down" : "up");
      },
      { passive: true }
    );
  }

  /* ============================================================
     游戏一：2048
     ============================================================ */
  var Game2048 = (function () {
    var boardEl = $("g2048-board");
    if (!boardEl) return null;

    var N = 4;
    var scoreEl = $("g2048-score");
    var bestEl = $("g2048-best");
    var overEl = $("g2048-over");
    var finalEl = $("g2048-final");

    var grid;
    var cells = [];
    var score = 0;
    var best = load("game2048best", 0);
    var dead = false;

    /* 一次性建好 16 个格子，之后只改内容，避免频繁重建 DOM */
    function buildDom() {
      boardEl.innerHTML = "";
      cells = [];
      for (var r = 0; r < N; r++) {
        cells[r] = [];
        for (var c = 0; c < N; c++) {
          var d = document.createElement("div");
          d.className = "g2048__cell";
          boardEl.appendChild(d);
          cells[r][c] = d;
        }
      }
    }

    /* flash 是刚生成的新格子坐标 [r,c]，给它加个弹出动画 */
    function paint(flash) {
      for (var r = 0; r < N; r++) {
        for (var c = 0; c < N; c++) {
          var v = grid[r][c];
          var d = cells[r][c];
          var cls = "g2048__cell";
          if (v) {
            cls += " g2048__tile g2048__tile--" + (v > 2048 ? "super" : v);
            if (flash && flash[0] === r && flash[1] === c) cls += " is-new";
          }
          d.className = cls;
          d.textContent = v ? v : "";
        }
      }
      scoreEl.textContent = score;
      bestEl.textContent = best;
    }

    /* 把一行压紧并合并，返回新的一行和本次得分 */
    function slide(line) {
      var vals = [];
      for (var i = 0; i < line.length; i++) {
        if (line[i]) vals.push(line[i]);
      }
      var out = [];
      var gained = 0;
      for (var j = 0; j < vals.length; j++) {
        if (j + 1 < vals.length && vals[j] === vals[j + 1]) {
          var merged = vals[j] * 2;
          out.push(merged);
          gained += merged;
          j++;
        } else {
          out.push(vals[j]);
        }
      }
      while (out.length < N) out.push(0);
      return { out: out, gained: gained };
    }

    function move(dir) {
      var gained = 0;
      var horizontal = dir === "left" || dir === "right";
      var reverse = dir === "right" || dir === "down";

      for (var k = 0; k < N; k++) {
        var line = [];
        for (var i = 0; i < N; i++) {
          line.push(horizontal ? grid[k][i] : grid[i][k]);
        }
        if (reverse) line.reverse();

        var res = slide(line);
        gained += res.gained;

        var out = res.out;
        if (reverse) out.reverse();

        for (var j = 0; j < N; j++) {
          if (horizontal) grid[k][j] = out[j];
          else grid[j][k] = out[j];
        }
      }
      return gained;
    }

    function spawn() {
      var free = [];
      for (var r = 0; r < N; r++) {
        for (var c = 0; c < N; c++) {
          if (!grid[r][c]) free.push([r, c]);
        }
      }
      if (!free.length) return null;
      var p = free[Math.floor(Math.random() * free.length)];
      grid[p[0]][p[1]] = Math.random() < 0.9 ? 2 : 4;
      return p;
    }

    function canMove() {
      for (var r = 0; r < N; r++) {
        for (var c = 0; c < N; c++) {
          if (!grid[r][c]) return true;
          if (c + 1 < N && grid[r][c] === grid[r][c + 1]) return true;
          if (r + 1 < N && grid[r][c] === grid[r + 1][c]) return true;
        }
      }
      return false;
    }

    function step(dir) {
      if (dead) return false;
      var before = JSON.stringify(grid);
      score += move(dir);
      /* 局面没变化就不该生成新格子，否则等于白送 */
      if (JSON.stringify(grid) === before) return true;

      if (score > best) {
        best = score;
        save("game2048best", best);
      }
      paint(spawn());

      if (!canMove()) {
        dead = true;
        finalEl.textContent = score;
        overEl.hidden = false;
      }
      return true;
    }

    function reset() {
      grid = [];
      for (var r = 0; r < N; r++) grid.push([0, 0, 0, 0]);
      score = 0;
      dead = false;
      overEl.hidden = true;
      spawn();
      paint(spawn());
    }

    var keys = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      a: "left",
      d: "right",
      w: "up",
      s: "down",
    };

    buildDom();
    reset();

    if ($("g2048-new")) $("g2048-new").addEventListener("click", reset);
    if ($("g2048-again")) $("g2048-again").addEventListener("click", reset);

    return {
      key: function (k) {
        var dir = keys[k];
        if (!dir) return false;
        return step(dir);
      },
      swipe: function (dir) {
        step(dir);
      },
    };
  })();

  /* ============================================================
     游戏二：贪吃蛇
     ============================================================ */
  var Snake = (function () {
    var canvas = $("snake-canvas");
    if (!canvas || !canvas.getContext) return null;

    var ctx = canvas.getContext("2d");
    var COLS = 20;
    var ROWS = 20;
    var CELL = canvas.width / COLS;

    var scoreEl = $("snake-score");
    var bestEl = $("snake-best");
    var overEl = $("snake-over");
    var overTitle = $("snake-over-title");
    var finalEl = $("snake-final");

    var body;
    var dir;
    var nextDir;
    var food;
    var score = 0;
    var best = load("gameSnakeBest", 0);
    var timer = null;
    var paused = false;
    var dead = false;

    function speed() {
      /* 每吃 10 分快一点，最快 75ms 一格 */
      return Math.max(75, 130 - Math.floor(score / 10) * 5);
    }

    function start() {
      stop();
      if (dead || paused) return;
      timer = setInterval(step, speed());
    }

    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function placeFood() {
      var tries = 0;
      do {
        food = {
          x: Math.floor(Math.random() * COLS),
          y: Math.floor(Math.random() * ROWS),
        };
        tries++;
      } while (onBody(food.x, food.y) && tries < 200);
    }

    function onBody(x, y) {
      for (var i = 0; i < body.length; i++) {
        if (body[i].x === x && body[i].y === y) return true;
      }
      return false;
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function draw() {
      /* 背景交给 CSS（canvas 是透明的），这样深色模式自动适配 */
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (food) {
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(
          food.x * CELL + CELL / 2,
          food.y * CELL + CELL / 2,
          CELL * 0.33,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }

      for (var i = body.length - 1; i >= 0; i--) {
        var s = body[i];
        ctx.fillStyle = i === 0 ? "#4f46e5" : "#6366f1";
        roundRect(s.x * CELL + 1.5, s.y * CELL + 1.5, CELL - 3, CELL - 3, i === 0 ? 6 : 4);
        ctx.fill();
      }
    }

    function die() {
      dead = true;
      stop();
      overTitle.textContent = "游戏结束";
      finalEl.textContent = score;
      overEl.hidden = false;
    }

    function step() {
      if (dead || paused) return;

      dir = nextDir;
      var head = { x: body[0].x + dir.x, y: body[0].y + dir.y };

      /* 撞墙或撞到自己 */
      if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS || onBody(head.x, head.y)) {
        die();
        return;
      }

      body.unshift(head);

      if (head.x === food.x && head.y === food.y) {
        score += 10;
        scoreEl.textContent = score;
        if (score > best) {
          best = score;
          bestEl.textContent = best;
          save("gameSnakeBest", best);
        }
        placeFood();
        start(); /* 重新计时，立刻应用新速度 */
      } else {
        body.pop();
      }

      draw();
    }

    function turn(d) {
      var dmap = {
        left: { x: -1, y: 0 },
        right: { x: 1, y: 0 },
        up: { x: 0, y: -1 },
        down: { x: 0, y: 1 },
      };
      var nd = dmap[d];
      if (!nd) return false;
      /* 不能原地 180 度掉头 */
      if (nd.x === -dir.x && nd.y === -dir.y) return true;
      nextDir = nd;
      return true;
    }

    function togglePause() {
      if (dead) return;
      paused = !paused;
      if (paused) {
        stop();
        overTitle.textContent = "已暂停";
        finalEl.textContent = score;
        overEl.hidden = false;
      } else {
        overEl.hidden = true;
        start();
      }
    }

    function reset() {
      body = [
        { x: 10, y: 10 },
        { x: 9, y: 10 },
        { x: 8, y: 10 },
      ];
      dir = { x: 1, y: 0 };
      nextDir = { x: 1, y: 0 };
      score = 0;
      paused = false;
      dead = false;
      overEl.hidden = true;
      scoreEl.textContent = 0;
      bestEl.textContent = best;
      placeFood();
      draw();
      start();
    }

    var keys = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
      a: "left",
      d: "right",
      w: "up",
      s: "down",
    };

    if ($("snake-new")) $("snake-new").addEventListener("click", reset);
    if ($("snake-again")) $("snake-again").addEventListener("click", reset);

    reset();
    stop(); /* 默认停在 2048 标签，先别跑 */

    return {
      key: function (k) {
        if (k === " " || k === "Spacebar") {
          togglePause();
          return true;
        }
        var d = keys[k];
        if (!d) return false;
        return turn(d);
      },
      swipe: function (d) {
        turn(d);
      },
      activate: function () {
        if (!dead && !paused) start();
      },
      deactivate: function () {
        stop();
      },
    };
  })();

  /* ============================================================
     游戏三：记忆翻牌
     ============================================================ */
  var Memory = (function () {
    var boardEl = $("memory-board");
    if (!boardEl) return null;

    var EMOJI = ["🍎", "🌙", "⚡", "🎈", "🐙", "🌵", "🍀", "🎧"];

    var movesEl = $("memory-moves");
    var bestEl = $("memory-best");
    var overEl = $("memory-over");
    var finalEl = $("memory-final");

    var deck = [];
    var opened = [];
    var lock = false;
    var moves = 0;
    var matched = 0;
    var best = load("gameMemoryBest", null);

    function shuffle(a) {
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i];
        a[i] = a[j];
        a[j] = t;
      }
      return a;
    }

    function reset() {
      var cards = [];
      for (var i = 0; i < EMOJI.length; i++) {
        cards.push(EMOJI[i]);
        cards.push(EMOJI[i]);
      }
      shuffle(cards);

      deck = cards;
      opened = [];
      lock = false;
      moves = 0;
      matched = 0;
      movesEl.textContent = "0";
      bestEl.textContent = best === null ? "—" : best;
      overEl.hidden = true;

      boardEl.innerHTML = "";
      for (var k = 0; k < cards.length; k++) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "memory__card";
        btn.setAttribute("data-i", String(k));
        btn.setAttribute("aria-label", "第 " + (k + 1) + " 张卡片");

        var inner = document.createElement("span");
        inner.className = "memory__inner";

        var back = document.createElement("span");
        back.className = "memory__face memory__face--back";
        back.textContent = "?";

        var front = document.createElement("span");
        front.className = "memory__face memory__face--front";
        front.textContent = cards[k];

        inner.appendChild(back);
        inner.appendChild(front);
        btn.appendChild(inner);
        boardEl.appendChild(btn);
      }
    }

    boardEl.addEventListener("click", function (e) {
      var card = e.target.closest ? e.target.closest(".memory__card") : null;
      if (!card || lock) return;
      if (card.classList.contains("is-flipped") || card.classList.contains("is-matched")) return;

      card.classList.add("is-flipped");
      opened.push(parseInt(card.getAttribute("data-i"), 10));
      if (opened.length < 2) return;

      moves++;
      movesEl.textContent = moves;

      var a = opened[0];
      var b = opened[1];
      var cardA = boardEl.querySelector('[data-i="' + a + '"]');
      var cardB = boardEl.querySelector('[data-i="' + b + '"]');

      if (deck[a] === deck[b]) {
        cardA.classList.add("is-matched");
        cardB.classList.add("is-matched");
        opened = [];
        matched++;

        if (matched === EMOJI.length) {
          if (best === null || moves < best) {
            best = moves;
            save("gameMemoryBest", best);
            bestEl.textContent = best;
          }
          finalEl.textContent = moves;
          setTimeout(function () {
            overEl.hidden = false;
          }, 380);
        }
      } else {
        lock = true;
        setTimeout(function () {
          cardA.classList.remove("is-flipped");
          cardB.classList.remove("is-flipped");
          opened = [];
          lock = false;
        }, 750);
      }
    });

    if ($("memory-new")) $("memory-new").addEventListener("click", reset);
    if ($("memory-again")) $("memory-again").addEventListener("click", reset);

    reset();
    return {};
  })();

  /* ============================================================
     标签切换
     ============================================================ */
  var tabs = document.querySelectorAll(".games__tab");
  var panels = document.querySelectorAll(".game");

  function switchTo(name) {
    if (activeGame === name) return;
    if (Snake) Snake.deactivate();
    activeGame = name;

    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("is-active", tabs[i].getAttribute("data-game") === name);
    }
    for (var j = 0; j < panels.length; j++) {
      panels[j].classList.toggle("is-active", panels[j].id === "game-" + name);
    }

    if (name === "snake" && Snake) Snake.activate();
  }

  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener("click", function () {
      switchTo(this.getAttribute("data-game"));
    });
  }

  /* ============================================================
     键盘操作
     只在对应游戏确实显示在屏幕上时才拦截方向键，
     免得用户想滚动页面却被游戏吃掉按键
     ============================================================ */
  function inView(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }

  function panelOf(name) {
    return document.getElementById("game-" + name);
  }

  document.addEventListener("keydown", function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (!inView(panelOf(activeGame))) return;

    var k = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
    var handled = false;

    if (activeGame === "g2048" && Game2048) handled = Game2048.key(k);
    else if (activeGame === "snake" && Snake) handled = Snake.key(e.key === " " ? " " : k);

    if (handled) e.preventDefault();
  });

  /* ============================================================
     滑动操作
     ============================================================ */
  if (Game2048) {
    addSwipe($("g2048-board"), function (d) {
      Game2048.swipe(d);
    });
  }
  if (Snake) {
    addSwipe($("snake-canvas"), function (d) {
      Snake.swipe(d);
    });
  }
})();
