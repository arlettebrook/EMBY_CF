/**
 * =================================================================================
 *     Cloudflare Worker 通用 Emby 反向代理脚本 (带 D1 统计版 + 别名快捷入口系统)
 * =================================================================================
 *
 * 版本: 3.0
 * 更新日志:
 * - 集成 D1 数据库统计功能
 * - 统计播放次数与获取链接次数
 * - 统计日期强制使用北京时间 (UTC+8)
 * - 集成前端页面
 * - 新增：别名快捷入口系统（URL Rewrite + 多线路选择）
 * - 新增：多线路加权随机选择
 * - 新增：自动 failover 机制
 * - 新增：后台管理面板 (/admin)
 * - 新增：线路健康检测
 *
 * 架构说明：
 *   用户请求 → alias 查询 → 线路选择 → rewrite 成旧格式 → 调用旧代理逻辑 → 原始流式代理继续工作
 *   原始代理核心逻辑完全保留，别名系统仅在外层做 URL Rewrite
 */

const MANUAL_REDIRECT_DOMAINS = [
  'emby.bangumi.ca',
  'aliyundrive.com',
  'aliyundrive.net',
  'aliyuncs.com',
  'alicdn.com',
  'aliyun.com',
  'cdn.aliyundrive.com',
  'xunlei.com',
  'xlusercdn.com',
  'xycdn.com',
  'sandai.net',
  'thundercdn.com',
  '115.com',
  '115cdn.com',
  '115cdn.net',
  'anxia.com',
  '189.cn',
  'mini189.cn',
  'ctyunxs.cn',
  'cloud.189.cn',
  'tianyiyun.com',
  'telecomjs.com',
  'quark.cn',
  'quarkdrive.cn',
  'uc.cn',
  'ucdrive.cn',
  'xiaoya.pro',
  'myqcloud.com',
  'cloudfront.net',
  'akamaized.net',
  'fastly.net',
  'hwcdn.net',
  'bytecdn.cn',
  'bdcdn.net'
];

const DOMAIN_PROXY_RULES = {
  // 'your-domain.com': 'target-domain.com',  // 示例：自定义域名转发规则
};

const JP_COLOS = ['NRT', 'KIX', 'FUK', 'OKA'];

const blocker = {
  keys: [".m3u8", ".ts", ".acc", ".m4s", "photocall.tv", "googlevideo.com"],
  check: function (url) {
      url = url.toLowerCase();
      let len = blocker.keys.filter(x => url.includes(x)).length;
      return len != 0;
  }
};

const PREFLIGHT_INIT = {
  status: 204,
  headers: new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*"
  })
};

const CONFIG = {
    pikpakProxyUrl: 'https://your-pikpak-proxy.com',  // 如需 PikPak 代理，请修改此处
    enableStats: true,
    cacheEnabled: true,
    rateLimit: {
        maxRequests: 1000,
        windowMs: 60000
    }
};

const PIKPAK_DOMAINS = [
    'pikpak.com', 'pikpak.net', 'pikpak-cn.com', 'pikpakcdn.com',
    'pikpakapi.com', 'pikpakdrive.com'
];

// ===== 新增：别名系统常量 =====
const ALIAS_MAX_RETRIES = 3;
// 注意：以下配置项已从环境变量读取，请在 Cloudflare Worker 设置中配置环境变量：
// ADMIN_PASSWORD - 管理员密码
// CF_API_TOKEN - Cloudflare API Token（需 DNS:Edit 权限）
// CF_ZONE_ID - 域名 Zone ID
// BASE_DOMAIN - 基础域名（如 example.com）

// ===== 新增：智能选线系统 =====
// 优选线路配置：每个子域名对应一个优选域名
// 需要在 Cloudflare DNS 中为每个子域名创建 CNAME 记录指向对应的优选域名
// 并在 Worker 路由中绑定 *.example.com/*
const SPEED_LINES = [
    { subdomain: 'proxy1', domain: 'cf.090227.xyz',       name: 'CF优选-090227' },
    { subdomain: 'proxy2', domain: 'cf.877774.xyz',        name: 'CF优选-877774' },
    { subdomain: 'proxy3', domain: 'cloudflare-dl.byoip.top', name: '鱼皮优选' },
    { subdomain: 'proxy4', domain: 'saas.sin.fan',         name: 'MIYU优选' },
    { subdomain: 'proxy5', domain: 'bestcf.030101.xyz',    name: 'Mingyu优选' },
    { subdomain: 'proxy6', domain: 'cf.cloudflare.182682.xyz', name: 'WeTest优选' },
    { subdomain: 'proxy7', domain: 'cf.tencentapp.cn',     name: '腾讯泛域名' },
    { subdomain: 'proxy8', domain: 'www.visa.cn',          name: 'Visa官方' },
    { subdomain: 'proxy9', domain: 'mfa.gov.ua',           name: '乌克兰外交部' },
    { subdomain: 'proxy10', domain: 'www.shopify.com',     name: 'Shopify官方' },
    { subdomain: 'proxy11', domain: 'store.ubi.com',       name: '育碧商店' },
    { subdomain: 'proxy12', domain: 'staticdelivery.nexusmods.com', name: 'NexusMods' },
];
const SPEED_CACHE_TTL = 3600;  // 缓存1小时

// 自动创建智能选线 DNS 记录（部署后自动调用）
async function ensureSpeedDnsRecords(env) {
    var apiToken = env.CF_API_TOKEN;
    var zoneId = env.CF_ZONE_ID;
    var baseDomain = env.BASE_DOMAIN;
    if (!apiToken || !zoneId || !baseDomain) {
        console.log('[智能选线DNS] 未配置 CF_API_TOKEN/CF_ZONE_ID/BASE_DOMAIN，跳过自动创建');
        return;
    }

    for (var i = 0; i < SPEED_LINES.length; i++) {
        var line = SPEED_LINES[i];
        var fullName = line.subdomain + '.' + baseDomain;
        try {
            // 检查是否已存在
            var checkRes = await fetch('https://api.cloudflare.com/client/v4/zones/' + zoneId + '/dns_records?name=' + encodeURIComponent(fullName), {
                headers: { 'Authorization': 'Bearer ' + apiToken, 'Content-Type': 'application/json' }
            });
            var checkData = await checkRes.json();
            if (checkData.success && checkData.result && checkData.result.length > 0) {
                console.log('[智能选线DNS] 已存在:', fullName, '->', line.domain);
                continue;
            }
            // 创建 CNAME 记录
            var createRes = await fetch('https://api.cloudflare.com/client/v4/zones/' + zoneId + '/dns_records', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + apiToken, 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'CNAME', name: fullName, content: line.domain, proxied: true })
            });
            var createData = await createRes.json();
            if (createData.success) {
                console.log('[智能选线DNS] 创建成功:', fullName, '->', line.domain);
            } else {
                console.error('[智能选线DNS] 创建失败:', fullName, createData.errors);
            }
        } catch (e) {
            console.error('[智能选线DNS] 异常:', fullName, e.message);
        }
    }
}

// ===== DNS 日志系统 =====
var dnsLogs = [];
function addDnsLog(type, message, data) {
    var log = {
        time: new Date().toISOString(),
        type: type,
        message: message,
        data: data
    };
    dnsLogs.unshift(log);
    if (dnsLogs.length > 100) dnsLogs.pop();
    console.log('[DNS LOG]', type, message, data);
}

// ===== 智能选线：测速页面 HTML =====
const SPEED_TEST_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>线路测速中...</title>
  <style>
    :root { --primary: #0a84ff; --bg: #000; --card: #1c1c1e; --text: #f5f5f7; --text-sec: #98989d; --border: #38383a; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .container { width: 100%; max-width: 500px; padding: 20px; }
    .card { background: var(--card); border-radius: 16px; padding: 30px; border: 1px solid var(--border); }
    h2 { color: var(--primary); font-size: 18px; margin-bottom: 20px; text-align: center; }
    .line-item { display: flex; align-items: center; padding: 12px 14px; border-radius: 10px; background: rgba(255,255,255,0.03); margin-bottom: 8px; border: 1px solid var(--border); gap: 10px; }
    .line-name { flex: 1; font-size: 14px; }
    .line-status { font-size: 13px; color: var(--text-sec); min-width: 60px; text-align: right; }
    .line-status.done { color: #30d158; }
    .line-status.fail { color: #ff453a; }
    .line-status.testing { color: var(--primary); }
    .line-status.best { color: #ff9f0a; font-weight: bold; }
    .progress { height: 3px; background: var(--border); border-radius: 2px; margin-top: 20px; overflow: hidden; }
    .progress-bar { height: 100%; background: var(--primary); border-radius: 2px; transition: width 0.3s; width: 0%; }
    .redirect-msg { text-align: center; margin-top: 16px; font-size: 14px; color: var(--text-sec); display: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h2>正在为您选择最优线路</h2>
      <div id="lines"></div>
      <div class="progress"><div class="progress-bar" id="progress"></div></div>
      <div class="redirect-msg" id="redirect-msg">即将跳转...</div>
    </div>
  </div>
  <script>
    var LINES = __SPEED_LINES__;
    var TARGET = __TARGET_URL__;
    var REPORT_API = '/__speed_report';
    var results = [];
    var done = 0;
    var total = LINES.length;

    function render() {
      var c = document.getElementById('lines');
      var html = '';
      for (var i = 0; i < LINES.length; i++) {
        var line = LINES[i];
        var r = results[i];
        var statusClass = 'testing';
        var statusText = '测速中...';
        if (r) {
          if (r.ok) { statusClass = 'done'; statusText = r.ms + 'ms'; }
          else { statusClass = 'fail'; statusText = '超时'; }
          if (r.best) { statusClass = 'best'; statusText = r.ms + 'ms ✓'; }
        }
        html += '<div class="line-item"><span class="line-name">' + line.name + '</span><span class="line-status ' + statusClass + '">' + statusText + '</span></div>';
      }
      c.innerHTML = html;
      document.getElementById('progress').style.width = Math.round(done / total * 100) + '%';
    }

    function testLine(index) {
      var line = LINES[index];
      var url = 'https://' + line.subdomain + '.' + window.location.hostname + '/__speed_ping';
      var start = Date.now();
      var controller = new AbortController();
      var tid = setTimeout(function() { controller.abort(); }, 5000);

      fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-cache', signal: controller.signal })
        .then(function() {
          clearTimeout(tid);
          results[index] = { ok: true, ms: Date.now() - start };
        })
        .catch(function() {
          clearTimeout(tid);
          results[index] = { ok: false, ms: 9999 };
        })
        .then(function() {
          done++;
          render();
          if (done === total) finish();
        });
    }

    function finish() {
      // 找最优
      var bestIdx = -1, bestMs = Infinity;
      for (var i = 0; i < results.length; i++) {
        if (results[i] && results[i].ok && results[i].ms < bestMs) {
          bestMs = results[i].ms;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        results[bestIdx].best = true;
        render();
        // 上报
        var reportData = [];
        for (var i = 0; i < results.length; i++) {
          reportData.push({ subdomain: LINES[i].subdomain, ms: results[i] ? results[i].ms : -1, ok: results[i] ? results[i].ok : false });
        }
        fetch(REPORT_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ best: LINES[bestIdx].subdomain, results: reportData })
        }).catch(function() {});

        // 跳转
        var redirectUrl = 'https://' + LINES[bestIdx].subdomain + '.' + window.location.hostname + TARGET;
        document.getElementById('redirect-msg').style.display = 'block';
        setTimeout(function() { window.location.replace(redirectUrl); }, 600);
      } else {
        document.getElementById('redirect-msg').textContent = '所有线路不可用，请稍后重试';
        document.getElementById('redirect-msg').style.display = 'block';
      }
    }

    render();
    for (var i = 0; i < total; i++) testLine(i);
  </script>
</body>
</html>
`;

// ===== 智能选线：核心逻辑函数 =====

// 确保缓存表存在
async function ensureSpeedCacheTable(env) {
    if (!env.DB) return false;
    try {
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS speed_region_cache (
                region_code TEXT,
                asn TEXT,
                best_subdomain TEXT,
                latency INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME,
                PRIMARY KEY (region_code, asn)
            )
        `).run();
        return true;
    } catch (e) {
        console.error('[智能选线] 创建缓存表失败:', e);
        return false;
    }
}

// 获取用户网络信息
function getUserNetworkInfo(request) {
    var country = (request.headers.get('cf-ipcountry') || 'XX').toUpperCase();
    var asn = 'AS' + (request.headers.get('cf-asn') || '0');
    return { regionCode: country, asn: asn };
}

// 查询缓存
async function getSpeedCache(env, regionCode, asn) {
    if (!env.DB) return null;
    try {
        var now = new Date().toISOString();
        return await env.DB.prepare(
            'SELECT best_subdomain, latency FROM speed_region_cache WHERE region_code = ? AND asn = ? AND expires_at > ?'
        ).bind(regionCode, asn, now).first();
    } catch (e) {
        console.error('[智能选线] 查询缓存失败:', e);
        return null;
    }
}

// 写入缓存
async function setSpeedCache(env, regionCode, asn, bestSubdomain, latency) {
    if (!env.DB) return;
    try {
        var now = new Date();
        var expires = new Date(now.getTime() + SPEED_CACHE_TTL * 1000).toISOString();
        await env.DB.prepare(`
            INSERT INTO speed_region_cache (region_code, asn, best_subdomain, latency, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(region_code, asn) DO UPDATE SET
                best_subdomain = excluded.best_subdomain,
                latency = excluded.latency,
                created_at = excluded.created_at,
                expires_at = excluded.expires_at
        `).bind(regionCode, asn, bestSubdomain, latency, now.toISOString(), expires).run();
        console.log('[智能选线] 缓存写入:', regionCode, asn, '->', bestSubdomain, latency + 'ms');
    } catch (e) {
        console.error('[智能选线] 写入缓存失败:', e);
    }
}

// 处理智能选线入口（proxy.your-domain.com/emby.com）
async function handleSmartRoute(request, env, ctx, targetPath) {
    await ensureSpeedCacheTable(env);

    var netInfo = getUserNetworkInfo(request);
    console.log('[智能选线] 用户:', netInfo.regionCode, netInfo.asn, '目标:', targetPath);

    // 1. 查缓存
    var cached = await getSpeedCache(env, netInfo.regionCode, netInfo.asn);
    if (cached) {
        console.log('[智能选线] 缓存命中 ->', cached.best_subdomain, cached.latency + 'ms');
        // 302 重定向到最优子域名
        var baseDomain = env.BASE_DOMAIN || request.headers.get('host');
        baseDomain = baseDomain.split(':')[0];
        var redirectUrl = 'https://' + cached.best_subdomain + '.' + baseDomain + '/' + targetPath;
        return Response.redirect(redirectUrl, 302);
    }

    // 2. 无缓存，返回测速页面
    console.log('[智能选线] 缓存未命中，返回测速页面');
    var baseDomain = env.BASE_DOMAIN || request.headers.get('host');
    baseDomain = baseDomain.split(':')[0];

    // 构建线路列表 JSON（供前端 JS 使用）
    var linesJson = JSON.stringify(SPEED_LINES.map(function(l) {
        return { subdomain: l.subdomain, name: l.name + ' (' + l.domain + ')' };
    }));

    var html = SPEED_TEST_HTML
        .replace('__SPEED_LINES__', linesJson)
        .replace('__TARGET_URL__', '/' + targetPath);

    return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}

// 处理测速 ping 端点（/__speed_ping）
function handleSpeedPing() {
    return new Response('', { status: 204 });
}

// 处理测速结果上报（/__speed_report）
async function handleSpeedReport(request, env) {
    try {
        var body = await request.json();
        var bestSubdomain = body.best;
        var testResults = body.results || [];

        // 获取用户网络信息
        var netInfo = getUserNetworkInfo(request);

        // 找到最优线路的延迟
        var bestLatency = 0;
        for (var i = 0; i < testResults.length; i++) {
            if (testResults[i].subdomain === bestSubdomain) {
                bestLatency = testResults[i].ms;
                break;
            }
        }

        // 写入缓存
        await setSpeedCache(env, netInfo.regionCode, netInfo.asn, bestSubdomain, bestLatency);

        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// ===== 前端页面HTML（原始，未修改） =====
const FRONTEND_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Emby 反代工具指南 | 声明</title>
  <link rel="icon" href="/favicon.ico" type="image/webp">
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #e1e4e8; margin: 0; padding: 0; background-color: #1a1c22; display: flex; min-height: 100vh; }
    .container { width: 100%; max-width: 800px; margin: auto; padding: 20px; display: flex; flex-direction: column; gap: 20px; }
    .content-section { background: #252830; padding: 40px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border-top: 5px solid #0070f3; }
    .content-section h1 { margin-top: 0; color: #0070f3; display: flex; align-items: center; }
    h2 { color: #0070f3; border-bottom: 2px solid #3e4451; padding-bottom: 10px; margin-top: 30px; }
    code { background: rgba(0, 112, 243, 0.1); padding: 4px 8px; border-radius: 4px; font-family: 'Fira Code', monospace; font-size: 0.9em; color: #61afef; word-break: break-all; border: 1px solid rgba(0, 112, 243, 0.2); }
    .example-box { background: rgba(0, 112, 243, 0.05); border-left: 4px solid #0070f3; padding: 15px; margin: 15px 0; border-radius: 0 8px 8px 0; }
    .warning { color: #e06c75; font-weight: bold; border: 2px solid rgba(224, 108, 117, 0.3); padding: 20px; border-radius: 12px; margin-top: 40px; background: rgba(224, 108, 117, 0.05); }
    .strong-red { color: #e06c75; font-weight: 900; text-decoration: underline; font-size: 1.1em; }
    .status-tag { display: inline-block; background: #0070f3; color: white; padding: 2px 10px; border-radius: 4px; font-weight: bold; margin-bottom: 10px; }
    .feature-card { background: rgba(0, 112, 243, 0.1); border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #0070f3; }
    .feature-card h3 { color: #0070f3; margin-top: 0; font-size: 1.2em; }
    .feature-card p { margin-bottom: 0; color: #abb2bf; }
    .footer-text { margin-top: 30px; padding-top: 20px; border-top: 1px dashed #3e4451; font-size: 0.9em; }
    .stat-card { background: rgba(0, 112, 243, 0.1); padding: 20px; border-radius: 8px; text-align: center; flex: 1; margin: 0 10px; border: 1px solid rgba(0, 112, 243, 0.2); }
    .stat-card:first-child { margin-left: 0; }
    .stat-card:last-child { margin-right: 0; }
    .stat-value { font-size: 2em; font-weight: bold; color: #0070f3; margin-top: 10px; }
    #daily-stats { background: rgba(0, 0, 0, 0.2); border-radius: 8px; padding: 15px; overflow-x: auto; }
    .stats-table { width: 100%; border-collapse: collapse; }
    .stats-table th, .stats-table td { padding: 10px; text-align: left; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
    .stats-table th { background: rgba(0, 112, 243, 0.2); font-weight: bold; color: #0070f3; }
    .stats-table tr:hover { background: rgba(0, 112, 243, 0.1); }
    @media (max-width: 900px) { .container { padding: 10px; } .content-section { padding: 20px; } .stat-card { margin: 5px; padding: 15px; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="content-section" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;">
      <h1 style="margin:0;">🚀 使用指南</h1>
      <a href="/admin" style="background:#0070f3;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">🔐 管理后台</a>
    </div>
    <div class="content-section">
      <h2>通用格式</h2>
      <div class="example-box">
        <code id="example-format-1">https://proxy.your-domain.com/你的域名:端口</code><br>
        <code id="example-format-2" style="display:inline-block; margin-top:8px;">https://proxy.your-domain.com/http://你的域名:端口</code><br>
        <code id="example-format-3" style="display:inline-block; margin-top:8px;">https://proxy.your-domain.com/https://你的域名:端口</code>
      </div>
      <h2>HTTP 示例</h2>
      <div class="example-box">
        <code id="example-http">https://proxy.your-domain.com/http://emby.com</code>
      </div>
      <h2>HTTPS 示例</h2>
      <div class="example-box">
        <code id="example-https">https://proxy.your-domain.com/https://emby.com</code>
      </div>
      <div class="warning">
        ⚠️ <strong>严正警告：</strong><br>
        添加服后 <span class="strong-red">务必手动测试</span> 是否可用。禁止未经测试大批量添加，导致服务器报错刷屏、恶意占用资源者，<span class="strong-red">直接封禁 IP，不予通知！</span>
      </div>
    </div>
    <div class="content-section">
      <div class="status-tag">关于本服务</div>
      <h1>🔧 Emby 反向代理</h1>
      <p><strong>服务特点：</strong></p>
      <ul style="list-style-type: disc; padding-left: 20px; color: #abb2bf;">
        <li>高速稳定的反向代理服务</li>
        <li>支持 WebSocket 连接</li>
        <li>智能重定向处理</li>
        <li>详细的使用统计</li>
        <li>全球节点覆盖</li>
      </ul>
      <div class="feature-card">
        <h3>📊 统计功能</h3>
        <p>本服务集成了 D1 数据库统计功能，可以记录播放次数和获取链接次数，帮助您了解服务使用情况。</p>
      </div>
      <div class="feature-card">
        <h3>🌍 全球节点</h3>
        <p>利用 Cloudflare 全球 CDN 网络，为您提供就近的访问节点，确保最佳的访问速度。</p>
      </div>
      <div class="content-section" id="stats-section">
        <h2>📈 使用统计</h2>
        <div id="stats-loading">加载统计数据中...</div>
        <div id="stats-error" style="display: none; color: #e06c75;"></div>
        <div id="stats-content" style="display: none;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 20px;">
            <div class="stat-card">
              <h3>总播放次数</h3>
              <div id="total-playing" class="stat-value">0</div>
            </div>
            <div class="stat-card">
              <h3>总获取链接次数</h3>
              <div id="total-playback-info" class="stat-value">0</div>
            </div>
          </div>
          <div style="margin-bottom: 20px; color: #666; font-size: 14px;">
            <p>备注：以上统计数据为最近30天的累计数据</p>
          </div>
          <h3>每日统计</h3>
          <div style="margin-bottom: 10px; color: #666; font-size: 14px;">
            <p>备注：每日统计显示最近10天的数据</p>
          </div>
          <div id="daily-stats"></div>
          <div class="footer-text" style="margin-top: 20px;">
            <p>数据更新时间: <span id="last-updated">--</span></p>
            <p>每小时自动更新</p>
          </div>
        </div>
      </div>
      <div class="footer-text">
        <p>© 2026 Emby 反向代理服务</p>
        <p>本服务仅用于学习和研究目的</p>
        <p>交流反馈群组: <a href="https://t.me/Dirige_Proxy" target="_blank" style="color: #0070f3; text-decoration: none;">https://t.me/Dirige_Proxy</a></p>
      </div>
    </div>
  </div>
  <script>
    // 获取当前域名用于显示示例
    var currentDomain = window.location.hostname;
    if (currentDomain && currentDomain !== 'localhost' && !currentDomain.includes('your-domain')) {
      document.getElementById('example-format-1').textContent = 'https://' + currentDomain + '/你的域名:端口';
      document.getElementById('example-format-2').textContent = 'https://' + currentDomain + '/http://你的域名:端口';
      document.getElementById('example-format-3').textContent = 'https://' + currentDomain + '/https://你的域名:端口';
      document.getElementById('example-http').textContent = 'https://' + currentDomain + '/http://emby.com';
      document.getElementById('example-https').textContent = 'https://' + currentDomain + '/https://emby.com';
    }

    async function fetchStats() {
      try {
        const response = await fetch('/stats');
        const data = await response.json();
        if (data.error) {
          document.getElementById('stats-loading').style.display = 'none';
          document.getElementById('stats-error').style.display = 'block';
          document.getElementById('stats-content').style.display = 'none';
          document.getElementById('stats-error').textContent = data.error;
          return;
        }
        document.getElementById('total-playing').textContent = data.data.total.playing;
        document.getElementById('total-playback-info').textContent = data.data.total.playbackInfo;
        document.getElementById('last-updated').textContent = data.data.lastUpdated;
        const dailyStatsContainer = document.getElementById('daily-stats');
        if (data.data.dailyStats.length > 0) {
          var tableHTML = '<table class="stats-table"><thead><tr><th>日期</th><th>播放次数</th><th>获取链接次数</th></tr></thead><tbody>';
          const recentStats = data.data.dailyStats.slice(0, 10);
          recentStats.forEach(function(stat) {
            tableHTML += '<tr><td>' + stat.date + '</td><td>' + stat.playing_count + '</td><td>' + stat.playback_info_count + '</td></tr>';
          });
          tableHTML += '</tbody></table>';
          dailyStatsContainer.innerHTML = tableHTML;
        } else {
          dailyStatsContainer.innerHTML = '<p>暂无统计数据</p>';
        }
        document.getElementById('stats-loading').style.display = 'none';
        document.getElementById('stats-error').style.display = 'none';
        document.getElementById('stats-content').style.display = 'block';
      } catch (error) {
        console.error('获取统计数据失败:', error);
        document.getElementById('stats-loading').style.display = 'none';
        document.getElementById('stats-error').style.display = 'block';
        document.getElementById('stats-content').style.display = 'none';
        document.getElementById('stats-error').textContent = '获取统计数据失败，请稍后再试';
      }
    }
    fetchStats();
    setInterval(fetchStats, 3600000);
  </script>
</body>
</html>
`;

// ===== 新增：管理后台登录页 =====
const ADMIN_LOGIN_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>系统授权</title>
  <style>
    :root { --primary: #0a84ff; --bg: #000000; --card: #1c1c1e; --text: #f5f5f7; --text-sec: #98989d; --border: #38383a; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: var(--bg); color: var(--text); }
    .login-box { background: var(--card); padding: 40px 30px; border-radius: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); text-align: center; width: 100%; max-width: 360px; border: 1px solid var(--border); }
    .login-box h2 { margin: 0 0 24px 0; font-size: 22px; font-weight: 600; color: var(--primary); }
    .login-box input { width: 100%; padding: 16px; margin-bottom: 20px; border: 1px solid var(--border); border-radius: 12px; font-size: 15px; outline: none; background: var(--bg); color: var(--text); }
    .login-box input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(10,132,255,0.15); }
    .login-box button { width: 100%; padding: 16px; background: var(--primary); color: white; border: none; border-radius: 12px; cursor: pointer; font-weight: 600; font-size: 16px; }
    .login-box button:hover { background: #0071e3; }
    #toast { position: fixed; top: -60px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.85); color: white; padding: 12px 24px; border-radius: 30px; font-size: 14px; font-weight: 500; transition: top 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); z-index: 9999; }
    #toast.show { top: 20px; }
  </style>
</head>
<body>
  <div id="toast"></div>
  <div class="login-box">
    <h2>安全中心</h2>
    <input type="password" id="tokenInput" placeholder="请输入管理密码" onkeydown="if(event.key==='Enter')login()">
    <button onclick="login()">验 证 登 录</button>
  </div>
  <script>
    function showToast(msg) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(function() { t.classList.remove('show'); }, 2000);
    }
    function login() {
      var token = document.getElementById('tokenInput').value.trim();
      if (!token) return showToast('请输入密码');
      document.cookie = 'admin_token=' + encodeURIComponent(token) + '; path=/; max-age=2592000';
      window.location.reload();
    }
  </script>
</body>
</html>
`;

// ===== 新增：管理后台仪表盘页 =====
const ADMIN_DASHBOARD_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>别名快捷入口管理</title>
  <style>
    :root { --primary: #0a84ff; --primary-hover: #0071e3; --bg: #000000; --card: #1c1c1e; --text: #f5f5f7; --text-sec: #98989d; --border: #38383a; --radius: 14px; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    .top-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; padding: 20px 24px; background: var(--card); border-radius: var(--radius); border: 1px solid var(--border); }
    .top-bar h1 { margin: 0; font-size: 20px; color: var(--primary); }
    .btn { padding: 10px 18px; border: none; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 14px; transition: 0.2s; }
    .btn-primary { background: var(--primary); color: white; }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-danger { background: #ff453a; color: white; }
    .btn-danger:hover { background: #d63029; }
    .btn-success { background: #30d158; color: white; }
    .btn-success:hover { background: #28a745; }
    .btn-warning { background: #ff9f0a; color: white; }
    .btn-warning:hover { background: #d68600; }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text-sec); }
    .btn-outline:hover { border-color: var(--primary); color: var(--primary); }
    .btn-sm { padding: 6px 12px; font-size: 12px; }
    .node-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 20px; }
    .emby-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; display: flex; flex-direction: column; gap: 14px; }
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
    .card-title-group { display: flex; align-items: center; gap: 12px; }
    .card-icon { font-size: 28px; background: rgba(10,132,255,0.08); border-radius: 10px; padding: 6px; border: 1px solid var(--border); width: 42px; height: 42px; flex-shrink: 0; text-align: center; }
    .card-title { font-weight: 700; font-size: 16px; color: var(--text); }
    .card-subtitle { font-size: 13px; color: var(--text-sec); margin-top: 2px; }
    .card-remark { font-size: 12px; color: var(--text-sec); margin-top: 4px; font-style: italic; }
    .info-row { display: flex; align-items: flex-start; justify-content: space-between; font-size: 13px; }
    .info-label { color: var(--text-sec); font-weight: 500; min-width: 65px; margin-top: 4px; }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; display: inline-block; vertical-align: middle; }
    .dot-green { background: #30d158; box-shadow: 0 0 6px rgba(48,209,88,0.4); }
    .dot-red { background: #ff453a; box-shadow: 0 0 6px rgba(255,69,58,0.4); }
    .dot-yellow { background: #ff9f0a; box-shadow: 0 0 6px rgba(255,159,10,0.4); }
    .line-item { display: flex; align-items: center; padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,0.03); gap: 10px; flex-wrap: wrap; border: 1px solid var(--border); }
    .line-origin { color: #64d2ff; font-family: monospace; font-size: 0.88em; word-break: break-all; }
    .line-badge { padding: 3px 10px; border-radius: 6px; font-size: 0.78em; font-weight: 500; white-space: nowrap; }
    .badge-weight { background: rgba(10,132,255,0.15); color: #64d2ff; }
    .badge-latency { background: rgba(48,209,88,0.15); color: #30d158; }
    .badge-fail { background: rgba(255,69,58,0.15); color: #ff453a; }
    .badge-disabled { background: rgba(142,142,147,0.15); color: #8e8e93; }
    .badge-dns { background: rgba(255,159,10,0.15); color: #ff9f0a; }
    .card-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: auto; padding-top: 12px; border-top: 1px dashed var(--border); flex-wrap: wrap; }
    .no-data { text-align: center; color: var(--text-sec); padding: 60px 20px; grid-column: 1 / -1; }
    .modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 1000; justify-content: center; align-items: center; backdrop-filter: blur(4px); }
    .modal-overlay.active { display: flex; }
    .modal-box { background: var(--card); border-radius: 20px; padding: 32px; width: 440px; max-width: 90vw; box-shadow: 0 20px 60px rgba(0,0,0,0.4); border: 1px solid var(--border); }
    .modal-box h3 { margin: 0 0 20px 0; color: var(--primary); }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; color: var(--text-sec); margin-bottom: 6px; font-size: 0.88em; font-weight: 500; }
    .form-group input { width: 100%; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px; font-size: 15px; outline: none; background: var(--bg); color: var(--text); }
    .form-group input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(10,132,255,0.15); }
    .modal-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; }
    #toast { position: fixed; top: -60px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.85); color: white; padding: 12px 24px; border-radius: 30px; font-size: 14px; font-weight: 500; transition: top 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); z-index: 9999; }
    #toast.show { top: 20px; }
    @media (max-width: 600px) {
      body { padding: 10px; }
      .node-grid { grid-template-columns: 1fr; }
      .line-item { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>
  <div id="toast"></div>
  <div class="container">
    <div class="top-bar">
      <h1>别名快捷入口管理</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="showAddNodeModal()">+ 新增别名组</button>
        <button class="btn btn-outline" onclick="doLogout()">退出登录</button>
      </div>
    </div>
    <div id="nodes-list" class="node-grid"></div>
  </div>
  <div id="modal-overlay" class="modal-overlay">
    <div class="modal-box">
      <h3 id="modal-title"></h3>
      <div id="modal-body"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" id="modal-confirm" onclick="modalConfirm()">确认</button>
      </div>
    </div>
  </div>
  <script>
    var modalCallback = null;
    var currentNodes = null;
    var config = { baseDomain: 'example.com' };
    function showToast(msg) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(function() { t.classList.remove('show'); }, 2500);
    }
    function apiCall(method, path, body) {
      var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      return fetch('/admin/api' + path, opts).then(function(res) { return res.json(); });
    }
    function doLogout() {
      document.cookie = 'admin_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      window.location.href = '/admin';
    }
    function loadConfig() {
      apiCall('GET', '/config').then(function(r) {
        if (r.success && r.data) {
          config.baseDomain = r.data.baseDomain || 'example.com';
        }
        loadNodes();
      }).catch(function(e) { loadNodes(); });
    }
    function loadNodes() {
      apiCall('GET', '/nodes').then(function(r) {
        if (r.success) { currentNodes = r.data; renderNodes(r.data); }
        else showToast(r.error || '加载失败');
      }).catch(function(e) { showToast('网络错误'); });
    }
    function escapeHtml(str) {
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
    function renderNodes(nodes) {
      var c = document.getElementById('nodes-list');
      if (!nodes || nodes.length === 0) {
        c.innerHTML = '<div class="no-data">暂无别名组，点击上方按钮新增</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var kw = node.keyword || '';
        var rm = node.remark || '';
        html += '<div class="emby-card" data-node-index="' + i + '">';
        html += '<div class="card-header">';
        html += '<div class="card-title-group">';
        html += '<div class="card-icon">🎬</div>';
        html += '<div>';
        html += '<div class="card-title">/' + escapeHtml(kw) + '</div>';
        html += '<div class="card-subtitle">proxy.' + config.baseDomain + '/' + escapeHtml(kw) + '</div>';
        if (rm) html += '<div class="card-remark">' + escapeHtml(rm) + '</div>';
        html += '</div></div>';
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
        html += '<button class="btn btn-outline btn-sm action-edit">编辑</button>';
        html += '<button class="btn btn-danger btn-sm action-delete">删除</button>';
        html += '</div></div>';
        html += '<div class="info-row"><span class="info-label">子域名:</span><span class="badge-dns line-badge">' + escapeHtml(kw) + '.' + config.baseDomain + '</span></div>';
        html += '<div style="display:flex;flex-direction:column;gap:8px;">';
        if (node.lines && node.lines.length > 0) {
          for (var j = 0; j < node.lines.length; j++) {
            var line = node.lines[j];
            var dotCls = (line.healthy && line.enabled) ? 'dot-green' : (line.enabled ? 'dot-red' : 'dot-yellow');
            html += '<div class="line-item" data-line-index="' + j + '">';
            html += '<span class="status-dot ' + dotCls + '"></span>';
            html += '<span class="line-origin">' + escapeHtml(line.origin) + '</span>';
            html += '<span class="line-badge badge-weight">权重 ' + line.weight + '</span>';
            // 只要有延迟值就显示（包括0，表示检测完成但可能超时或失败）
            html += '<span class="line-badge badge-latency">' + (line.latency || 0) + 'ms</span>';
            if (line.fail_count > 0) html += '<span class="line-badge badge-fail">失败 ' + line.fail_count + '</span>';
            if (!line.enabled) html += '<span class="line-badge badge-disabled">已禁用</span>';
            if (!line.healthy && line.enabled) html += '<span class="line-badge badge-fail">不健康</span>';
            html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-left:auto;">';
            html += '<button class="btn btn-success btn-sm action-check">检测</button>';
            html += '<button class="btn btn-warning btn-sm action-toggle">' + (line.enabled ? '禁用' : '启用') + '</button>';
            html += '<button class="btn btn-danger btn-sm action-line-delete">删除</button>';
            html += '</div></div>';
          }
        } else {
          html += '<div style="text-align:center;color:var(--text-sec);padding:12px;font-size:13px;">暂无线路</div>';
        }
        html += '</div>';
        html += '<div class="card-footer">';
        html += '<button class="btn btn-primary btn-sm action-add-line">+ 添加线路</button>';
        html += '</div></div>';
      }
      c.innerHTML = html;
      c.querySelectorAll('.emby-card').forEach(function(card, idx) {
        var node = nodes[idx];
        card.querySelector('.action-edit').onclick = function() { showEditNodeModal(node.id, node.keyword, node.remark); };
        card.querySelector('.action-delete').onclick = function() {
          if (!confirm('确定删除此别名组及其所有线路？')) return;
          apiCall('DELETE', '/nodes/' + node.id).then(function(r) {
            if (r.success) { loadNodes(); showToast('已删除'); }
            else showToast(r.error || '删除失败');
          });
        };
        card.querySelector('.action-add-line').onclick = function() { showAddLineModal(node.id, node.keyword); };
        card.querySelectorAll('.line-item').forEach(function(lineEl, lj) {
          var line = node.lines[lj];
          lineEl.querySelector('.action-check').onclick = function() {
            showToast('检测中...');
            apiCall('POST', '/lines/' + line.id + '/check').then(function(r) {
              if (r.success) { loadNodes(); showToast(r.data.healthy ? '线路健康, 延迟 ' + r.data.latency + 'ms' : '线路不健康'); }
              else showToast(r.error || '检测失败');
            });
          };
          lineEl.querySelector('.action-toggle').onclick = function() {
            apiCall('PUT', '/lines/' + line.id, { enabled: line.enabled ? 0 : 1 }).then(function(r) { if (r.success) loadNodes(); else showToast(r.error || '操作失败'); });
          };
          lineEl.querySelector('.action-line-delete').onclick = function() {
            if (!confirm('确定删除此线路？')) return;
            apiCall('DELETE', '/lines/' + line.id).then(function(r) { if (r.success) { loadNodes(); showToast('已删除'); } else showToast(r.error || '删除失败'); });
          };
        });
      });
    }
    function showModal(title, bodyHtml, callback) {
      document.getElementById('modal-title').textContent = title;
      document.getElementById('modal-body').innerHTML = bodyHtml;
      document.getElementById('modal-overlay').classList.add('active');
      modalCallback = callback;
    }
    function closeModal() {
      document.getElementById('modal-overlay').classList.remove('active');
      modalCallback = null;
    }
    function modalConfirm() {
      if (modalCallback) modalCallback();
    }
    function showAddNodeModal() {
      showModal('新增别名组',
        '<div class="form-group"><label>关键字 (keyword)</label><input id="f-keyword" placeholder="例如: myemby"></div>' +
        '<div class="form-group"><label>备注</label><input id="f-remark" placeholder="可选"></div>',
        function() {
          var keyword = document.getElementById('f-keyword').value.trim();
          if (!keyword) { showToast('请输入关键字'); return; }
          apiCall('POST', '/nodes', { keyword: keyword, remark: document.getElementById('f-remark').value.trim() }).then(function(r) {
            if (r.success) { closeModal(); loadNodes(); showToast('创建成功'); }
            else showToast(r.error || '创建失败');
          });
        }
      );
    }
    function showEditNodeModal(nodeId, keyword, remark) {
      showModal('编辑别名组',
        '<div class="form-group"><label>关键字 (keyword)</label><input id="f-keyword" value="' + escapeHtml(keyword || '') + '"></div>' +
        '<div class="form-group"><label>备注</label><input id="f-remark" value="' + escapeHtml(remark || '') + '"></div>',
        function() {
          var newKeyword = document.getElementById('f-keyword').value.trim();
          var newRemark = document.getElementById('f-remark').value.trim();
          if (!newKeyword) { showToast('关键字不能为空'); return; }
          apiCall('PUT', '/nodes/' + nodeId, { keyword: newKeyword, remark: newRemark }).then(function(r) {
            if (r.success) { closeModal(); loadNodes(); showToast('更新成功'); }
            else showToast(r.error || '更新失败');
          });
        }
      );
    }
    function showAddLineModal(nodeId, keyword) {
      showModal('新增线路 - ' + keyword,
        '<div class="form-group"><label>线路地址 (origin)</label><input id="f-origin" placeholder="https://xxx.com"></div>' +
        '<div class="form-group"><label>权重</label><input id="f-weight" type="number" value="1" min="1"></div>',
        function() {
          var origin = document.getElementById('f-origin').value.trim();
          if (!origin) { showToast('请输入线路地址'); return; }
          apiCall('POST', '/lines', { node_id: nodeId, origin: origin, weight: parseInt(document.getElementById('f-weight').value) || 1 }).then(function(r) {
            if (r.success) { closeModal(); loadNodes(); showToast('添加成功'); }
            else showToast(r.error || '添加失败');
          });
        }
      );
    }
    loadConfig();
  </script>
</body>
</html>
`;

// ===== 新增：别名系统工具函数 =====

// 确保别名相关 D1 表存在
async function ensureAliasTables(env) {
    if (!env.DB) return false;
    try {
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS alias_nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                keyword TEXT,
                remark TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS alias_lines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id INTEGER,
                origin TEXT,
                weight INTEGER DEFAULT 1,
                enabled INTEGER DEFAULT 1,
                healthy INTEGER DEFAULT 1,
                latency INTEGER DEFAULT 0,
                fail_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();
        return true;
    } catch (e) {
        console.error('创建别名表失败:', e);
        return false;
    }
}

// 查询别名：根据 pathname 的第一段判断是否为别名关键字
async function lookupAlias(pathname, env) {
    if (!env.DB) return null;

    // 提取第一段路径
    var segments = pathname.substring(1).split('/');
    var keyword = segments[0];
    if (!keyword) return null;

    // 如果包含点号或以 http 开头，说明是域名/URL格式，不是别名
    if (keyword.includes('.') || keyword.toLowerCase().startsWith('http')) return null;

    try {
        // 查询别名节点
        var node = await env.DB.prepare(
            'SELECT id, keyword FROM alias_nodes WHERE keyword = ? LIMIT 1'
        ).bind(keyword).first();
        if (!node) return null;

        // 查询该节点下所有启用的线路
        var linesResult = await env.DB.prepare(
            'SELECT * FROM alias_lines WHERE node_id = ? AND enabled = 1'
        ).bind(node.id).all();
        if (!linesResult.results || linesResult.results.length === 0) return null;

        // 拼接剩余路径
        var remainingPath = segments.slice(1).join('/');

        return {
            keyword: node.keyword,
            nodeId: node.id,
            lines: linesResult.results,
            remainingPath: remainingPath
        };
    } catch (e) {
        console.error('别名查询失败:', e);
        return null;
    }
}

// 加权随机选择线路
function selectLine(lines) {
    // 优先选择 healthy=1 且 enabled=1 的线路
    var healthyLines = lines.filter(function(l) { return l.healthy === 1 && l.enabled === 1; });
    if (healthyLines.length > 0) return weightedRandom(healthyLines);

    // 退而求其次：所有 enabled=1 的线路（即使 unhealthy）
    var enabledLines = lines.filter(function(l) { return l.enabled === 1; });
    if (enabledLines.length > 0) return weightedRandom(enabledLines);

    return null;
}

// 加权随机算法
function weightedRandom(lines) {
    var totalWeight = 0;
    for (var i = 0; i < lines.length; i++) totalWeight += lines[i].weight;
    var random = Math.random() * totalWeight;
    for (var i = 0; i < lines.length; i++) {
        random -= lines[i].weight;
        if (random <= 0) return lines[i];
    }
    return lines[lines.length - 1];
}

// 标记线路为不健康
async function markUnhealthy(env, lineId) {
    if (!env.DB) return;
    try {
        await env.DB.prepare(
            'UPDATE alias_lines SET healthy = 0, fail_count = fail_count + 1 WHERE id = ?'
        ).bind(lineId).run();
    } catch (e) {
        console.error('标记线路不健康失败:', e);
    }
}

// 标记线路为健康并更新延迟
async function markHealthy(env, lineId, latency) {
    if (!env.DB) return;
    try {
        await env.DB.prepare(
            'UPDATE alias_lines SET healthy = 1, latency = ?, fail_count = 0 WHERE id = ?'
        ).bind(latency, lineId).run();
    } catch (e) {
        console.error('标记线路健康失败:', e);
    }
}

// 从请求中读取 admin_token Cookie
function getAdminCookie(request) {
    var cookieString = request.headers.get('Cookie');
    if (!cookieString) return null;
    var match = cookieString.match(/(^| )admin_token=([^;]+)/);
    if (match) return decodeURIComponent(match[2]);
    return null;
}

// 验证管理员身份
function verifyAdmin(request, env) {
    var token = getAdminCookie(request);
    return token === env.ADMIN_PASSWORD;
}

// ===== 新增：管理后台处理 =====
async function handleAdmin(request, env, workerUrl, ctx) {
    var pathname = workerUrl.pathname;

    // 管理后台页面
    if (pathname === '/admin' || pathname === '/admin/') {
        if (verifyAdmin(request, env)) {
            return new Response(ADMIN_DASHBOARD_HTML, {
                headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
            });
        } else {
            return new Response(ADMIN_LOGIN_HTML, {
                headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
            });
        }
    }

    // API 路由
    if (pathname.startsWith('/admin/api/')) {
        return handleAdminAPI(request, env, pathname, ctx);
    }

    return new Response('Not Found', { status: 404 });
}

// 管理后台 API 处理
async function handleAdminAPI(request, env, pathname, ctx) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
        return new Response(null, PREFLIGHT_INIT);
    }

    // API 接口需要认证
    if (!verifyAdmin(request, env)) {
        return new Response(JSON.stringify({ success: false, error: '未登录或密码错误' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    // 确保 D1 表存在
    await ensureAliasTables(env);
    if (!env.DB) {
        return new Response(JSON.stringify({ success: false, error: 'D1 数据库未绑定' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    // 路由分发
    if (pathname === '/admin/api/nodes' && request.method === 'GET') {
        return handleAdminGetNodes(env);
    }
    if (pathname === '/admin/api/nodes' && request.method === 'POST') {
        return handleAdminCreateNode(request, env, ctx);
    }
    if (pathname.match(/^\/admin\/api\/nodes\/\d+$/) && request.method === 'PUT') {
        var nodeId = parseInt(pathname.split('/').pop());
        return handleAdminUpdateNode(request, env, nodeId, ctx);
    }
    if (pathname.match(/^\/admin\/api\/nodes\/\d+$/) && request.method === 'DELETE') {
        var nodeId = parseInt(pathname.split('/').pop());
        return handleAdminDeleteNode(env, nodeId, ctx);
    }
    if (pathname === '/admin/api/lines' && request.method === 'POST') {
        return handleAdminCreateLine(request, env);
    }
    if (pathname.match(/^\/admin\/api\/lines\/\d+$/) && request.method === 'PUT') {
        var lineId = parseInt(pathname.split('/').pop());
        return handleAdminUpdateLine(request, env, lineId);
    }
    if (pathname.match(/^\/admin\/api\/lines\/\d+$/) && request.method === 'DELETE') {
        var lineId = parseInt(pathname.split('/').pop());
        return handleAdminDeleteLine(env, lineId);
    }
    if (pathname.match(/^\/admin\/api\/lines\/\d+\/check$/) && request.method === 'POST') {
        var lineId = parseInt(pathname.split('/').filter(Boolean).pop());
        return handleAdminCheckLine(env, lineId);
    }
    
    // DNS日志查看接口
    if (pathname === '/admin/api/dns/logs' && request.method === 'GET') {
        return new Response(JSON.stringify({ success: true, data: dnsLogs }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    // 配置信息接口（供前端获取域名等配置）
    if (pathname === '/admin/api/config' && request.method === 'GET') {
        return new Response(JSON.stringify({
            success: true,
            data: {
                baseDomain: env.BASE_DOMAIN || 'example.com'
            }
        }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }

    return new Response(JSON.stringify({ success: false, error: '未知接口' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
}

// 获取所有别名节点及线路
async function handleAdminGetNodes(env) {
    try {
        var nodesResult = await env.DB.prepare('SELECT * FROM alias_nodes ORDER BY id DESC').all();
        var nodes = nodesResult.results || [];

        // 批量查询所有线路
        var linesResult = await env.DB.prepare('SELECT * FROM alias_lines ORDER BY weight DESC').all();
        var allLines = linesResult.results || [];

        // 按节点分组
        var linesByNode = {};
        allLines.forEach(function(line) {
            if (!linesByNode[line.node_id]) linesByNode[line.node_id] = [];
            linesByNode[line.node_id].push(line);
        });

        nodes.forEach(function(node) {
            node.lines = linesByNode[node.id] || [];
        });

        return new Response(JSON.stringify({ success: true, data: nodes }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: '查询失败: ' + e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}

// 创建别名节点
async function handleAdminCreateNode(request, env, ctx) {
    try {
        var body = await request.json();
        var keyword = (body.keyword || '').trim();
        var remark = (body.remark || '').trim();
        if (!keyword) {
            return new Response(JSON.stringify({ success: false, error: '关键字不能为空' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }
        // 检查关键字是否已存在
        var existing = await env.DB.prepare('SELECT id FROM alias_nodes WHERE keyword = ?').bind(keyword).first();
        if (existing) {
            return new Response(JSON.stringify({ success: false, error: '关键字已存在' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }
        await env.DB.prepare('INSERT INTO alias_nodes (keyword, remark) VALUES (?, ?)').bind(keyword, remark).run();
        // 自动创建 DNS CNAME 记录
        ctx.waitUntil(createDnsRecord(keyword, env));
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: '创建失败: ' + e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}

// 更新别名节点（关键字和备注）
async function handleAdminUpdateNode(request, env, nodeId, ctx) {
    try {
        var body = await request.json();
        var sets = [];
        var params = [];
        var oldKeyword = null;
        if (body.keyword !== undefined) {
            var newKeyword = body.keyword.trim();
            if (!newKeyword) {
                return new Response(JSON.stringify({ success: false, error: '关键字不能为空' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
            // 检查新关键字是否已被其他节点使用
            var existing = await env.DB.prepare('SELECT id FROM alias_nodes WHERE keyword = ? AND id != ?').bind(newKeyword, nodeId).first();
            if (existing) {
                return new Response(JSON.stringify({ success: false, error: '关键字已存在' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
            // 获取旧关键字用于DNS更新
            var oldNode = await env.DB.prepare('SELECT keyword FROM alias_nodes WHERE id = ?').bind(nodeId).first();
            oldKeyword = oldNode ? oldNode.keyword : null;
            sets.push('keyword = ?');
            params.push(newKeyword);
        }
        if (body.remark !== undefined) { sets.push('remark = ?'); params.push(body.remark.trim()); }
        if (sets.length === 0) {
            return new Response(JSON.stringify({ success: false, error: '无更新字段' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }
        params.push(nodeId);
        await env.DB.prepare('UPDATE alias_nodes SET ' + sets.join(', ') + ' WHERE id = ?').bind(...params).run();
        // 如果关键字变更，更新DNS记录
        if (oldKeyword && body.keyword && oldKeyword !== body.keyword.trim()) {
            ctx.waitUntil(deleteDnsRecord(oldKeyword, env));
            ctx.waitUntil(createDnsRecord(body.keyword.trim(), env));
        }
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: '更新失败: ' + e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}

// 创建 DNS CNAME 记录（子域名自动映射）
async function createDnsRecord(keyword, env) {
    var apiToken = env.CF_API_TOKEN;
    var zoneId = env.CF_ZONE_ID;
    var baseDomain = env.BASE_DOMAIN;

    addDnsLog('INFO', '开始创建DNS记录', { keyword: keyword, hasToken: !!apiToken, hasZoneId: !!zoneId, baseDomain: baseDomain });

    if (!apiToken) {
        addDnsLog('ERROR', 'CF_API_TOKEN 未配置', null);
        return { success: false, error: 'CF_API_TOKEN 未配置' };
    }
    if (!zoneId) {
        addDnsLog('ERROR', 'CF_ZONE_ID 未配置', null);
        return { success: false, error: 'CF_ZONE_ID 未配置' };
    }
    
    try {
        var fullName = keyword + '.' + baseDomain;
        addDnsLog('INFO', '检查DNS记录是否已存在', { name: fullName });
        
        // 先检查是否已存在
        var checkRes = await fetch('https://api.cloudflare.com/client/v4/zones/' + zoneId + '/dns_records?name=' + encodeURIComponent(fullName), {
            headers: { 'Authorization': 'Bearer ' + apiToken, 'Content-Type': 'application/json' }
        });
        
        addDnsLog('INFO', '检查请求响应', { status: checkRes.status });
        
        var checkData = await checkRes.json();
        if (!checkData.success) {
            addDnsLog('ERROR', '检查记录失败', { error: checkData.errors });
            return { success: false, error: '检查记录失败: ' + JSON.stringify(checkData.errors) };
        }
        
        if (checkData.result && checkData.result.length > 0) {
            addDnsLog('INFO', 'DNS记录已存在，跳过创建', { record: checkData.result[0] });
            return { success: true, message: '记录已存在' };
        }
        
        // 创建 CNAME 记录
        addDnsLog('INFO', '开始创建CNAME记录', { name: keyword, content: 'proxy.' + baseDomain });
        
        var createRes = await fetch('https://api.cloudflare.com/client/v4/zones/' + zoneId + '/dns_records', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + apiToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'CNAME',
                name: keyword,
                content: 'proxy.' + baseDomain,
                proxied: true
            })
        });
        
        addDnsLog('INFO', '创建请求响应', { status: createRes.status });
        
        var createData = await createRes.json();
        if (!createData.success) {
            addDnsLog('ERROR', '创建记录失败', { error: createData.errors });
            return { success: false, error: '创建失败: ' + JSON.stringify(createData.errors) };
        }
        
        addDnsLog('SUCCESS', 'DNS记录创建成功', { record: createData.result });
        return { success: true, message: 'DNS记录创建成功' };
        
    } catch (e) {
        addDnsLog('ERROR', '创建过程异常', { error: e.message, stack: e.stack });
        return { success: false, error: '创建过程异常: ' + e.message };
    }
}

// 删除 DNS CNAME 记录
async function deleteDnsRecord(keyword, env) {
    var apiToken = env.CF_API_TOKEN;
    var zoneId = env.CF_ZONE_ID;
    var baseDomain = env.BASE_DOMAIN;
    if (!apiToken || !zoneId) return;
    try {
        var checkRes = await fetch('https://api.cloudflare.com/client/v4/zones/' + zoneId + '/dns_records?name=' + encodeURIComponent(keyword + '.' + baseDomain), {
            headers: { 'Authorization': 'Bearer ' + apiToken, 'Content-Type': 'application/json' }
        });
        var checkData = await checkRes.json();
        if (checkData.success && checkData.result) {
            for (var i = 0; i < checkData.result.length; i++) {
                var record = checkData.result[i];
                if (record.type === 'CNAME') {
                    await fetch('https://api.cloudflare.com/client/v4/zones/' + zoneId + '/dns_records/' + record.id, {
                        method: 'DELETE',
                        headers: { 'Authorization': 'Bearer ' + apiToken }
                    });
                }
            }
        }
    } catch (e) {
        console.error('DNS记录删除失败:', e);
    }
}

// 删除别名节点（同时删除关联线路和DNS记录）
async function handleAdminDeleteNode(env, nodeId, ctx) {
    try {
        // 获取关键字用于删除DNS
        var node = await env.DB.prepare('SELECT keyword FROM alias_nodes WHERE id = ?').bind(nodeId).first();
        if (node && node.keyword) ctx.waitUntil(deleteDnsRecord(node.keyword, env));
        await env.DB.prepare('DELETE FROM alias_lines WHERE node_id = ?').bind(nodeId).run();
        await env.DB.prepare('DELETE FROM alias_nodes WHERE id = ?').bind(nodeId).run();
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: '删除失败: ' + e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}

// 创建线路
async function handleAdminCreateLine(request, env) {
    try {
        var body = await request.json();
        var nodeId = body.node_id;
        var origin = (body.origin || '').trim();
        var weight = parseInt(body.weight) || 1;
        if (!nodeId || !origin) {
            return new Response(JSON.stringify({ success: false, error: '参数不完整' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }
        await env.DB.prepare('INSERT INTO alias_lines (node_id, origin, weight) VALUES (?, ?, ?)').bind(nodeId, origin, weight).run();
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: '创建失败: ' + e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}

// 更新线路
async function handleAdminUpdateLine(request, env, lineId) {
    try {
        var body = await request.json();
        var sets = [];
        var params = [];
        if (body.origin !== undefined) { sets.push('origin = ?'); params.push(body.origin.trim()); }
        if (body.weight !== undefined) { sets.push('weight = ?'); params.push(parseInt(body.weight) || 1); }
        if (body.enabled !== undefined) { sets.push('enabled = ?'); params.push(body.enabled ? 1 : 0); }
        if (body.healthy !== undefined) { sets.push('healthy = ?'); params.push(body.healthy ? 1 : 0); }
        if (sets.length === 0) {
            return new Response(JSON.stringify({ success: false, error: '无更新字段' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }
        params.push(lineId);
        await env.DB.prepare('UPDATE alias_lines SET ' + sets.join(', ') + ' WHERE id = ?').bind(...params).run();
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: '更新失败: ' + e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}

// 删除线路
async function handleAdminDeleteLine(env, lineId) {
    try {
        await env.DB.prepare('DELETE FROM alias_lines WHERE id = ?').bind(lineId).run();
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: '删除失败: ' + e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}

// 手动健康检测线路
async function handleAdminCheckLine(env, lineId) {
    try {
        var line = await env.DB.prepare('SELECT * FROM alias_lines WHERE id = ?').bind(lineId).first();
        if (!line) {
            return new Response(JSON.stringify({ success: false, error: '线路不存在' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
            });
        }

        // 构建检测URL - 添加超时参数避免长时间等待
        var checkUrl = line.origin;
        if (!checkUrl.endsWith('/')) checkUrl += '/';
        checkUrl += 'System/Info/Public'; // Emby 公开信息接口，不需要认证

        var startTime = Date.now();
        var latency = 0;
        var isHealthy = false;
        var statusCode = 0;
        var errorMsg = '';

        try {
            // 使用 GET 方法而不是 HEAD，因为有些服务器不支持 HEAD
            // 设置超时 10 秒
            var controller = new AbortController();
            var timeoutId = setTimeout(function() { controller.abort(); }, 10000);

            var checkResponse = await fetch(checkUrl, {
                method: 'GET',
                redirect: 'follow',
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            latency = Date.now() - startTime;
            statusCode = checkResponse.status;

            // 2xx 和 3xx 认为是健康的
            isHealthy = checkResponse.status >= 200 && checkResponse.status < 400;

            // 更新数据库
            await env.DB.prepare('UPDATE alias_lines SET healthy = ?, latency = ?, fail_count = ? WHERE id = ?')
                .bind(isHealthy ? 1 : 0, latency, isHealthy ? 0 : line.fail_count + 1, lineId).run();

        } catch (fetchErr) {
            latency = Date.now() - startTime;
            isHealthy = false;
            errorMsg = fetchErr.name === 'AbortError' ? '请求超时' : fetchErr.message;

            // 更新数据库 - 即使失败也记录延迟
            await env.DB.prepare('UPDATE alias_lines SET healthy = 0, latency = ?, fail_count = fail_count + 1 WHERE id = ?')
                .bind(latency, lineId).run();
        }

        return new Response(JSON.stringify({
            success: true,
            data: {
                healthy: isHealthy,
                latency: latency,
                status: statusCode,
                error: errorMsg || undefined
            }
        }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: '检测失败: ' + e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
}

// ===== 新增：别名代理处理（带 failover） =====
// 核心思路：别名系统只做 URL Rewrite，然后调用原始代理逻辑
async function handleAliasProxy(originalRequest, env, ctx, aliasResult) {
    var keyword = aliasResult.keyword;
    var lines = aliasResult.lines;
    var remainingPath = aliasResult.remainingPath;
    var maxRetries = Math.min(lines.length, ALIAS_MAX_RETRIES);
    var triedLineIds = {};

    // 缓存请求体（用于重试时重建请求）
    var bodyCache = null;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(originalRequest.method) >= 0) {
        try {
            bodyCache = await originalRequest.arrayBuffer();
        } catch (e) {
            bodyCache = null;
        }
    }

    for (var attempt = 0; attempt < maxRetries; attempt++) {
        // 过滤掉已尝试过的线路
        var availableLines = lines.filter(function(l) {
            return !triedLineIds[l.id] && l.enabled === 1;
        });
        if (availableLines.length === 0) break;

        // 加权随机选择线路
        var selectedLine = selectLine(availableLines);
        if (!selectedLine) break;

        triedLineIds[selectedLine.id] = true;

        // URL Rewrite: /myemby/Users/xxx -> /https://emby-server.com/Users/xxx
        var origin = selectedLine.origin.replace(/\/+$/, '');
        var rewrittenPath = '/' + origin;
        if (remainingPath) rewrittenPath += '/' + remainingPath;

        // 构建新请求（URL 已 rewrite，底层代理逻辑会按旧格式解析）
        var newUrl = new URL(originalRequest.url);
        newUrl.pathname = rewrittenPath;

        var newRequest = new Request(newUrl.toString(), {
            method: originalRequest.method,
            headers: originalRequest.headers,
            body: bodyCache
        });

        try {
            var startTime = Date.now();
            var response = await executeProxy(newRequest, env, ctx);
            var latency = Date.now() - startTime;

            // 5xx 响应：标记不健康，尝试下一线路
            if (response.status >= 500) {
                ctx.waitUntil(markUnhealthy(env, selectedLine.id));
                continue;
            }

            // 成功：标记健康并更新延迟
            ctx.waitUntil(markHealthy(env, selectedLine.id, latency));
            return response;
        } catch (e) {
            // fetch 异常（timeout/TLS错误/网络错误）：标记不健康，尝试下一线路
            ctx.waitUntil(markUnhealthy(env, selectedLine.id));
            console.error('别名代理线路 ' + selectedLine.origin + ' 失败:', e.message);
            continue;
        }
    }

    // 所有线路都失败
    return new Response('All lines unavailable for alias: ' + keyword, { status: 502 });
}

// ===== 原始代理逻辑（提取为独立函数，逻辑完全未修改） =====
// 这是从原始 fetch handler 中提取的代理核心逻辑
// 别名系统通过 URL Rewrite 后调用此函数，底层代理行为完全一致
async function executeProxy(request, env, ctx) {
    const workerUrl = new URL(request.url);

    // --- 解析目标 URL ---
    let upstreamUrl;
    try {
        let path = workerUrl.pathname.substring(1);

        if (path.startsWith('/')) {
            return new Response('Invalid proxy format. Please use: https://your-worker-domain/your-emby-server:port', { status: 400 });
        }

        if (path === 'Sessions/Playing' || path.startsWith('Sessions/Playing/') || path === 'PlaybackInfo' || path.startsWith('PlaybackInfo/')) {
            return new Response('Invalid proxy format. Please use: https://your-worker-domain/your-emby-server:port', { status: 400 });
        }

        path = path.replace(/^(https?)\/(?!\/)/, '$1://');
        if (!path.startsWith('http')) {
            path = 'https://' + path;
        }
        upstreamUrl = new URL(path);
        upstreamUrl.search = workerUrl.search;

        const hostname = upstreamUrl.hostname;
        if (!hostname || hostname === 'Sessions' || hostname === 'PlaybackInfo') {
            return new Response('Invalid proxy format. Please use: https://your-worker-domain/your-emby-server:port', { status: 400 });
        }

        if (PIKPAK_DOMAINS.some(domain => hostname.endsWith(domain))) {
            const redirectUrl = new URL(upstreamUrl.pathname + upstreamUrl.search, CONFIG.pikpakProxyUrl);
            return Response.redirect(redirectUrl.toString(), 301);
        }

        if (blocker.check(upstreamUrl.toString())) {
            return Response.redirect('https://baidu.com', 301);
        }
    } catch (e) {
      return new Response('Invalid URL format. Please use: https://your-worker-domain/your-emby-server:port', { status: 400 });
    }

    // --- 判断是否需要走美西 ---
    const currentEdgeColo = request.cf?.colo;

    if (currentEdgeColo && JP_COLOS.includes(currentEdgeColo)) {
        const originalHost = upstreamUrl.host;
        for (const domainSuffix in DOMAIN_PROXY_RULES) {
            if (originalHost.endsWith(domainSuffix)) {
                upstreamUrl.hostname = DOMAIN_PROXY_RULES[domainSuffix];
                break;
            }
        }
    }

    // --- 统计逻辑 ---
    if (upstreamUrl.pathname.endsWith('/Sessions/Playing')) {
        ctx.waitUntil(recordStats(env, 'playing'));
    } else if (upstreamUrl.pathname.includes('/PlaybackInfo')) {
        ctx.waitUntil(recordStats(env, 'playback_info'));
    }

    // --- WebSocket ---
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
      return fetch(upstreamUrl.toString(), request);
    }

    // --- 构造请求头和请求体 ---
    const upstreamRequestHeaders = new Headers(request.headers);
    upstreamRequestHeaders.set('Host', upstreamUrl.host);
    upstreamRequestHeaders.delete('Referer');

    const clientIp = request.headers.get('cf-connecting-ip');
    if (clientIp) {
        upstreamRequestHeaders.set('x-forwarded-for', clientIp);
        upstreamRequestHeaders.set('x-real-ip', clientIp);
    }

    let requestBody = request.body;
    if (["POST", "PUT", "PATCH", "DELETE"].indexOf(request.method) >= 0) {
        const ct = (request.headers.get('content-type') || "").toLowerCase();
        if (ct.includes('application/json')) {
            let requestJSON = await request.json();
            requestBody = JSON.stringify(requestJSON);
        } else if (ct.includes('application/text') || ct.includes('text/html')) {
            requestBody = await request.text();
        } else if (ct.includes('form')) {
            requestBody = await request.formData();
        } else {
            requestBody = await request.blob();
        }
    }

    const upstreamRequest = new Request(upstreamUrl.toString(), {
      method: request.method,
      headers: upstreamRequestHeaders,
      body: requestBody,
      redirect: 'manual',
    });

    // --- 发起请求 ---
    const upstreamResponse = await fetch(upstreamRequest);

    // --- 处理重定向 (智能重定向优化) ---
    const location = upstreamResponse.headers.get('Location');
    if (location && upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
      try {
        const redirectUrl = new URL(location, upstreamUrl);

        if (redirectUrl.hostname === upstreamUrl.hostname) {
          return fetch(redirectUrl.toString(), upstreamRequest);
        }

        if (MANUAL_REDIRECT_DOMAINS.some(domain => redirectUrl.hostname.endsWith(domain))) {
          const responseHeaders = new Headers(upstreamResponse.headers);
          responseHeaders.set('Location', redirectUrl.toString());
          return new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: responseHeaders
          });
        }

        const followHeaders = new Headers(upstreamRequestHeaders);
        followHeaders.set('Host', redirectUrl.host);

        return fetch(redirectUrl.toString(), {
            method: request.method,
            headers: followHeaders,
            body: requestBody,
            redirect: 'follow'
        });

      } catch (e) {
        return upstreamResponse;
      }
    }

    // --- 处理常规响应 (缓存策略优化 + 安全头增强) ---
    const responseHeaders = new Headers(upstreamResponse.headers);

    const contentType = upstreamResponse.headers.get('content-type');
    if (contentType && CONFIG.cacheEnabled) {
        if (contentType.includes('image/') || contentType.includes('text/css') ||
            contentType.includes('application/javascript') || contentType.includes('font/')) {
            responseHeaders.set('Cache-Control', 'public, max-age=86400');
        } else if (contentType.includes('video/') || contentType.includes('audio/')) {
            responseHeaders.set('Cache-Control', 'public, max-age=3600');
        } else {
            responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }

    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', '*');

    responseHeaders.set('X-Content-Type-Options', 'nosniff');
    responseHeaders.set('X-Frame-Options', 'DENY');
    responseHeaders.set('X-XSS-Protection', '1; mode=block');
    responseHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');

    responseHeaders.delete('Content-Security-Policy');

    console.log(`[${new Date().toISOString()}] ${request.method} ${upstreamUrl} - ${upstreamResponse.status} - ${request.cf?.colo}`);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
}

// ===== 原始工具函数（未修改） =====
async function recordStats(env, type) {
    try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });

        if (!env.DB) {
            console.error("D1 数据库未绑定，变量名需为 'DB'");
            return;
        }

        let query = "";
        let params = [];

        if (type === 'playing') {
            query = `
                INSERT INTO auto_emby_daily_stats (date, playing_count, playback_info_count)
                VALUES (?, 1, 0)
                ON CONFLICT(date) DO UPDATE SET playing_count = playing_count + 1
            `;
            params = [today];
        } else if (type === 'playback_info') {
            query = `
                INSERT INTO auto_emby_daily_stats (date, playing_count, playback_info_count)
                VALUES (?, 0, 1)
                ON CONFLICT(date) DO UPDATE SET playback_info_count = playback_info_count + 1
            `;
            params = [today];
        }

        if (query) {
            await env.DB.prepare(query).bind(...params).run();
        }

    } catch (e) {
        console.error('统计写入失败:', e);
    }
}

function createErrorResponse(message, status = 500) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleStatsRequest(env) {
    try {
        if (!env.DB) {
            return new Response(JSON.stringify({
                error: "D1 数据库未绑定，变量名需为 'DB'",
                data: null
            }), {
                headers: {
                    'Content-Type': 'application/json; charset=utf-8'
                }
            });
        }

         const statsQuery = `
             SELECT date, playing_count, playback_info_count
             FROM auto_emby_daily_stats
             WHERE date >= date('now', '-30 days')
             ORDER BY date DESC
         `;

         const statsResult = await env.DB.prepare(statsQuery).all();

         const totalQuery = `
             SELECT
                 SUM(playing_count) as total_playing,
                 SUM(playback_info_count) as total_playback_info
             FROM auto_emby_daily_stats
             WHERE date >= date('now', '-30 days')
         `;

         const totalResult = await env.DB.prepare(totalQuery).first();

         const responseData = {
             error: null,
             data: {
                 total: {
                     playing: totalResult?.total_playing || 0,
                     playbackInfo: totalResult?.total_playback_info || 0
                 },
                 dailyStats: statsResult?.results || [],
                 lastUpdated: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
             }
         };

         return new Response(JSON.stringify(responseData), {
             headers: {
                 'Content-Type': 'application/json; charset=utf-8',
                 'Access-Control-Allow-Origin': '*'
             }
         });

     } catch (e) {
         console.error('统计查询失败:', e);
         return new Response(JSON.stringify({
             error: "统计查询失败: " + e.message,
             data: null
         }), {
             status: 500,
             headers: {
                 'Content-Type': 'application/json; charset=utf-8'
             }
         });
     }
 }

// ===== 主入口 =====
export default {
  async fetch(request, env, ctx) {
    // --- 首次请求时自动创建智能选线 DNS 记录 ---
    ctx.waitUntil(ensureSpeedDnsRecords(env));

    const workerUrl = new URL(request.url);

    // --- 子域名自动路由（最高优先级） ---
    var hostname = request.headers.get('host') || workerUrl.hostname;
    hostname = hostname.split(':')[0];
    var hostParts = hostname.split('.');
    var subdomain = hostParts.length >= 3 ? hostParts[0] : '';

    // --- 智能选线内部端点（所有子域名都支持） ---
    if (workerUrl.pathname === '/__speed_ping') {
      return handleSpeedPing();
    }
    if (workerUrl.pathname === '/__speed_report') {
      return handleSpeedReport(request, env);
    }

    // --- proxy.your-domain.com：智能选线入口 ---
    // 用户访问 proxy.your-domain.com/emby.com → 测速或重定向到最优 proxyN
    if (subdomain === 'proxy') {
      // 管理后台
      if (workerUrl.pathname.startsWith('/admin')) {
        return handleAdmin(request, env, workerUrl, ctx);
      }
      // 根路径显示首页
      if (workerUrl.pathname === '/') {
        return new Response(FRONTEND_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
      // 其他静态端点
      if (workerUrl.pathname === '/favicon.ico') {
        return new Response('', { headers: { 'Content-Type': 'image/x-icon' } });
      }
      if (workerUrl.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString(), region: request.cf?.colo }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (workerUrl.pathname === '/stats') {
        return handleStatsRequest(env);
      }

      // 别名快捷入口查询（优先于智能选线和普通代理）
      const aliasResult = await lookupAlias(workerUrl.pathname, env);
      if (aliasResult) {
        return handleAliasProxy(request, env, ctx, aliasResult);
      }

      // 智能选线：/emby.com 或 /emby.com/path
      var targetPath = workerUrl.pathname.substring(1); // 去掉开头的 /
      if (targetPath) {
        return handleSmartRoute(request, env, ctx, targetPath);
      }
    }

    // --- proxy1~proxyN.your-domain.com：实际代理子域名 ---
    // 这些子域名已经 CNAME 到了优选域名，直接走代理逻辑
    var isProxyLine = SPEED_LINES.some(function(l) { return l.subdomain === subdomain; });

    if (isProxyLine) {
      // 管理后台（仅 proxy 主域名）
      // 别名查询
      const aliasResult = await lookupAlias(workerUrl.pathname, env);
      if (aliasResult) {
        return handleAliasProxy(request, env, ctx, aliasResult);
      }
      // 直接走代理
      return executeProxy(request, env, ctx);
    }

    // --- 其他子域名：别名快捷入口（如 myemby.example.com） ---
    if (subdomain && subdomain !== 'www') {
      var aliasCheck = await lookupAlias('/' + subdomain, env);
      if (aliasCheck) {
        var newPath = '/' + subdomain + workerUrl.pathname;
        if (workerUrl.pathname === '/') newPath = '/' + subdomain;
        workerUrl.pathname = newPath;
      }
    }

    // --- 管理后台路由 ---
    if (workerUrl.pathname.startsWith('/admin')) {
      return handleAdmin(request, env, workerUrl, ctx);
    }

    // --- 静态端点 ---
    if (workerUrl.pathname === '/') {
      return new Response(FRONTEND_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    if (workerUrl.pathname === '/favicon.ico') {
      return new Response('', { headers: { 'Content-Type': 'image/x-icon' } });
    }
    if (workerUrl.pathname.startsWith('/cdn-cgi/')) {
      return new Response('Not Found', { status: 404 });
    }
    if (workerUrl.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString(), region: request.cf?.colo }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (workerUrl.pathname === '/stats') {
      return handleStatsRequest(env);
    }

    // --- 别名快捷入口查询 ---
    const aliasResult = await lookupAlias(workerUrl.pathname, env);
    if (aliasResult) {
      return handleAliasProxy(request, env, ctx, aliasResult);
    }

    // --- 原始代理逻辑 ---
    return executeProxy(request, env, ctx);
  },
};
