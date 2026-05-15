> [!NOTE]
> 这是一份为**完全零基础**的新手准备的超详细部署教程。请像完成任务清单一样，一步一步跟着操作！

# 🚀 Emby 代理服务 部署教程（2026 新版）

---

## 📋 任务清单（准备工作）

在开始之前，我们需要准备好以下两样东西：
- [ ] **一个 Cloudflare 账号**（免费注册，用于运行我们的代码）
- [ ] **一个你自己的域名**（需要将域名的 DNS 服务器托管到 Cloudflare）

---

## 第一步：注册 Cloudflare 账号

Cloudflare 是一个全球知名的免费 CDN 和代码托管平台，我们的代理服务就运行在它上面。

1. 打开浏览器，访问注册页面：<https://dash.cloudflare.com/sign-up>
2. 输入你的**邮箱（Email）**和**密码（Password）**。
3. 点击 **注册（Create Account）**。
4. 登录你的邮箱，找到 Cloudflare 发来的验证邮件，点击链接完成验证。

---

## 第二步：添加域名到 Cloudflare

你需要把自己的域名交给 Cloudflare 管理，这样才能给代理服务分配网址。

1. 登录 **Cloudflare 控制台（Dashboard）**。
2. 在左侧菜单点击 **添加站点（Add Site）**。
3. 输入你的域名（例如：`example.com`），然后点击继续。
4. 页面会让你选择套餐，请把网页往下拉，选择 **免费（Free）** 套餐，然后点击 **继续（Continue）**。
5. Cloudflare 会扫描你现有的 DNS 记录，直接点击 **继续（Continue）**。
6. **最重要的一步：** 页面会显示两条 Cloudflare 提供的 **名称服务器（Nameservers，简称 NS）**（通常长这样：`xxx.ns.cloudflare.com`）。
7. 登录你购买域名的网站（比如阿里云、腾讯云、Namesilo 等）的后台，找到“修改 DNS 服务器”的地方，把原来的 NS 替换成 Cloudflare 提供的这两条。
8. 替换完成后，回到 Cloudflare 页面，点击 **完成，检查名称服务器（Done, check nameservers）**。
9. 等待生效（通常需要几分钟到几个小时，Cloudflare 会发邮件通知你生效成功）。

---

## 第三步：获取必要信息（Zone ID 和 API Token）

我们需要获取两个“秘钥”，以便后续让代码自动管理我们的域名。

### 1. 获取 区域 ID（Zone ID）
1. 在 Cloudflare 控制台，点击你刚刚添加成功的**域名**。
2. 在右侧的 **概览（Overview）** 页面，往下滚动，找到 **区域 ID（Zone ID）**。
3. 点击旁边的 **复制（Copy）** 按钮，把它保存到电脑的记事本里。

### 2. 获取 账户 ID（Account ID）
1. 在同一个 **概览（Overview）** 页面，往上看一点。
2. 找到 **账户 ID（Account ID）**，同样点击 **复制（Copy）** 并保存到记事本里。

### 3. 创建 API 令牌（API Token）
1. 点击右上角的**用户头像**，在下拉菜单中点击 **我的个人资料（My Profile）**。
2. 在左侧菜单点击 **API 令牌（API Tokens）**。
3. 点击蓝色的 **创建令牌（Create Token）** 按钮。
4. 拉到最下方，找到“自定义令牌（Custom token）”，点击右侧的 **开始使用（Get started）**。
5. **令牌名称（Token name）**：随便填，比如 `emby-proxy-token`。
6. **权限（Permissions）** 部分，需要添加以下 **4** 个权限（点击“添加更多（Add more）”来增加行）：
   - 选择 **账户（Account）** -> **Cloudflare Workers** -> 选择 **编辑（Edit）**
   - 选择 **账户（Account）** -> **D1** -> 选择 **编辑（Edit）**
   - 选择 **区域（Zone）** -> **区域（Zone）** -> 选择 **读取（Read）**
   - 选择 **区域（Zone）** -> **DNS** -> 选择 **编辑（Edit）**
7. **区域资源（Zone Resources）** 部分，设置如下：
   - 选择 **包括（Include）** -> 选择 **特定区域（Specific zone）** -> **选择你的域名**
8. 点击页面底部的 **继续以显示摘要（Continue to summary）**。
9. 点击 **创建令牌（Create Token）**。
10. **重要：** 页面会显示一串很长的字符，这就是你的 API Token。**立刻复制并保存到记事本**（离开页面后就再也看不到了）。

---

## 第四步：部署代理服务（两种方式任选其一）

我们推荐使用**方式一（手动部署）**，更加直观。如果你熟悉 GitHub，也可以选择方式二。

### 方式一：在网页上手动部署（推荐小白）

#### 1. 创建 Worker（运行代码的容器）
1. 回到 Cloudflare 主页，在左侧菜单点击 **计算（Compute）** -> **Workers 和 Pages（Workers & Pages）**。
2. 点击蓝色的 **创建（Create）** 按钮。
3. 选择 **创建 Worker（Create Worker）**。
4. 给它起个名字，比如 `emby-proxy`。
5. 点击右下角的 **部署（Deploy）**。

#### 2. 贴入代码
1. 部署完成后，点击 **编辑代码（Edit code）** 按钮。
2. 页面左侧会有一个代码编辑区。把里面的默认代码**全部删除**。
3. 打开我们项目里的 `worker.js` 文件，复制里面**所有的内容**。
4. 粘贴到刚刚清空的 Cloudflare 代码编辑区里。
5. 点击右上角的 **保存并部署（Save and deploy）**。

#### 3. 创建 D1 数据库（用于存储统计和设置）
1. 点击左上角的返回箭头，回到 Cloudflare 的主菜单。
2. 在左侧菜单点击 **存储和数据库（Storage & Databases）** -> **D1 SQL 数据库（D1 SQL Database）**。
3. 点击 **创建数据库（Create database）**。
4. 数据库名称填入：`emby-proxy-db`。
5. 点击 **创建（Create）**。
*(注：你不需要手动执行 SQL 建表代码了，我们的程序会在你第一次访问时**自动完成初始化**！)*

#### 4. 绑定数据库到 Worker
1. 在左侧菜单回到 **计算（Compute）** -> **Workers 和 Pages（Workers & Pages）**，点击你刚才创建的 `emby-proxy`。
2. 点击顶部的 **设置（Settings）** 选项卡。
3. 在左侧子菜单选择 **绑定（Bindings）**。
4. 点击右侧的 **添加绑定（Add binding）** 按钮。
5. **绑定类型（Binding type）** 选择 **D1 数据库（D1 database）**。
6. **变量名称（Variable name）** 填入：`DB`（**必须是大写字母 D 和 B**）。
7. **D1 数据库（D1 database）** 选择你刚才创建的 `emby-proxy-db`。
8. 点击 **保存（Save）**。

#### 5. 配置环境变量（机密信息）
1. 在同一个 **设置（Settings）** 页面下，点击左侧的 **变量和机密（Variables and Secrets）**。
2. 点击 **添加（Add）** 按钮，依次添加以下 4 个变量（注意大小写，**必须一模一样**）：

| 变量名称（Variable name） | 你的填入值（Value） | 是否加密（Encrypt） |
| :--- | :--- | :--- |
| `ADMIN_PASSWORD` | 你自己编一个后台登录密码（比如 `123456`） | 点击“加密（Encrypt）” |
| `CF_API_TOKEN` | 刚才在记事本里保存的 **API Token** | 点击“加密（Encrypt）” |
| `CF_ZONE_ID` | 刚才在记事本里保存的 **区域 ID（Zone ID）** | 可以不加密 |
| `BASE_DOMAIN` | 你的域名（比如 `example.com`） | 可以不加密 |

3. 添加完成后，点击底部的 **保存并部署（Save and deploy）**。

#### 6. 绑定你自己的网址（自定义域）
1. 在 **设置（Settings）** 页面下，点击左侧的 **域和路由（Domains & Routes）**。
2. 点击右侧的 **添加自定义域（Add Custom Domain）** 按钮。
3. 填入你想要的网址，比如 `proxy.你的域名.com`（例如：`proxy.example.com`）。
4. 点击 **添加自定义域（Add Custom Domain）**。Cloudflare 会自动帮你配置好 DNS 解析。

#### 7. 开启 Node.js 兼容性（非常重要）
1. 在 **设置（Settings）** 页面下，点击左侧的 **兼容性（Compatibility）**。
2. 找到 **兼容性标志（Compatibility flags）**，点击 **添加兼容性标志（Add compatibility flag）**。
3. 输入并选择 `nodejs_compat`。
4. 点击底部的 **保存并部署（Save and deploy）**。

#### 8. 关闭机器人攻击模式（防止 Emby 播放报错）
1. 回到 Cloudflare 主页，点击你的域名。
2. 在左侧菜单点击 **安全性（Security）** -> **机器人（Bots）**。
3. 找到 **机器人攻击模式（Bot Fight Mode）**，把它右侧的开关**关闭（Off）**。

---

### 方式二：使用 GitHub Actions 自动部署（适合进阶用户）

如果你不想在网页上点来点去，可以直接把这个仓库 Fork 到你自己的 GitHub。

1. 在你的 GitHub 仓库页面，点击顶部的 **设置（Settings）**。
2. 在左侧菜单展开 **安全项（Secrets and variables）** -> 点击 **动作（Actions）**。
3. 点击 **新建存储库机密（New repository secret）**，依次添加以下 5 个机密：
   - `CF_API_TOKEN`：你的 Cloudflare API Token
   - `CF_ACCOUNT_ID`：你的 Cloudflare Account ID
   - `CF_ZONE_ID`：你的 区域 ID (Zone ID)
   - `ADMIN_PASSWORD`：你自定义的后台管理密码
   - `BASE_DOMAIN`：你的域名（如 `example.com`）
4. 添加完成后，在仓库顶部点击 **动作（Actions）**，左侧选择 **Deploy to Cloudflare Workers**，然后点击右侧的 **运行工作流（Run workflow）**。
5. 等待绿色的打勾 ✔️ 出现，就部署成功了！
*(注：数据库同样会在你第一次访问网站时**自动初始化**，无需手动配置！)*

---

## 第五步：访问并使用你的代理

恭喜你，部署完成！🎉 

### 怎么访问？
- **首页指南：** `https://proxy.你的域名.com/`
- **后台管理：** `https://proxy.你的域名.com/admin` （密码就是你设置的 `ADMIN_PASSWORD`）
- **查看统计：** `https://proxy.你的域名.com/stats`

### 怎么代理 Emby？
假设你的 Emby 原地址是 `http://1.2.3.4:8096`。
你只需要在浏览器或播放器里输入：
`https://proxy.你的域名.com/http://1.2.3.4:8096`

### 💡 别名功能（推荐）
如果你觉得上面的地址太长了，你可以登录**后台管理**：
1. 点击 **新增别名组**，关键词写 `myemby`。
2. 在这个别名组里，添加线路 `http://1.2.3.4:8096`。
3. 保存后，你就可以直接通过 `https://proxy.你的域名.com/myemby` 来访问你的影音库了！非常简短优雅。

---

## ❓ 常见问题排查

**问题 1：打开网页提示 "Error 1001" 或 "DNS Resolution Error"**
**解答：** 域名没有绑定成功。请回到 `Worker` -> `设置（Settings）` -> `域和路由（Domains & Routes）`，确认自定义域已经添加并且生效。

**问题 2：后台登录提示密码错误**
**解答：** 登录时，输入框里要填的是你设置的**具体密码**（比如 `123456`），而不是填 `ADMIN_PASSWORD` 这几个英文字母。

**问题 3：播放视频时随机报错，或者一直转圈**
**解答：** 检查 Cloudflare 的 `安全性（Security）` -> `机器人（Bots）`，确保 **机器人攻击模式（Bot Fight Mode）** 已经**关闭**。

**问题 4：网页提示 "D1 数据库未绑定"**
**解答：** 回到 `Worker` -> `设置（Settings）` -> `绑定（Bindings）`，检查绑定的变量名是不是大写的 `DB`。必须是大写！

**问题 5：修改代码后没有生效**
**解答：** 每次在网页上修改代码或环境变量后，都必须点击右下角的 **保存并部署（Save and deploy）**。
