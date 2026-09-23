/* ============================================================
   小游戏 —— 羊了个羊 / 合成大西瓜 / 2048 / 贪吃蛇
   ------------------------------------------------------------
   纯前端实现，没有任何第三方依赖。
   最高分只存在浏览器的 localStorage 里，不会上传到任何地方。
   ============================================================ */
(function () {
  "use strict";

  if (!document.getElementById("game-sheep")) return;

  function $(id) {
    return document.getElementById(id);
  }

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
      /* 无痕模式会抛异常，忽略 */
    }
  }

  function shuffleArray(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  var activeGame = "sheep";

  function addSwipe(el, cb) {
    if (!el) return;
    var sx = 0,
      sy = 0,
      tracking = false;
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
        if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
        if (Math.abs(dx) > Math.abs(dy)) cb(dx > 0 ? "right" : "left");
        else cb(dy > 0 ? "down" : "up");
      },
      { passive: true }
    );
  }

  /* ============================================================
     游戏一：羊了个羊（堆叠三消）
     ------------------------------------------------------------
     牌分层堆叠，只能点没被压住的；收进下方 7 个槽位；
     同一图案凑满 3 张自动消除；槽位占满就输。
     ============================================================ */
  var Sheep = (function () {
    var boardEl = $("sheep-board");
    if (!boardEl) return null;

    var ICONS = ["🐑", "🐰", "🐷", "🐮", "🐔", "🐸", "🐵", "🦊", "🐼", "🐨"];
    var PER_TYPE = 6; // 每种 6 张 = 正好 2 组三消
    var TILE = 52;
    var COLS = 5;
    var ROWS = 5;
    var LAYERS = 4;
    var SLOT_MAX = 7;

    var leftEl = $("sheep-left");
    var bestEl = $("sheep-best");
    var overEl = $("sheep-over");
    var overTitle = $("sheep-over-title");
    var overSub = $("sheep-over-sub");
    var slotsEl = $("sheep-slots");
    var shuffleBtn = $("sheep-shuffle");
    var undoBtn = $("sheep-undo");

    var tiles = [];
    var slots = [];
    var history = [];
    var props = { shuffle: 1, undo: 1 };
    var cleared = 0;
    var best = load("sheepBest", 0);
    var over = false;

    var BOARD_W = COLS * TILE + TILE / 2;

    function generate() {
      var pool = [];
      for (var t = 0; t < ICONS.length; t++) {
        for (var k = 0; k < PER_TYPE; k++) pool.push(t);
      }
      shuffleArray(pool);

      var perLayer = Math.ceil(pool.length / LAYERS);
      var out = [];
      var idx = 0;

      for (var L = 0; L < LAYERS && idx < pool.length; L++) {
        var cells = [];
        for (var c = 0; c < COLS; c++) {
          for (var r = 0; r < ROWS; r++) cells.push([c, r]);
        }
        shuffleArray(cells);

        var n = Math.min(perLayer, pool.length - idx);
        var off = L % 2 ? TILE / 2 : 0;
        for (var i = 0; i < n; i++) {
          out.push({
            id: out.length,
            type: pool[idx++],
            x: cells[i][0] * TILE + off,
            y: cells[i][1] * TILE + off,
            layer: L,
            removed: false,
          });
        }
      }
      return out;
    }

    function isCovered(t) {
      for (var i = 0; i < tiles.length; i++) {
        var o = tiles[i];
        if (o.removed || o.layer <= t.layer) continue;
        if (Math.abs(o.x - t.x) < TILE && Math.abs(o.y - t.y) < TILE) return true;
      }
      return false;
    }

    function remaining() {
      var n = 0;
      for (var i = 0; i < tiles.length; i++) if (!tiles[i].removed) n++;
      return n;
    }

    function paintBoard() {
      boardEl.style.width = BOARD_W + "px";
      boardEl.style.height = BOARD_W + "px";
      for (var i = 0; i < tiles.length; i++) {
        var t = tiles[i];
        if (!t.el) continue;
        /* 注意：整体赋值 className 会冲掉其它状态类，
           所以这里必须把 is-gone 一并算进去，
           否则已经被收进槽位的牌会重新出现在棋盘上。 */
        var cls = "sheep__tile";
        if (t.removed) cls += " is-gone";
        else if (isCovered(t)) cls += " is-covered";
        t.el.className = cls;
        t.el.style.zIndex = String(t.layer * 100 + (i % 100));
      }
      leftEl.textContent = remaining();
      bestEl.textContent = best;
    }

    function buildBoard() {
      boardEl.innerHTML = "";
      for (var i = 0; i < tiles.length; i++) {
        var t = tiles[i];
        var d = document.createElement("div");
        d.className = "sheep__tile";
        d.style.left = t.x + "px";
        d.style.top = t.y + "px";
        d.style.width = TILE - 4 + "px";
        d.style.height = TILE - 4 + "px";
        d.setAttribute("data-id", String(t.id));
        d.textContent = ICONS[t.type];
        t.el = d;
        boardEl.appendChild(d);
      }
    }

    function paintSlots() {
      slotsEl.innerHTML = "";
      for (var i = 0; i < SLOT_MAX; i++) {
        var d = document.createElement("div");
        d.className = "sheep__slot";
        if (i < slots.length) {
          d.classList.add("is-filled");
          d.textContent = ICONS[slots[i].type];
        }
        slotsEl.appendChild(d);
      }
    }

    /* 反复检查有没有凑够三张 */
    function resolveMatches() {
      for (;;) {
        var counts = {};
        for (var i = 0; i < slots.length; i++) counts[slots[i].type] = (counts[slots[i].type] || 0) + 1;
        var hit = -1;
        for (var k in counts) {
          if (counts[k] >= 3) {
            hit = Number(k);
            break;
          }
        }
        if (hit < 0) break;

        var gone = 0;
        var next = [];
        for (var j = 0; j < slots.length; j++) {
          if (slots[j].type === hit && gone < 3) {
            gone++;
            continue;
          }
          next.push(slots[j]);
        }
        slots = next;
        cleared += 3;
      }
    }

    function checkEnd() {
      if (remaining() === 0 && slots.length === 0) {
        over = true;
        if (cleared > best) {
          best = cleared;
          save("sheepBest", best);
        }
        overTitle.textContent = "全部消除，通关！";
        overSub.textContent = "共消除 " + cleared + " 张";
        overEl.hidden = false;
        paintBoard();
        paintSlots();
        updatePropBtns();
        return true;
      }
      if (slots.length >= SLOT_MAX) {
        over = true;
        if (cleared > best) {
          best = cleared;
          save("sheepBest", best);
        }
        overTitle.textContent = "游戏结束";
        overSub.textContent = "槽位满了，还剩 " + remaining() + " 张";
        overEl.hidden = false;
        paintBoard();
        paintSlots();
        updatePropBtns();
        return true;
      }
      return false;
    }

    function pick(tile) {
      if (over || tile.removed || isCovered(tile)) return;
      tile.removed = true;
      if (tile.el) tile.el.classList.add("is-gone");
      slots.push({ type: tile.type, tileId: tile.id });
      history.push({ tileId: tile.id, type: tile.type });

      resolveMatches();
      paintBoard();
      paintSlots();
      updatePropBtns();
      checkEnd();
    }

    function updatePropBtns() {
      if (shuffleBtn) {
        shuffleBtn.disabled = props.shuffle <= 0 || over;
        shuffleBtn.textContent = "🔀 洗牌（剩 " + props.shuffle + " 次）";
      }
      if (undoBtn) {
        undoBtn.disabled = props.undo <= 0 || over || !history.length;
        undoBtn.textContent = "↩️ 撤销（剩 " + props.undo + " 次）";
      }
    }

    /* 洗牌：把还没消掉的牌的图案重新打乱 */
    function doShuffle() {
      if (over || props.shuffle <= 0) return;
      props.shuffle--;
      var alive = [];
      for (var i = 0; i < tiles.length; i++) if (!tiles[i].removed) alive.push(tiles[i]);
      var types = alive.map(function (t) {
        return t.type;
      });
      shuffleArray(types);
      for (var j = 0; j < alive.length; j++) {
        alive[j].type = types[j];
        if (alive[j].el) alive[j].el.textContent = ICONS[types[j]];
      }
      updatePropBtns();
    }

    /* 撤销：把最后一次放进槽位的牌退回棋盘 */
    function doUndo() {
      if (over || props.undo <= 0 || !history.length) return;
      var last = history.pop();
      var tile = null;
      for (var i = 0; i < tiles.length; i++) {
        if (tiles[i].id === last.tileId) {
          tile = tiles[i];
          break;
        }
      }
      if (!tile) return;
      for (var k = slots.length - 1; k >= 0; k--) {
        if (slots[k].tileId === last.tileId) {
          slots.splice(k, 1);
          break;
        }
      }
      props.undo--;
      tile.removed = false;
      if (tile.el) tile.el.classList.remove("is-gone");
      paintBoard();
      paintSlots();
      updatePropBtns();
    }

    function reset() {
      tiles = generate();
      slots = [];
      history = [];
      props = { shuffle: 1, undo: 1 };
      cleared = 0;
      over = false;
      overEl.hidden = true;
      buildBoard();
      paintBoard();
      paintSlots();
      updatePropBtns();
    }

    buildBoard();
    reset();

    boardEl.addEventListener("click", function (e) {
      var el = e.target.closest ? e.target.closest(".sheep__tile") : null;
      if (!el) return;
      var id = Number(el.getAttribute("data-id"));
      for (var i = 0; i < tiles.length; i++) {
        if (tiles[i].id === id) {
          pick(tiles[i]);
          break;
        }
      }
    });

    if ($("sheep-new")) $("sheep-new").addEventListener("click", reset);
    if ($("sheep-again")) $("sheep-again").addEventListener("click", reset);
    if (shuffleBtn) shuffleBtn.addEventListener("click", doShuffle);
    if (undoBtn) undoBtn.addEventListener("click", doUndo);

    return {};
  })();

  /* ============================================================
     游戏二：合成大西瓜（物理合并）
     ------------------------------------------------------------
     自己写的小型物理：重力 → 积分 → 边界反弹 → 圆-圆碰撞求解。
     相同等级的两个水果碰到一起就合成下一级。
     ============================================================ */
  var Suika = (function () {
    var canvas = $("suika-canvas");
    if (!canvas || !canvas.getContext) return null;
    var ctx = canvas.getContext("2d");

    var W = 360;
    var H = 480;
    var DANGER_Y = 96;
    var GRAVITY = 1500;
    var REST = 0.08;

    var FRUITS = [
      { r: 15, c: "#f87171", e: "🍒" },
      { r: 20, c: "#fb923c", e: "🍊" },
      { r: 26, c: "#fbbf24", e: "🍋" },
      { r: 33, c: "#a3e635", e: "🥝" },
      { r: 41, c: "#4ade80", e: "🍏" },
      { r: 50, c: "#22d3ee", e: "🍐" },
      { r: 61, c: "#818cf8", e: "🍇" },
      { r: 73, c: "#f472b6", e: "🍑" },
      { r: 88, c: "#34d399", e: "🍉" },
    ];
    var MAX_LEVEL = FRUITS.length - 1;

    var scoreEl = $("suika-score");
    var bestEl = $("suika-best");
    var overEl = $("suika-over");
    var finalEl = $("suika-final");

    var fruits = [];
    var score = 0;
    var best = load("suikaBest", 0);
    var dropX = W / 2;
    var nextLevel = 0;
    var over = false;
    var dangerTimer = 0;
    var raf = null;
    var lastTime = 0;
    var running = false;

    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    function randLevel() {
      return Math.floor(Math.random() * 4);
    }

    function makeFruit(level, x, y, vx, vy) {
      return {
        level: level,
        r: FRUITS[level].r,
        x: x,
        y: y,
        vx: vx || 0,
        vy: vy || 0,
        dead: false,
        born: Date.now(),
      };
    }

    function reset() {
      fruits = [];
      score = 0;
      over = false;
      dangerTimer = 0;
      nextLevel = randLevel();
      scoreEl.textContent = "0";
      bestEl.textContent = best;
      overEl.hidden = true;
      draw();
      if (activeGame === "suika") start();
    }

    function drop() {
      if (over) return;
      var r = FRUITS[nextLevel].r;
      var x = Math.max(r + 2, Math.min(W - r - 2, dropX));
      fruits.push(makeFruit(nextLevel, x, DANGER_Y - 40, 0, 60));
      nextLevel = randLevel();
    }

    function mergeAt(a, b) {
      var lv = a.level + 1;
      score += (lv + 1) * 2;
      if (score > best) {
        best = score;
        bestEl.textContent = best;
        save("suikaBest", best);
      }
      scoreEl.textContent = score;
      if (lv > MAX_LEVEL) return null;
      return makeFruit(lv, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.vx + b.vx) / 2, (a.vy + b.vy) / 2 - 30);
    }

    function physics(dt) {
      var i, j, f;
      for (i = 0; i < fruits.length; i++) {
        f = fruits[i];
        if (f.dead) continue;
        f.vy += GRAVITY * dt;
        f.vx *= 0.998;
        f.x += f.vx * dt;
        f.y += f.vy * dt;

        if (f.x - f.r < 0) {
          f.x = f.r;
          f.vx = Math.abs(f.vx) * 0.35;
        }
        if (f.x + f.r > W) {
          f.x = W - f.r;
          f.vx = -Math.abs(f.vx) * 0.35;
        }
        if (f.y + f.r > H) {
          f.y = H - f.r;
          if (f.vy > 0) f.vy = -f.vy * 0.12;
          f.vx *= 0.88;
        }
      }

      var merged = [];
      for (var it = 0; it < 5; it++) {
        for (i = 0; i < fruits.length; i++) {
          var a = fruits[i];
          if (a.dead) continue;
          for (j = i + 1; j < fruits.length; j++) {
            var b = fruits[j];
            if (b.dead) continue;

            var dx = b.x - a.x;
            var dy = b.y - a.y;
            var rr = a.r + b.r;
            var d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr) continue;

            var d = Math.sqrt(d2) || 0.01;
            var nx = dx / d;
            var ny = dy / d;

            /* 同级 → 合成 */
            if (a.level === b.level && a.level < MAX_LEVEL && it === 0) {
              var m = mergeAt(a, b);
              a.dead = true;
              b.dead = true;
              if (m) merged.push(m);
              continue;
            }

            /* 位置修正 */
            var corr = (rr - d) * 0.5 * 0.7;
            a.x -= nx * corr;
            a.y -= ny * corr;
            b.x += nx * corr;
            b.y += ny * corr;

            /* 速度响应 */
            var vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (vn < 0) {
              var imp = (-(1 + REST) * vn) / 2;
              a.vx -= imp * nx;
              a.vy -= imp * ny;
              b.vx += imp * nx;
              b.vy += imp * ny;
            }
          }
        }
      }

      if (merged.length) {
        fruits = fruits.filter(function (x) {
          return !x.dead;
        });
        for (i = 0; i < merged.length; i++) fruits.push(merged[i]);
      }

      /* 越线判定 */
      var danger = false;
      for (i = 0; i < fruits.length; i++) {
        f = fruits[i];
        if (f.dead) continue;
        if (f.y - f.r < DANGER_Y && Math.abs(f.vy) < 60 && Date.now() - f.born > 800) {
          danger = true;
          break;
        }
      }
      if (danger) {
        dangerTimer += dt;
        if (dangerTimer > 1.4) gameOver();
      } else {
        dangerTimer = Math.max(0, dangerTimer - dt * 2);
      }
    }

    function gameOver() {
      if (over) return;
      over = true;
      finalEl.textContent = score;
      overEl.hidden = false;
      stop();
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);

      ctx.strokeStyle = dangerTimer > 0 ? "#ef4444" : "rgba(128,128,128,.45)";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.moveTo(0, DANGER_Y);
      ctx.lineTo(W, DANGER_Y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      if (!over) {
        var r = FRUITS[nextLevel].r;
        var x = Math.max(r + 2, Math.min(W - r - 2, dropX));
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = FRUITS[nextLevel].c;
        ctx.beginPath();
        ctx.arc(x, DANGER_Y - 40, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.font = Math.round(r * 1.1) + "px system-ui, sans-serif";
        ctx.fillText(FRUITS[nextLevel].e, x, DANGER_Y - 40);
      }

      for (var i = 0; i < fruits.length; i++) {
        var f = fruits[i];
        if (f.dead) continue;
        ctx.fillStyle = FRUITS[f.level].c;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = Math.round(f.r * 1.05) + "px system-ui, sans-serif";
        ctx.fillText(FRUITS[f.level].e, f.x, f.y);
      }
    }

    function loop() {
      if (!running) return;
      var now = Date.now();
      var dt = Math.min(0.032, (now - lastTime) / 1000);
      lastTime = now;
      if (!over) physics(dt);
      draw();
      raf = requestAnimationFrame(loop);
    }

    function start() {
      if (running) return;
      running = true;
      lastTime = Date.now();
      raf = requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    }

    function pointerX(clientX) {
      var rect = canvas.getBoundingClientRect();
      return ((clientX - rect.left) / rect.width) * W;
    }

    canvas.addEventListener("mousemove", function (e) {
      dropX = pointerX(e.clientX);
    });
    canvas.addEventListener("click", function (e) {
      dropX = pointerX(e.clientX);
      drop();
    });
    canvas.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches.length !== 1) return;
        dropX = pointerX(e.touches[0].clientX);
        e.preventDefault();
      },
      { passive: false }
    );
    canvas.addEventListener(
      "touchmove",
      function (e) {
        if (e.touches.length !== 1) return;
        dropX = pointerX(e.touches[0].clientX);
        e.preventDefault();
      },
      { passive: false }
    );
    canvas.addEventListener(
      "touchend",
      function (e) {
        if (e.changedTouches.length !== 1) return;
        dropX = pointerX(e.changedTouches[0].clientX);
        drop();
        e.preventDefault();
      },
      { passive: false }
    );

    if ($("suika-new")) $("suika-new").addEventListener("click", reset);
    if ($("suika-again")) $("suika-again").addEventListener("click", reset);

    reset();
    stop();

    return {
      activate: function () {
        start();
      },
      deactivate: function () {
        stop();
      },
    };
  })();

  /* ============================================================
     游戏三：2048
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

    function slide(line) {
      var vals = [];
      for (var i = 0; i < line.length; i++) if (line[i]) vals.push(line[i]);
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
        for (var i = 0; i < N; i++) line.push(horizontal ? grid[k][i] : grid[i][k]);
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
      for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (!grid[r][c]) free.push([r, c]);
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
     游戏四：贪吃蛇
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

    function onBody(x, y) {
      for (var i = 0; i < body.length; i++) if (body[i].x === x && body[i].y === y) return true;
      return false;
    }

    function placeFood() {
      var tries = 0;
      do {
        food = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
        tries++;
      } while (onBody(food.x, food.y) && tries < 200);
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
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (food) {
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL * 0.33, 0, Math.PI * 2);
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
        start();
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
      body = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
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
    stop();

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
     标签切换
     ============================================================ */
  var tabs = document.querySelectorAll(".games__tab");
  var panels = document.querySelectorAll(".game");

  function switchTo(name) {
    if (activeGame === name) return;
    if (Snake) Snake.deactivate();
    if (Suika) Suika.deactivate();
    activeGame = name;

    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("is-active", tabs[i].getAttribute("data-game") === name);
    }
    for (var j = 0; j < panels.length; j++) {
      panels[j].classList.toggle("is-active", panels[j].id === "game-" + name);
    }

    if (name === "snake" && Snake) Snake.activate();
    if (name === "suika" && Suika) Suika.activate();
  }

  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener("click", function () {
      switchTo(this.getAttribute("data-game"));
    });
  }

  /* ============================================================
     键盘：只在对应游戏确实显示在屏幕上时才拦截
     ============================================================ */
  function inView(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }

  document.addEventListener("keydown", function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (!inView(document.getElementById("game-" + activeGame))) return;

    var k = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key;
    var handled = false;

    if (activeGame === "g2048" && Game2048) handled = Game2048.key(k);
    else if (activeGame === "snake" && Snake) handled = Snake.key(e.key === " " ? " " : k);

    if (handled) e.preventDefault();
  });

  /* ============================================================
     滑动操作（2048 / 贪吃蛇）
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
