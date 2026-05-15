# Emby Proxy Worker

一个功能强大的 Cloudflare Worker 反向代理解决方案，专为 Emby 媒体服务器优化，支持智能选线、D1 统计、别名快捷入口和多线路负载均衡。

## ✨ 主要功能

### 🚀 核心代理功能
- **通用反向代理**：支持任意 HTTP/HTTPS 网站的反向代理
- **Emby 优化**：针对 Emby 媒体服务器的特殊优化
- **流式传输**：支持大文件流式传输，不占用 Worker 内存
- **WebSocket 支持**：完整的 WebSocket 代理能力

### 🎯 智能选线系统
- **自动测速**：用户首次访问时自动测试多条优选线路
- **地区缓存**：按用户地区（国家）和运营商（ASN）缓存最优线路
- **智能重定向**：缓存命中时自动 302 重定向到最优线路
- **12 条优选线路**：内置 12 条 Cloudflare 优选域名

### 📊 D1 统计系统
- **播放统计**：记录 `/Sessions/Playing` 播放次数
- **链接统计**：记录 `/PlaybackInfo` 获取链接次数
- **按天统计**：支持查看最近 30 天的统计数据
- **北京时间**：所有统计时间使用北京时间（UTC+8）

### 🎭 别名快捷入口系统
- **URL Rewrite**：支持 `/alias` 格式的快捷访问
- **多线路支持**：每个别名可配置多条后端线路
- **加权随机**：根据权重智能选择线路
- **自动故障转移**：线路故障时自动切换到备用线路
- **健康检测**：支持手动和自动线路健康检测

### 🛠️ 管理后台
- **Web 管理面板**：完整的后台管理界面（`/admin`）
- **别名管理**：创建、编辑、删除别名和线路
- **DNS 自动管理**：创建别名时自动添加 DNS CNAME 记录
- **线路监控**：查看线路健康状态和延迟

## 📁 项目结构

```
emby-proxy-worker/
├── src/
│   └── worker.js          # 主 Worker 脚本
├── docs/
│   ├── DEPLOY.md          # 部署教程
│   ├── CONFIG.md          # 配置说明
│   └── API.md             # API 文档
├── scripts/
│   └── deploy.sh          # 自动部署脚本
├── wrangler.toml          # Wrangler 配置文件
└── README.md              # 项目说明
```

## 🚀 快速开始

### 方式一：手动部署（推荐新手）

详见 [docs/DEPLOY.md](./docs/DEPLOY.md) 中的"手动部署"章节。

### 方式二：全自动部署（推荐开发者）

```bash
# 1. 克隆仓库
git clone https://github.com/yourusername/emby-proxy-worker.git
cd emby-proxy-worker

# 2. 安装依赖
npm install -g wrangler

# 3. 登录 Cloudflare
wrangler login

# 4. 运行自动部署脚本
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

## ⚙️ 环境变量配置

在 Cloudflare Worker 设置中配置以下环境变量：

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `ADMIN_PASSWORD` | 管理后台密码 | ✅ |
| `CF_API_TOKEN` | Cloudflare API Token | ✅（用于自动 DNS 管理） |
| `CF_ZONE_ID` | Cloudflare Zone ID | ✅（用于自动 DNS 管理） |
| `BASE_DOMAIN` | 基础域名，如 `example.com` | ✅ |

## 📖 使用文档

- [部署教程](./docs/DEPLOY.md) - 详细的手动和自动部署步骤
- [配置说明](./docs/CONFIG.md) - 所有配置项的详细说明
- [API 文档](./docs/API.md) - 管理后台 API 接口文档

## 🔧 使用示例

### 基础代理
```
https://proxy.your-domain.com/emby-server.com
https://proxy.your-domain.com/http://emby-server.com
https://proxy.your-domain.com/https://emby-server.com:8096
```

### 智能选线（推荐）
```
https://proxy.your-domain.com/emby-server.com
# 首次访问会自动测速，之后自动使用最优线路
```

### 别名快捷访问
```
https://your-domain.com/mir
# 如果创建了 mir 别名，会自动转发到配置的 Emby 服务器
```

### 管理后台
```
https://proxy.your-domain.com/admin
# 使用 ADMIN_PASSWORD 登录管理后台
```

## 🌟 优选线路列表

智能选线系统内置 12 条 Cloudflare 优选域名：

| 子域名 | 优选域名 | 说明 |
|--------|---------|------|
| proxy1 | cf.090227.xyz | CF优选-090227 |
| proxy2 | cf.877774.xyz | CF优选-877774 |
| proxy3 | cloudflare-dl.byoip.top | 鱼皮优选 |
| proxy4 | saas.sin.fan | MIYU优选 |
| proxy5 | bestcf.030101.xyz | Mingyu优选 |
| proxy6 | cf.cloudflare.182682.xyz | WeTest优选 |
| proxy7 | cf.tencentapp.cn | 腾讯泛域名 |
| proxy8 | www.visa.cn | Visa官方 |
| proxy9 | mfa.gov.ua | 乌克兰外交部 |
| proxy10 | www.shopify.com | Shopify官方 |
| proxy11 | store.ubi.com | 育碧商店 |
| proxy12 | staticdelivery.nexusmods.com | NexusMods |

## 📝 更新日志

### v3.0 (2025-05-15)
- ✅ 新增智能选线系统
- ✅ 新增 D1 统计功能
- ✅ 新增别名快捷入口系统
- ✅ 新增管理后台
- ✅ 新增 DNS 自动管理
- ✅ 优化代码结构，支持环境变量配置

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 💖 致谢

感谢所有开源社区提供的优选域名资源。
