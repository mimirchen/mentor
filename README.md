# 领路人 · The Mentor

一位持续在场的精神领路人：为"能力强于舞台"的高成就者保管命运叙事。

**DoubleMi 出品 · Product 002 候选**（n=1 dogfood 阶段，六周后评估是否产品化）。部署到 **mentor.doublemi.ai**。与全家产品共用同一个 Supabase 项目。

## 产品三支柱（缺一即沦为聊天套壳）

1. **弧线文档**：入职深度访谈产出的长期叙事，每次会话后由"蒸馏"自动更新——记忆即资产。
2. **人格规范**：智识风暴优先 / 相信式重构 / 反自责不谄媚 / 指挥官视角 / 遗憾函数守门。写死在 Edge Function 系统提示里。
3. **仪式而非闲聊**：每周校准（三问）+ 加急会话两种，低频高重。

## 结构

```
index.html                     登录页
app.html                       书房 + 校准室 + 弧线文档
assets/js/config.js            ← 唯一需要编辑的配置
assets/js/app.js               前端逻辑（auth / 会话 / 蒸馏 / 语音）
assets/css/mentor.css          设计系统（墨黑 + 琥珀金）
supabase/schema.sql            三张表 + owner-only RLS（已应用）
supabase/functions/mentor-chat 模型网关：人格 + 访谈/校准/蒸馏三模式
```

## 部署

- 前端：git push（GitHub Pages，CNAME → mentor.doublemi.ai）
- Edge Function：管理 API multipart 部署（无需本地 Node/Docker）：
  `curl -X POST "https://api.supabase.com/v1/projects/<ref>/functions/deploy?slug=mentor-chat" -H "Authorization: Bearer <sbp token>" -F 'metadata={"name":"mentor-chat","entrypoint_path":"index.ts","verify_jwt":false};type=application/json' -F 'file=@index.ts;type=application/typescript'`
- 唯一密钥：Supabase 项目 secrets 里的 `ANTHROPIC_API_KEY`

## 边界

- 零收入直到许可证 + 实体齐备（同觅梦规则）
- 不是医疗/心理治疗服务；系统提示含转介护栏
- 弧线文档极度私密：owner-only RLS，函数不落盘内容日志
