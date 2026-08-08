(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const adminKey = $("admin-key");
  const statusEl = $("status");

  let keys = [];

  function fmtN(n) {
    if (!Number.isFinite(n)) return "—";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(Math.round(n));
  }

  function fmtUptime(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m " + (s % 60) + "s";
    return Math.floor(m / 60) + "h " + (m % 60) + "m";
  }

  function setStatus(msg, cls) {
    statusEl.textContent = msg;
    statusEl.className = "status-line" + (cls ? " " + cls : "");
  }

  async function api(path, opts = {}) {
    try {
      const res = await fetch(path, {
        ...opts,
        headers: {
          "content-type": "application/json",
          "x-admin-key": adminKey.value,
          ...(opts.headers || {}),
        },
      });
      return { code: res.status, body: await res.json().catch(() => null) };
    } catch {
      return { code: 0, body: null };
    }
  }

  function esc(text) {
    if (text == null) return "";
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function renderRouteTable(elId, routes) {
    const el = $(elId);
    el.innerHTML = "";
    if (!routes.length) {
      el.innerHTML = '<div class="burst-empty" style="padding:14px 18px">No traffic yet.</div>';
      return;
    }
    const max = Math.max(1, ...routes.map((r) => r.hits));
    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML =
      "<thead><tr><th>Route</th><th>Hits</th><th>Share</th><th>Last hit</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const r of routes) {
      const share = Math.round((r.hits / max) * 1000) / 10;
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td class='cell-route'>" + esc(r.route) + "</td>" +
        "<td class='mono'>" + fmtN(r.hits) + "</td>" +
        "<td><div class='bar-wrap'><div class='bar'><div style='width:" + share + "%'></div></div><span class='pct'>" + share + "%</span></div></td>" +
        "<td class='mono hash'>" + new Date(r.lastHitAt).toLocaleTimeString() + "</td>";
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    el.appendChild(table);
  }

  function renderEnv(d) {
    $("env-store").textContent = d.service.store;
    $("env-db").textContent = d.service.db;
    $("env-limit").textContent = fmtN(d.service.limitPerMin);
  }

  function renderOverview(d) {
    renderEnv(d);
    $("m-rps").innerHTML = fmtN(d.stats.rps) + '<span class="unit">req/s</span>';
    $("m-rps-note").textContent = "uptime " + fmtUptime(d.stats.uptimeMs);
    $("m-total").textContent = fmtN(d.stats.totalHits);
    $("m-uptime").textContent = "limit " + fmtN(Number($("env-limit").textContent)) + "/min, window 60s";
    $("m-keys").textContent = fmtN(keys.length);
    $("m-keys-note").textContent = keys.length + " in db";
    renderRouteTable("route-table", d.routes);
  }

  function renderKeys() {
    const list = $("key-list");
    list.innerHTML = "";
    if (!keys.length) {
      list.innerHTML = '<div class="burst-empty" style="padding:14px 18px">No keys yet — create one above.</div>';
      return;
    }
    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = "<thead><tr><th>Name</th><th>ID</th><th>Created</th><th>Status</th><th></th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const k of keys) {
      const tr = document.createElement("tr");
      tr.style.opacity = k.revoked ? "0.55" : "1";
      const status = k.revoked
        ? "<span class='chip revoked'>revoked</span>"
        : "<span class='chip ok'>active</span>";
      tr.innerHTML =
        "<td><b>" + esc(k.name) + "</b></td>" +
        "<td class='mono hash'>" + esc(k.id) + "</td>" +
        "<td class='mono hash'>" + new Date(k.createdAt).toLocaleString() + "</td>" +
        "<td>" + status + "</td>" +
        "<td style='text-align:right'>" +
        (k.revoked ? "" : "<button class='btn sm danger' data-revoke='" + esc(k.id) + "'>Revoke</button>") +
        "</td>";
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    list.appendChild(table);
    list.querySelectorAll("[data-revoke]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const res = await api("/admin/keys/" + btn.dataset.revoke, { method: "DELETE" });
        if (res.body && res.body.ok) {
          setStatus("key revoked", "ok");
          await refresh();
        } else {
          setStatus("revoke failed", "error");
        }
      });
    });
  }

  async function refresh() {
    setStatus("loading…");
    const [dash, keyRes] = await Promise.all([
      api("/admin/dashboard"),
      api("/admin/keys"),
    ]);
    if (!dash.body || !dash.body.ok) {
      setStatus("dashboard unreachable — check admin key / server", "error");
      return;
    }
    keys = keyRes.body && keyRes.body.ok ? keyRes.body.keys : [];
    renderOverview(dash.body);
    renderRouteTable("route-table-full", dash.body.routes);
    renderKeys();
    setStatus("updated " + new Date().toLocaleTimeString(), "ok");
  }

  $("key-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const nameEl = $("key-name");
    const name = nameEl.value.trim();
    if (!name) return;
    const res = await api("/admin/keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (res.body && res.body.ok) {
      const hint = $("key-hint");
      hint.innerHTML =
        "key created · <span class='mono'>" + esc(res.body.key) + "</span>" +
        " <button class='btn sm' id='copy-key' style='margin-left:6px'>Copy</button>";
      hint.classList.add("show");
      $("copy-key").addEventListener("click", () => {
        navigator.clipboard.writeText(res.body.key).then(() => {
          $("copy-key").textContent = "Copied";
          setTimeout(() => { $("copy-key").textContent = "Copy"; }, 1500);
        });
      });
      nameEl.value = "";
      setStatus("key created", "ok");
      await refresh();
    } else {
      setStatus("key creation failed", "error");
    }
  });

  $("burst-run").addEventListener("click", async () => {
    const count = Math.max(1, Math.min(2000, Number($("burst-count").value) || 300));
    const keyValue = $("burst-key").value.trim();
    const btn = $("burst-run");
    btn.disabled = true;
    setStatus("burst: " + count + " requests in flight…");

    let out = $("burst-result");
    if (!out) {
      out = document.createElement("div");
      out.id = "burst-result";
      out.className = "burst-table";
      $("view-burst").querySelector(".panel-body").appendChild(out);
    }
    out.innerHTML = "";

    const started = performance.now();
    const byStatus = {};
    const headers = keyValue ? { "x-api-key": keyValue } : {};

    await Promise.all(
      Array.from({ length: count }, () =>
        fetch("/v1/mirror", { headers })
          .then((res) => {
            byStatus[res.status] = (byStatus[res.status] || 0) + 1;
          })
          .catch(() => {
            byStatus["err"] = (byStatus["err"] || 0) + 1;
          }),
      ),
    );

    const ms = Math.round(performance.now() - started);
    const codes = Object.keys(byStatus).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
    const maxc = Math.max(1, ...codes.map((c) => byStatus[c]));

    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = "<thead><tr><th>Status</th><th>Count</th><th>Share</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const code of codes) {
      const okCode = code === "200";
      const share = Math.round((byStatus[code] / maxc) * 1000) / 10;
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td><span class='chip " + (okCode ? "ok" : "revoked") + "'>" + esc(code) + "</span></td>" +
        "<td class='mono'>" + byStatus[code] + "</td>" +
        "<td><div class='bar-wrap'><div class='bar'><div style='width:" + share + "%'></div></div><span class='pct'>" + share + "%</span></div></td>";
      tbody.appendChild(tr);
    }
    const foot = document.createElement("tr");
    foot.innerHTML =
      "<td><b>summary</b></td>" +
      "<td class='mono'>" + count + " req · " + ms + " ms</td>" +
      "<td class='mono'>~" + Math.round((count * 1000) / ms) + " rps</td>";
    tbody.appendChild(foot);
    table.appendChild(tbody);
    out.appendChild(table);

    const allOk = codes.every((c) => c === "200" || c === "404");
    setStatus("burst done", allOk ? "ok" : "error");
    btn.disabled = false;
  });

  $("metrics-refresh").addEventListener("click", async () => {
    const res = await fetch("/metrics", { headers: { "x-admin-key": adminKey.value } });
    const text = await res.text();
    $("metrics-output").textContent = text.slice(0, 4000) + (text.length > 4000 ? "\n… truncated" : "");
  });

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
      item.classList.add("active");
      const view = item.dataset.view;
      document.querySelectorAll(".main section").forEach((s) => (s.style.display = "none"));
      const sec = $("view-" + view);
      if (sec) sec.style.display = "block";
      $("crumb-view").textContent = item.textContent.trim();
    });
  });

  $("refresh").addEventListener("click", refresh);
  refresh();
  setInterval(refresh, 3000);
})();