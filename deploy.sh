#!/bin/bash

# Emby Proxy Worker 自动部署脚本
# Auto Deployment Script for Emby Proxy Worker

set -e

echo "=========================================="
echo "  Emby Proxy Worker 自动部署脚本"
echo "  Auto Deployment Script"
echo "=========================================="
echo ""

# 颜色定义 / Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 wrangler 是否安装 / Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}错误: wrangler 未安装 / Error: wrangler not installed${NC}"
    echo "请运行: npm install -g wrangler"
    exit 1
fi

# 检查是否登录 / Check if logged in
echo "检查 Cloudflare 登录状态 / Checking Cloudflare login status..."
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}未登录，正在引导登录... / Not logged in, guiding to login...${NC}"
    wrangler login
fi

echo -e "${GREEN}已登录 Cloudflare / Logged in to Cloudflare${NC}"
echo ""

# 读取配置 / Read configuration
WORKER_NAME=$(grep "^name = " wrangler.toml | cut -d'"' -f2)
BASE_DOMAIN=$(grep "BASE_DOMAIN" wrangler.toml | cut -d'"' -f2)

echo "Worker 名称 / Worker Name: $WORKER_NAME"
echo "基础域名 / Base Domain: $BASE_DOMAIN"
echo ""

# 提示输入敏感变量 / Prompt for sensitive variables
echo "=========================================="
echo "  配置环境变量 / Configure Environment Variables"
echo "=========================================="
echo ""

read -sp "请输入管理密码 / Enter admin password: " ADMIN_PASSWORD
echo ""
read -sp "请输入 CF_API_TOKEN / Enter CF_API_TOKEN: " CF_API_TOKEN
echo ""
read -p "请输入 CF_ZONE_ID / Enter CF_ZONE_ID: " CF_ZONE_ID
echo ""

# 验证输入 / Validate input
if [ -z "$ADMIN_PASSWORD" ] || [ -z "$CF_API_TOKEN" ] || [ -z "$CF_ZONE_ID" ]; then
    echo -e "${RED}错误: 所有字段都必须填写 / Error: All fields are required${NC}"
    exit 1
fi

# 创建或更新 D1 数据库 / Create or update D1 database
echo ""
echo "=========================================="
echo "  创建 D1 数据库 / Creating D1 Database"
echo "=========================================="
echo ""

DB_NAME="emby-proxy-db"
DB_LIST=$(wrangler d1 list --json 2>/dev/null || echo "[]")
DB_EXISTS=$(echo "$DB_LIST" | grep -o '"name":"'$DB_NAME'"' || true)

if [ -n "$DB_EXISTS" ]; then
    echo -e "${YELLOW}数据库已存在 / Database already exists: $DB_NAME${NC}"
    DB_ID=$(echo "$DB_LIST" | grep -A1 '"name":"'$DB_NAME'"' | grep '"uuid"' | head -1 | cut -d'"' -f4)
else
    echo "创建数据库 / Creating database: $DB_NAME"
    CREATE_OUTPUT=$(wrangler d1 create "$DB_NAME" 2>&1)
    DB_ID=$(echo "$CREATE_OUTPUT" | grep -oP 'database_id = "\K[^"]+' || true)
    
    if [ -z "$DB_ID" ]; then
        echo -e "${RED}错误: 无法获取数据库 ID / Error: Could not get database ID${NC}"
        echo "$CREATE_OUTPUT"
        exit 1
    fi
    
    echo -e "${GREEN}数据库创建成功 / Database created successfully${NC}"
    echo "Database ID: $DB_ID"
fi

# 更新 wrangler.toml / Update wrangler.toml
echo ""
echo "更新配置文件 / Updating configuration file..."
sed -i "s/database_id = \".*\"/database_id = \"$DB_ID\"/" wrangler.toml

# 部署 Worker / Deploy Worker
echo ""
echo "=========================================="
echo "  部署 Worker / Deploying Worker"
echo "=========================================="
echo ""

# 使用 wrangler deploy 并设置密钥
wrangler deploy \
    --var ADMIN_PASSWORD:"$ADMIN_PASSWORD" \
    --var CF_API_TOKEN:"$CF_API_TOKEN" \
    --var CF_ZONE_ID:"$CF_ZONE_ID" \
    --var BASE_DOMAIN:"$BASE_DOMAIN"

echo ""
echo -e "${GREEN}Worker 部署成功 / Worker deployed successfully!${NC}"
echo ""

# 配置路由 / Configure Routes
echo "=========================================="
echo "  配置路由 / Configuring Routes"
echo "=========================================="
echo ""

ROUTES=(
    "proxy.$BASE_DOMAIN/*"
    "*.proxy.$BASE_DOMAIN/*"
    "proxy1.$BASE_DOMAIN/*"
    "proxy2.$BASE_DOMAIN/*"
    "proxy3.$BASE_DOMAIN/*"
    "proxy4.$BASE_DOMAIN/*"
    "proxy5.$BASE_DOMAIN/*"
    "proxy6.$BASE_DOMAIN/*"
    "proxy7.$BASE_DOMAIN/*"
    "proxy8.$BASE_DOMAIN/*"
    "proxy9.$BASE_DOMAIN/*"
    "proxy10.$BASE_DOMAIN/*"
    "proxy11.$BASE_DOMAIN/*"
    "proxy12.$BASE_DOMAIN/*"
)

echo "注意: 路由需要通过 Cloudflare Dashboard 手动配置"
echo "Note: Routes need to be configured manually via Cloudflare Dashboard"
echo ""
echo "请添加以下路由 / Please add the following routes:"
echo ""
for route in "${ROUTES[@]}"; do
    echo "  - $route"
done

echo ""
echo "操作步骤 / Steps:"
echo "1. 访问 / Visit: https://dash.cloudflare.com"
echo "2. 选择 Workers & Pages → 你的 Worker"
echo "3. 点击 Triggers 标签"
echo "4. 点击 Add route"
echo "5. 添加上述所有路由"
echo ""

# 完成 / Done
echo "=========================================="
echo -e "${GREEN}  部署完成 / Deployment Complete!${NC}"
echo "=========================================="
echo ""
echo "访问地址 / Access URLs:"
echo "  首页 / Homepage: https://proxy.$BASE_DOMAIN/"
echo "  管理后台 / Admin: https://proxy.$BASE_DOMAIN/admin"
echo "  统计 / Stats: https://proxy.$BASE_DOMAIN/stats"
echo ""
echo "首次访问时，Worker 会自动创建 DNS 记录"
echo "DNS records will be created automatically on first visit"
echo ""
echo -e "${YELLOW}提示: 首次访问管理后台时，请使用刚才设置的密码登录${NC}"
echo -e "${YELLOW}Tip: Use the password you just set to login to admin panel${NC}"
echo ""
