# 🚀 部署教程

> ⚠️ **重要提示**：首次部署必须完成数据库初始化，否则统计功能会报错！

---

## 📋 准备工作

### 1. 注册 Cloudflare 账号

- 访问 https://dash.cloudflare.com/sign-up
- 使用邮箱注册并验证

### 2. 添加域名到 Cloudflare

1. 登录后点击 **添加站点（Add Site）**
2. 输入你的域名，如 `example.com`
3. 选择 **免费套餐（Free）**
4. 按照提示修改域名 DNS 服务器到 Cloudflare
5. 等待域名状态变为 **有效（Active）**（绿色勾）

### 3. 获取必要信息

#### 获取 Zone ID

1. 在 Cloudflare Dashboard 选择你的域名
2. 在右侧 **概览（Overview）** 页面
3. 找到 **Zone ID**，点击复制按钮

#### 创建 API Token

1. 点击右上角头像 → **我的个人资料（My Profile）**
2. 左侧菜单选择 **API 令牌（API Tokens）**
3. 点击 **创建令牌（Create Token）**
4. 选择 **自定义令牌（Custom token）**
5. 填写配置：
   - **令牌名称（Token name）**：`Emby Proxy Worker`
   - **权限（Permissions）**：
     - 区域（Zone）- 读取（Read）
     - 区域（Zone）- DNS（Edit）
   - **区域资源（Zone Resources）**：包括（Include）- 特定区域（Specific zone）- 你的域名
6. 点击 **继续以摘要（Continue to summary）** → **创建令牌（Create Token）**
7. **立即复制并保存令牌**，关闭页面后无法再次查看

---

## 方式一：手动部署（推荐新手）

### 第一步：创建 Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧菜单点击 **Workers 和 Pages（Workers & Pages）**
3. 点击 **创建应用程序（Create application）**
4. 选择 **创建 Worker（Create Worker）**
5. 输入 Worker 名称，如 `emby-proxy`
6. 点击 **部署（Deploy）**（先部署默认代码）

### 第二步：编辑 Worker 代码

1. 在 Worker 详情页，点击 **编辑代码（Edit code）**
2. 删除左侧编辑器中的所有默认代码
3. 复制本项目的 `worker.js` 全部内容
4. 粘贴到编辑器中
5. 点击 **保存并部署（Save and deploy）**

### 第三步：绑定 D1 数据库

1. 在 Worker 详情页，点击 **设置（Settings）** 标签
2. 左侧选择 **变量（Variables）**
3. 向下滚动到 **D1 数据库绑定（D1 Database Bindings）**
4. 点击 **添加绑定（Add binding）**
5. 配置：
   - **变量名称（Variable name）**：`DB`
   - **D1 数据库（D1 database）**：选择 **创建新的 D1 数据库（Create a new D1 database）**
   - **数据库名称（Database name）**：`emby-proxy-db`
6. 点击 **创建并绑定（Create and bind）**

### 第四步：初始化数据库（⚠️ 重要）

**必须执行此步骤，否则统计功能会报错！**

#### 方法 A：使用 Wrangler CLI（推荐）

```bash
# 1. 安装 Wrangler
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 执行初始化
wrangler d1 execute emby-proxy-db --file=./init-db.sql
```

#### 方法 B：在 Dashboard 中手动执行

1. 登录 Cloudflare Dashboard
2. 左侧菜单点击 **Workers 和 Pages（Workers & Pages）**
3. 点击 **D1 SQL 数据库（D1 SQL Databases）**
4. 在 **你的存储库（Your storage）** 列表中，点击 `emby-proxy-db`
5. 点击 **控制台（Console）** 标签
6. 在控制台输入框中，粘贴以下 SQL 语句（完整内容来自本项目的 `init-db.sql` 文件）：

```sql
CREATE TABLE IF NOT EXISTS emby_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    playing_count INTEGER DEFAULT 0,
    playback_info_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS alias_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT UNIQUE NOT NULL,
    remark TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alias_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL,
    origin TEXT NOT NULL,
    weight INTEGER DEFAULT 1,
    enabled INTEGER DEFAULT 1,
    healthy INTEGER DEFAULT 1,
    latency INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (node_id) REFERENCES alias_nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS speed_region_cache (
    region_code TEXT NOT NULL,
    asn TEXT NOT NULL,
    best_subdomain TEXT NOT NULL,
    latency INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    PRIMARY KEY (region_code, asn)
);

CREATE TABLE IF NOT EXISTS speed_test_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region_code TEXT,
    asn TEXT,
    domain TEXT,
    latency INTEGER,
    tested_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dns_operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation TEXT,
    domain TEXT,
    status TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

7. 点击 **执行（Execute）** 按钮
8. 如果成功，会显示类似 `成功创建 6 个表` 的提示

**验证初始化成功**：
- 访问 `https://proxy.你的域名.com/stats`
- 应该看到 "暂无统计数据" 而不是报错

### 第五步：配置环境变量

1. 在 **变量（Variables）** 页面，点击 **添加变量（Add variable）**
2. 添加以下变量：

| 变量名称 | 值 | 说明 |
|---------|-----|------|
| `ADMIN_PASSWORD` | 你的管理密码 | 管理后台登录密码 |
| `CF_API_TOKEN` | 刚才创建的 API Token | 用于自动 DNS 管理 |
| `CF_ZONE_ID` | 你的 Zone ID | 域名 Zone ID |
| `BASE_DOMAIN` | `example.com` | 你的基础域名 |

3. 点击 **保存（Save）**

### 第六步：配置路由

1. 在 Worker 详情页，点击 **触发器（Triggers）** 标签
2. 向下滚动到 **路由（Routes）**
3. 点击 **添加路由（Add route）**
4. 添加以下路由（将 `example.com` 替换为你的域名）：

```
proxy.example.com/*
*.proxy.example.com/*
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

5. 每条路由的 **环境（Environment）** 选择 **生产环境（Production）**
6. 点击 **添加路由（Add route）**

### 第七步：创建 DNS 记录

Worker 会在首次请求时自动创建 DNS 记录，但你也可以手动创建：

1. 进入你的域名 **DNS** 页面
2. 点击 **添加记录（Add record）**
3. 添加以下 CNAME 记录：

| 类型 | 名称 | 目标 | 代理状态 |
|------|------|------|----------|
| CNAME | proxy | emby-proxy.你的子域名.workers.dev | 已代理（Proxied） |
| CNAME | proxy1 | cf.090227.xyz | 已代理（Proxied） |
| CNAME | proxy2 | cf.877774.xyz | 已代理（Proxied） |
| CNAME | proxy3 | cloudflare-dl.byoip.top | 已代理（Proxied） |
| CNAME | proxy4 | saas.sin.fan | 已代理（Proxied） |
| CNAME | proxy5 | bestcf.030101.xyz | 已代理（Proxied） |
| CNAME | proxy6 | cf.cloudflare.182682.xyz | 已代理（Proxied） |
| CNAME | proxy7 | cf.tencentapp.cn | 已代理（Proxied） |
| CNAME | proxy8 | www.visa.cn | 已代理（Proxied） |
| CNAME | proxy9 | mfa.gov.ua | 已代理（Proxied） |
| CNAME | proxy10 | www.shopify.com | 已代理（Proxied） |
| CNAME | proxy11 | store.ubi.com | 已代理（Proxied） |
| CNAME | proxy12 | staticdelivery.nexusmods.com | 已代理（Proxied） |

**注意**：所有记录的 **代理状态（Proxy status）** 必须是 **已代理（Proxied）**（橙色云图标）。

### 第八步：测试部署

1. 访问 `https://proxy.你的域名.com/`
2. 应该看到首页和统计信息
3. 访问 `https://proxy.你的域名.com/admin`
4. 使用 `ADMIN_PASSWORD` 登录管理后台
5. 尝试访问 `https://proxy.你的域名.com/你的-emby-服务器.com`

---

## 方式二：GitHub Actions 自动部署（推荐）

### 第一步：创建 GitHub 仓库

1. 在 GitHub 上创建新仓库，如 `emby-proxy-worker`
2. 将代码推送到仓库：

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/你的用户名/emby-proxy-worker.git
git push -u origin main
```

### 第二步：配置 GitHub Secrets

在 GitHub 仓库中设置 Secrets：

1. 打开仓库页面 → **设置（Settings）** → **Secrets and variables** → **Actions**
2. 点击 **New repository secret**，添加以下 secrets：

| Secret Name | 说明 | 获取方式 |
|------------|------|---------|
| `CF_API_TOKEN` | Cloudflare API Token | 我的个人资料 → API 令牌 |
| `CF_ACCOUNT_ID` | Cloudflare Account ID | 右侧边栏概览页面 |
| `CF_ZONE_ID` | Cloudflare Zone ID | 域名概览页面 |
| `ADMIN_PASSWORD` | 管理后台密码 | 自行设置 |
| `BASE_DOMAIN` | 基础域名 | 如 `example.com` |

**获取 Account ID**：
- 登录 Cloudflare Dashboard
- 右侧 **概览（Overview）** 页面找到 **Account ID**

**创建 API Token（需要以下权限）**：
- 账户（Account）- Cloudflare Workers - 编辑（Edit）
- 区域（Zone）- 区域（Zone）- 读取（Read）
- 区域（Zone）- DNS - 编辑（Edit）
- 账户（Account）- 账户设置（Account Settings）- 读取（Read）

### 第三步：触发自动部署

每次推送到 `main` 或 `master` 分支时，GitHub Actions 会自动部署：

```bash
# 修改代码后推送
git add .
git commit -m "Update worker"
git push origin main
```

部署状态可以在 GitHub 仓库的 **Actions** 标签页查看。

### 第四步：初始化数据库（⚠️ 重要）

GitHub Actions 会自动部署 Worker，但不会自动创建数据库表。需要手动初始化：

#### 方法 A：使用 Wrangler CLI

```bash
# 1. 登录 Cloudflare
wrangler login

# 2. 执行初始化
wrangler d1 execute emby-proxy-db --file=./init-db.sql
```

#### 方法 B：在 Dashboard 中执行

1. 登录 Cloudflare Dashboard
2. 左侧菜单点击 **Workers 和 Pages（Workers & Pages）**
3. 点击 **D1 SQL 数据库（D1 SQL Databases）**
4. 在 **你的存储库（Your storage）** 列表中，点击 `emby-proxy-db`
5. 点击 **控制台（Console）** 标签
6. 将 `init-db.sql` 文件中的 SQL 语句粘贴到输入框中
7. 点击 **执行（Execute）** 按钮

> 💡 也可以参考手动部署教程中"第四步"的完整 SQL 内容。

### 第五步：配置路由

1. 登录 Cloudflare Dashboard
2. 进入 **Workers 和 Pages（Workers & Pages）** → 你的 Worker
3. 点击 **触发器（Triggers）** → **添加路由（Add route）**
4. 添加以下路由（将 `example.com` 替换为你的域名）：

```
proxy.example.com/*
*.proxy.example.com/*
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

### 第六步：配置 DNS

首次访问时 Worker 会自动创建 DNS 记录，或参考手动部署的第七步手动创建。

---

## 🔧 常见问题

### 问题 1: Worker 返回 404

**原因**: 路由配置不正确

**解决**:
1. 检查 Worker 路由是否包含 `proxy.example.com/*`
2. 确保 DNS 记录的代理状态是 **已代理（Proxied）**

### 问题 2: 统计查询失败 / "统计查询失败，请稍后重试"

**原因**: 数据库表未初始化

**解决**:
```bash
wrangler d1 execute emby-proxy-db --file=./init-db.sql
```

### 问题 3: DNS 记录未自动创建

**原因**: API Token 权限不足或环境变量未设置

**解决**:
1. 检查 `CF_API_TOKEN` 是否有 `DNS:Edit` 权限
2. 检查 `CF_ZONE_ID` 是否正确
3. 查看 Worker 日志中的错误信息

### 问题 4: 智能选线不生效

**原因**: 缓存未命中或测速失败

**解决**:
1. 首次访问会显示测速页面，等待测速完成
2. 检查浏览器控制台是否有报错
3. 查看 `/admin` 中的缓存状态

---

## 🎉 部署完成！

**访问地址**：
- 首页：`https://proxy.你的域名.com/`
- 管理后台：`https://proxy.你的域名.com/admin`
- 统计页面：`https://proxy.你的域名.com/stats`

**提示**：首次访问管理后台时，请使用部署时设置的密码登录。
