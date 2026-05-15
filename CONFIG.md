# ⚙️ 配置说明 / Configuration Guide

本文档详细介绍 Emby Proxy Worker 的所有配置项。

---

## 🔐 环境变量 / Environment Variables

在 Cloudflare Worker Settings → Variables 中配置以下变量：

### 必需变量 / Required Variables

| 变量名 | 类型 | 说明 | 示例 |
|--------|------|------|------|
| `ADMIN_PASSWORD` | 文本 | 管理后台登录密码 | `your-secure-password` |
| `CF_API_TOKEN` | 密钥 | Cloudflare API Token | `your-api-token` |
| `CF_ZONE_ID` | 文本 | Cloudflare Zone ID | `your-zone-id` |
| `BASE_DOMAIN` | 文本 | 基础域名 | `example.com` |

### 变量详细说明

#### ADMIN_PASSWORD
- **用途**: 登录管理后台 `/admin`
- **安全建议**: 使用强密码，至少 12 位，包含大小写字母、数字和特殊字符
- **修改方法**: 在 Worker Settings → Variables 中修改

#### CF_API_TOKEN
- **用途**: 自动管理 DNS 记录
- **创建方法**: 
  1. Cloudflare Dashboard → My Profile → API Tokens
  2. Create Token → Custom token
  3. Permissions: Zone:Read, DNS:Edit
  4. Zone Resources: Include - Specific zone - 你的域名
- **安全提示**: Token 只显示一次，请妥善保存

#### CF_ZONE_ID
- **用途**: 标识你的 Cloudflare 域名
- **获取方法**: 
  1. Cloudflare Dashboard → 选择域名
  2. Overview 页面右侧找到 Zone ID

#### BASE_DOMAIN
- **用途**: 基础域名，用于构建子域名
- **格式**: 不需要 `https://` 前缀，直接写域名
- **示例**: `example.com`

---

## 📁 代码中的配置 / Code Configuration

### 优选线路配置 / Speed Lines Configuration

在 `src/worker.js` 中，你可以修改 `SPEED_LINES` 数组来自定义优选线路：

```javascript
const SPEED_LINES = [
    { subdomain: 'proxy1', domain: 'cf.090227.xyz',       name: 'CF优选-090227' },
    { subdomain: 'proxy2', domain: 'cf.877774.xyz',        name: 'CF优选-877774' },
    // ... 更多线路
];
```

| 字段 | 说明 |
|------|------|
| `subdomain` | 子域名前缀，如 `proxy1` |
| `domain` | 优选域名，CNAME 目标 |
| `name` | 显示名称，用于测速页面 |

### 缓存时间配置 / Cache Configuration

```javascript
const SPEED_CACHE_TTL = 3600;  // 智能选线缓存时间（秒）
```

- 默认 3600 秒（1 小时）
- 同地区同运营商用户共享缓存结果
- 修改后需重新部署 Worker

### PikPak 代理配置 / PikPak Proxy

```javascript
const CONFIG = {
    pikpakProxyUrl: 'https://your-pikpak-proxy.com',
    // ...
};
```

如果你有 PikPak 代理服务器，可以修改此配置。

---

## 🗄️ D1 数据库表结构 / Database Schema

Worker 会自动创建以下数据表：

### 1. emby_stats - 统计表
```sql
CREATE TABLE emby_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE,           -- 日期 (YYYY-MM-DD)
    playing_count INTEGER,      -- 播放次数
    playback_info_count INTEGER -- 获取链接次数
);
```

### 2. alias_nodes - 别名节点表
```sql
CREATE TABLE alias_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT UNIQUE,        -- 别名关键字
    remark TEXT,                -- 备注
    created_at DATETIME
);
```

### 3. alias_lines - 别名线路表
```sql
CREATE TABLE alias_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER,            -- 关联 alias_nodes.id
    origin TEXT,                -- 线路地址
    weight INTEGER DEFAULT 1,   -- 权重
    enabled INTEGER DEFAULT 1,  -- 是否启用
    healthy INTEGER DEFAULT 1,  -- 是否健康
    latency INTEGER DEFAULT 0,  -- 延迟(ms)
    fail_count INTEGER DEFAULT 0 -- 失败次数
);
```

### 4. speed_region_cache - 智能选线缓存表
```sql
CREATE TABLE speed_region_cache (
    region_code TEXT,           -- 国家代码
    asn TEXT,                   -- 运营商 ASN
    best_subdomain TEXT,        -- 最优子域名
    latency INTEGER,            -- 延迟
    tested_at DATETIME,         -- 测试时间
    expires_at DATETIME,        -- 过期时间
    PRIMARY KEY (region_code, asn)
);
```

---

## 🌐 路由配置 / Routes Configuration

### 必需的路由 / Required Routes

在 Worker Triggers → Routes 中添加：

```
proxy.example.com/*
*.proxy.example.com/*
```

### 智能选线路由 / Speed Test Routes

为每条优选线路添加路由：

```
proxy1.example.com/*
proxy2.example.com/*
proxy3.example.com/*
proxy4.example.com/*
proxy5.example.com/*
proxy6.example.com/*
proxy7.example.com/*
proxy8.example.com/*
proxy9.example.com/*
proxy10.example.com/*
proxy11.example.com/*
proxy12.example.com/*
```

**注意**: 将 `example.com` 替换为你的实际域名。

---

## 🔧 高级配置 / Advanced Configuration

### 自定义域名转发规则

在 `src/worker.js` 中修改 `DOMAIN_PROXY_RULES`：

```javascript
const DOMAIN_PROXY_RULES = {
    'your-domain.com': 'target-domain.com',
    'old-server.com': 'new-server.com',
};
```

### 手动重定向域名

在 `MANUAL_REDIRECT_DOMAINS` 数组中添加需要特殊处理的域名：

```javascript
const MANUAL_REDIRECT_DOMAINS = [
    'aliyundrive.com',
    'xunlei.com',
    // 添加你的域名
];
```

### 日本节点配置

```javascript
const JP_COLOS = ['NRT', 'KIX', 'FUK', 'OKA'];
```

这些 Cloudflare 数据中心位于日本，会触发特殊的流量规则。

---

## 📝 配置示例 / Configuration Examples

### 示例 1: 基础配置

```toml
# wrangler.toml
name = "emby-proxy"
main = "src/worker.js"
compatibility_date = "2025-05-15"

[vars]
BASE_DOMAIN = "mydomain.com"

[[d1_databases]]
binding = "DB"
database_name = "emby-proxy-db"
```

环境变量：
- `ADMIN_PASSWORD`: `MySecurePass123!`
- `CF_API_TOKEN`: `your-token-here`
- `CF_ZONE_ID`: `your-zone-id-here`
- `BASE_DOMAIN`: `mydomain.com`

### 示例 2: 自定义优选线路

修改 `src/worker.js`：

```javascript
const SPEED_LINES = [
    { subdomain: 'cf1', domain: 'cf.090227.xyz', name: '线路1' },
    { subdomain: 'cf2', domain: 'cf.877774.xyz', name: '线路2' },
    // 只保留两条线路
];
```

对应的路由：
```
cf1.mydomain.com/*
cf2.mydomain.com/*
```

---

## ❓ 常见问题 / FAQ

### Q: 如何修改缓存时间？
**A**: 修改 `SPEED_CACHE_TTL` 常量（单位：秒），然后重新部署。

### Q: 如何禁用智能选线？
**A**: 直接访问 `proxyN.example.com/emby.com`，跳过测速流程。

### Q: 如何查看当前配置？
**A**: 访问 `/admin` 管理后台，在设置页面查看。

### Q: 配置修改后需要重新部署吗？
**A**: 
- 环境变量修改：不需要重新部署，立即生效
- 代码中的配置修改：需要重新部署 Worker

---

## 📚 相关文档

- [部署教程](./DEPLOY.md) - 详细的部署步骤
- [API 文档](./API.md) - 管理后台 API 接口
