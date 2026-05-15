-- D1 数据库初始化脚本
-- 在 Cloudflare Dashboard 或 Wrangler CLI 中执行

-- 1. 统计表 - 记录每日播放和获取链接次数
CREATE TABLE IF NOT EXISTS emby_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    playing_count INTEGER DEFAULT 0,
    playback_info_count INTEGER DEFAULT 0
);

-- 2. 别名节点表 - 存储别名组信息
CREATE TABLE IF NOT EXISTS alias_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT UNIQUE NOT NULL,
    remark TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. 别名线路表 - 存储每个别名的多条线路
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

-- 4. 智能选线缓存表 - 按地区+运营商缓存最优线路
CREATE TABLE IF NOT EXISTS speed_region_cache (
    region_code TEXT NOT NULL,
    asn TEXT NOT NULL,
    best_subdomain TEXT NOT NULL,
    latency INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    PRIMARY KEY (region_code, asn)
);

-- 5. 测速日志表 - 记录测速历史
CREATE TABLE IF NOT EXISTS speed_test_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region_code TEXT,
    asn TEXT,
    domain TEXT,
    latency INTEGER,
    tested_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. DNS 操作日志表
CREATE TABLE IF NOT EXISTS dns_operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation TEXT,
    domain TEXT,
    status TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
