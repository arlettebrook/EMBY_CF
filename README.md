# Emby Proxy Worker

一个功能强大的 Cloudflare Worker 反向代理解决方案，专为 Emby 媒体服务器优化，支持智能选线、D1 统计、别名快捷入口和多线路负载均衡。

---

# 🚀 快速开始

## 📖 部署教程

**我们提供两种部署方式，请选择适合你的方式：**

### 方式一：手动部署（适合新手）
👉 **[查看详细手动部署教程](./DEPLOY.md#方式一手动部署推荐新手)**

### 方式二：GitHub Actions 自动部署（适合开发者）
👉 **[查看详细自动部署教程](./DEPLOY.md#方式二github-actions-自动部署推荐)**

---

## ⚠️ 重要提示

**首次部署必须完成数据库初始化，否则统计功能会报错！**

```bash
# 初始化数据库命令
wrangler d1 execute emby-proxy-db --file=./init-db.sql
```

---

## ✨ 主要功能

### 🎯 智能选线系统
- **自动测速**：用户首次访问时自动测试多条优选线路
- **地区缓存**：按用户地区（国家）和运营商（ASN）缓存最优线路
- **智能重定向**：缓存命中时自动 302 重定向到最优线路

### 📊 D1 统计系统
- **播放统计**：记录播放次数
- **链接统计**：记录获取链接次数
- **按天统计**：支持查看最近 30 天的统计数据

### 🎭 别名快捷入口系统
- **URL Rewrite**：支持 `/alias` 格式的快捷访问
- **多线路支持**：每个别名可配置多条后端线路
- **自动故障转移**：线路故障时自动切换

### 🛠️ 管理后台
- **Web 管理面板**：完整的后台管理界面（`/admin`）
- **DNS 自动管理**：创建别名时自动添加 DNS 记录

---

## 📁 项目文件

```
emby-proxy-worker/
├── worker.js          # 主 Worker 脚本
├── init-db.sql        # 数据库初始化脚本
├── wrangler.toml      # Wrangler 配置文件
├── DEPLOY.md          # 详细部署教程
├── .github/
│   └── workflows/
│       └── deploy.yml # GitHub Actions 自动部署
└── .gitignore         # Git 忽略文件
```

---

## 🔧 使用示例

### 基础代理
```
https://proxy.your-domain.com/emby-server.com
```

### 智能选线（推荐）
```
https://proxy.your-domain.com/emby-server.com
# 首次访问自动测速，之后自动使用最优线路
```

### 管理后台
```
https://proxy.your-domain.com/admin
```

---

## 📚 文档

- **[部署教程](./DEPLOY.md)** - 详细的手动和自动部署步骤

---

## 📝 更新日志

### v3.0 (2025-05-15)
- ✅ 新增智能选线系统
- ✅ 新增 D1 统计功能
- ✅ 新增别名快捷入口系统
- ✅ 新增管理后台
- ✅ 新增 DNS 自动管理

---

## 📄 许可证

MIT License
