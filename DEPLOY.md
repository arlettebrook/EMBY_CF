# 🚀 部署教程 / Deployment Guide

本文档提供三种部署方式：
- **方式一：手动部署**（适合新手，一步步操作）
- **方式二：本地自动部署**（适合开发者，使用脚本）
- **方式三：GitHub Actions 自动部署**（推荐，代码推送自动部署）

---

## 📋 前置准备 / Prerequisites

在开始部署前，你需要准备以下内容：

### 1. Cloudflare 账号
- 注册地址：https://dash.cloudflare.com/sign-up
- 添加你的域名（Add Site）
- 确保域名 DNS 已切换到 Cloudflare

### 2. 域名准备
- 一个已添加到 Cloudflare 的域名，如 `example.com`
- 确保域名状态为 **Active**（绿色勾）

### 3. 获取 API Token 和 Zone ID

#### 获取 Zone ID
1. 登录 Cloudflare Dashboard
2. 选择你的域名
3. 在右侧 **Overview** 页面找到 **Zone ID**，点击复制

#### 创建 API Token
1. 点击右上角头像 → **My Profile**
2. 左侧菜单选择 **API Tokens**
3. 点击 **Create Token**
4. 选择 **Custom token** 模板
5. 配置权限：
   - **Token name**: `Emby Proxy Worker`
   - **Permissions**:
     - Zone:Read
     - DNS:Edit
   - **Zone Resources**: Include - Specific zone - 你的域名
6. 点击 **Continue to summary** → **Create Token**
7. **立即复制并保存 Token**，关闭后无法再次查看

---

## 🛠️ 方式一：手动部署（推荐新手）

### Step 1: 创建 Worker / Create Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧菜单点击 **Workers & Pages**
3. 点击 **Create application**
4. 选择 **Create Worker**
5. 输入 Worker 名称，如 `emby-proxy`
6. 点击 **Deploy**（先部署默认代码）

### Step 2: 编辑 Worker 代码 / Edit Worker Code

1. 在 Worker 详情页，点击 **Edit code**
2. 删除左侧编辑器中的所有默认代码
3. 复制 `src/worker.js` 的全部内容，粘贴到编辑器中
4. 点击 **Save and deploy**

### Step 3: 绑定 D1 数据库 / Bind D1 Database

1. 在 Worker 详情页，点击 **Settings** 标签
2. 左侧选择 **Variables**
3. 向下滚动到 **D1 Database Bindings**
4. 点击 **Add binding**
5. 配置：
   - **Variable name**: `DB`
   - **D1 database**: 选择 **Create a new D1 database**
   - **Database name**: `emby-proxy-db`
6. 点击 **Create and bind**

### Step 4: 配置环境变量 / Set Environment Variables

1. 在 **Variables** 页面，点击 **Add variable**
2. 添加以下变量：

| Variable name | Value | 说明 |
|--------------|-------|------|
| `ADMIN_PASSWORD` | 你的管理密码 | 管理后台登录密码 |
| `CF_API_TOKEN` | 刚才创建的 API Token | 用于自动 DNS 管理 |
| `CF_ZONE_ID` | 你的 Zone ID | 域名 Zone ID |
| `BASE_DOMAIN` | `example.com` | 你的基础域名 |

3. 点击 **Save**

### Step 5: 配置路由 / Configure Routes

1. 在 Worker 详情页，点击 **Triggers** 标签
2. 向下滚动到 **Routes**
3. 点击 **Add route**
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

5. 每条路由的 **Environment** 选择 **Production**
6. 点击 **Add route**

### Step 6: 创建 DNS 记录 / Create DNS Records

Worker 会在首次请求时自动创建 DNS 记录，但你也可以手动创建：

1. 进入你的域名 **DNS** 页面
2. 添加以下 CNAME 记录：

| Type | Name | Target | Proxy status |
|------|------|--------|--------------|
| CNAME | proxy | your-worker-name.your-subdomain.workers.dev | Proxied |
| CNAME | proxy1 | cf.090227.xyz | Proxied |
| CNAME | proxy2 | cf.877774.xyz | Proxied |
| CNAME | proxy3 | cloudflare-dl.byoip.top | Proxied |
| CNAME | proxy4 | saas.sin.fan | Proxied |
| CNAME | proxy5 | bestcf.030101.xyz | Proxied |
| CNAME | proxy6 | cf.cloudflare.182682.xyz | Proxied |
| CNAME | proxy7 | cf.tencentapp.cn | Proxied |
| CNAME | proxy8 | www.visa.cn | Proxied |
| CNAME | proxy9 | mfa.gov.ua | Proxied |
| CNAME | proxy10 | www.shopify.com | Proxied |
| CNAME | proxy11 | store.ubi.com | Proxied |
| CNAME | proxy12 | staticdelivery.nexusmods.com | Proxied |

**注意**：所有记录的 **Proxy status** 必须是 **Proxied**（橙色云）。

### Step 7: 测试部署 / Test Deployment

1. 访问 `https://proxy.example.com/`
2. 应该看到首页和统计信息
3. 访问 `https://proxy.example.com/admin`
4. 使用 `ADMIN_PASSWORD` 登录管理后台
5. 尝试访问 `https://proxy.example.com/your-emby-server.com`

---

## 🤖 方式二：本地自动部署（推荐开发者）

### Step 1: 安装 Wrangler CLI

```bash
# 使用 npm 安装
npm install -g wrangler

# 或使用 yarn
yarn global add wrangler
```

### Step 2: 登录 Cloudflare

```bash
wrangler login
```

浏览器会打开授权页面，点击 **Allow** 授权。

### Step 3: 克隆项目并配置

```bash
# 克隆仓库
git clone https://github.com/yourusername/emby-proxy-worker.git
cd emby-proxy-worker

# 复制配置文件模板
cp wrangler.toml.example wrangler.toml
```

编辑 `wrangler.toml`：

```toml
name = "emby-proxy"
main = "src/worker.js"
compatibility_date = "2025-05-15"

# 环境变量
[vars]
BASE_DOMAIN = "example.com"  # 修改为你的域名

# 密钥（部署时会提示输入）
[[env.production.vars]]
ADMIN_PASSWORD = ""
CF_API_TOKEN = ""
CF_ZONE_ID = ""

# D1 数据库绑定
[[d1_databases]]
binding = "DB"
database_name = "emby-proxy-db"
database_id = ""  # 部署后自动填充
```

### Step 4: 运行自动部署脚本

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

脚本会执行以下操作：
1. 创建 D1 数据库
2. 部署 Worker
3. 设置环境变量
4. 配置路由
5. 自动创建 DNS 记录

### Step 5: 验证部署

```bash
# 测试首页
curl https://proxy.example.com/

# 测试管理后台
curl https://proxy.example.com/admin

# 测试智能选线
curl -v https://proxy.example.com/your-emby-server.com
```

---

## 🚀 方式三：GitHub Actions 自动部署（推荐）

这种方式最方便，每次推送到 GitHub 都会自动部署到 Cloudflare。

### Step 1: Fork 或创建仓库

1. 在 GitHub 上创建新仓库，如 `emby-proxy-worker`
2. 将代码推送到仓库：

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/emby-proxy-worker.git
git push -u origin main
```

### Step 2: 配置 GitHub Secrets

在 GitHub 仓库中设置 Secrets：

1. 打开仓库页面 → **Settings** → **Secrets and variables** → **Actions**
2. 点击 **New repository secret**，添加以下 secrets：

| Secret Name | 说明 | 获取方式 |
|------------|------|---------|
| `CF_API_TOKEN` | Cloudflare API Token | My Profile → API Tokens → Create Token |
| `CF_ACCOUNT_ID` | Cloudflare Account ID | 右侧边栏 Overview 页面 |
| `CF_ZONE_ID` | Cloudflare Zone ID | 域名 Overview 页面 |
| `ADMIN_PASSWORD` | 管理后台密码 | 自行设置 |
| `BASE_DOMAIN` | 基础域名 | 如 `example.com` |

**获取 Account ID：**
- 登录 Cloudflare Dashboard
- 右侧 Overview 页面找到 **Account ID**

**创建 API Token（需要以下权限）：**
- Account: Cloudflare Workers:Edit
- Zone: Zone:Read, DNS:Edit
- Account: Account Settings:Read

### Step 3: 触发自动部署

每次推送到 `main` 或 `master` 分支时，GitHub Actions 会自动部署：

```bash
# 修改代码后推送
git add .
git commit -m "Update worker"
git push origin main
```

部署状态可以在 GitHub 仓库的 **Actions** 标签页查看。

### Step 4: 配置路由（首次部署后）

GitHub Actions 会自动部署 Worker，但路由需要手动配置一次：

1. 登录 Cloudflare Dashboard
2. 进入 Workers & Pages → 你的 Worker
3. 点击 **Triggers** → **Add route**
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

### Step 5: 配置 DNS（首次部署后）

首次访问时 Worker 会自动创建 DNS 记录，或手动创建：

| Type | Name | Target | Proxy status |
|------|------|--------|--------------|
| CNAME | proxy | your-worker.your-subdomain.workers.dev | Proxied |
| CNAME | proxy1 | cf.090227.xyz | Proxied |
| ... | ... | ... | ... |

---

## 🔧 故障排查 / Troubleshooting

### 问题 1: Worker 返回 404

**原因**: 路由配置不正确

**解决**:
1. 检查 Worker Routes 是否包含 `proxy.example.com/*`
2. 确保 DNS 记录的 Proxy status 是 **Proxied**

### 问题 2: DNS 记录未自动创建

**原因**: API Token 权限不足或环境变量未设置

**解决**:
1. 检查 `CF_API_TOKEN` 是否有 `DNS:Edit` 权限
2. 检查 `CF_ZONE_ID` 是否正确
3. 查看 Worker Logs 中的错误信息

### 问题 3: 智能选线不生效

**原因**: 缓存未命中或测速失败

**解决**:
1. 首次访问会显示测速页面，等待测速完成
2. 检查浏览器控制台是否有报错
3. 查看 `/admin` 中的缓存状态

### 问题 4: D1 数据库报错

**原因**: 数据库绑定不正确

**解决**:
1. 检查 Worker Settings → Variables → D1 Database Bindings
2. 确保 Variable name 是 `DB`
3. 尝试重新绑定数据库

---

## 📝 部署后配置 / Post-Deployment

### 1. 修改默认密码

首次部署后，立即修改 `ADMIN_PASSWORD`：
1. 进入 Worker Settings → Variables
2. 编辑 `ADMIN_PASSWORD`
3. 点击 **Save**

### 2. 创建别名（可选）

访问 `https://proxy.example.com/admin`，创建别名快捷入口：
1. 点击 **添加别名组**
2. 输入关键字（如 `mir`）
3. 添加线路（Emby 服务器地址）
4. 保存后可通过 `https://mir.example.com` 访问

### 3. 监控统计

访问 `https://proxy.example.com/stats` 查看：
- 总播放次数
- 总获取链接次数
- 最近 10 天每日统计

---

## 🎉 恭喜！

你的 Emby Proxy Worker 已经部署完成！

**下一步**:
- 阅读 [CONFIG.md](./CONFIG.md) 了解详细配置
- 阅读 [API.md](./API.md) 了解 API 接口
- 在 GitHub 上 Star 本项目 ⭐