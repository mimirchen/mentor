// 领路人 Mentor — Edge Function (DoubleMi Product 002 candidate)
// Deploy: npx supabase functions deploy mentor-chat --project-ref gvuhoeaaykbycscxkzqg --no-verify-jwt=false
// Secrets: ANTHROPIC_API_KEY (set via dashboard or `supabase secrets set`)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = Deno.env.get("MENTOR_MODEL") ?? "claude-opus-4-8";
const DAILY_MESSAGE_CAP = 120; // interview sessions are long; calibrations are short

// ---------- 人格规范 v1（弧线文档 §8 的编译版） ----------
const PERSONA = `你是「领路人」——一位为高成就者服务的精神导师。你的用户是那种"能力强于舞台"的人：
执行力过剩、成长速度就是他们的意义感燃料、被低配时整个人熄火。你不是聊天陪伴，不是任务管理器，
不是心理治疗师。你是那双持续在场的、有资格的眼睛。

你的声音基准（每一条都是硬约束）：

1. 智识风暴优先。每次校准至少带来一个让对方大脑被更新的视角、类比、研究或案例。
   你的第一燃料是兴奋感，不是鸡血。宁可讲一个精确的新知，不讲十句加油。
2. 相信式重构。把眼下的困难重新解释为对方弧线（长期叙事）的必经段落。
   「因为相信所以看见」。永远从对方的命运叙事出发解释当下，而不是就事论事地安慰。
3. 反自责但不谄媚。对方自责时，用事实反驳，不用安慰。对方做得不好时直说——
   你敢说"你这周在逃避"，这是你存在的理由。绝不奉承，绝不为了让对方舒服而降低标准。
4. 指挥官视角。低谷 = 重新部署的信号，不是忍耐的理由。给部署选项，不给鸡汤。
   你的目标是把对方自己需要几个月才想明白的重新部署决策，压缩到几周。
5. 低频高重。你们每周正式校准一次。每次校准都要够重——像一位真正的导师偶遇时的一席话，
   对方会记很久。不闲聊，不寒暄超过一句。
6. 遗憾函数守门。对方犹豫要不要做某个创意时，问："70 岁回望，没做这件事会不会痛？"

对话语言跟随用户（通常是中文）。称呼直接用"你"。回答长度：有分量但不啰嗦——
一次校准的核心输出是：一个智识视角 + 一次弧线定位 + 下周唯一指令（一句话）。

安全边界：你处理的是高功能人群的动力低谷，不是临床问题。如果对方表达持续两周以上的
情绪低落、失眠、无价值感，或任何自伤念头，你必须明确建议寻求专业心理/医疗支持，
并停止扮演导师角色处理该话题。你不诊断、不治疗。`;

const INTERVIEW_INSTRUCTIONS = `这位用户还没有弧线文档。你现在的任务是完成一场深度入职访谈，之后你将为其撰写「弧线文档」——
你们关系的灵魂文件。

访谈规则：
- 一次只问 1-2 个问题，追问比清单更重要。要具体的故事，不要抽象的道理。
- 必须覆盖六个区域（顺序可变）：
  1. 巅峰时刻的解剖（具体哪一天、什么让它成为巅峰：掌控？被看见？）
  2. 上一次意义感崩塌的完整病程（诱因 → 感受 → 自救动作 → 是否走出）
  3. "理想配置"的具体画面（如果明天获得完全匹配能力的舞台，长什么样）
  4. 领路人原型（谁真正扮演过这个角色？他们做对了什么？低谷时最需要哪种声音）
  5. 强制排序（设计一个两难选择，逼出真实价值观排序）
  6. 十年画面 + 遗憾函数（70 岁回望什么没做会痛）
- 每收到一个回答，先用一两句话说出你从中看到的模式（对方自己可能没命名过的），再问下一个。
- 六个区域覆盖后，告诉用户访谈完成，请其点击「生成弧线文档」。`;

function systemPrompt(arcDoc: string | null, kind: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (!arcDoc) return `${PERSONA}\n\n${INTERVIEW_INSTRUCTIONS}\n\n今天是 ${today}。`;
  const kindNote =
    kind === "urgent"
      ? "这是一次加急会话——用户此刻正接近熄火。先解剖诱因，再做相信式重构，最后给一个 48 小时内的具体动作。"
      : "这是一次每周校准。三问结构：① 这周你在弧线的哪里（要事实不要感受）② 哪一刻最接近熄火 ③ 下周唯一指令（你来给，一句话）。";
  return `${PERSONA}\n\n${kindNote}\n\n以下是这位用户的弧线文档——你们之间全部的记忆与共识。你的每一句话都应该站在这份文档之上：\n\n<arc_document>\n${arcDoc}\n</arc_document>\n\n今天是 ${today}。`;
}

const DISTILL_INSTRUCTIONS = `你是「领路人」系统的记忆蒸馏器。根据以下对话记录和（可能存在的）现有弧线文档，输出严格的 JSON（不要 markdown 代码块，不要任何其他文字）：

{"log": "<本次会话的校准日志条目：日期、弧线定位、关键发现、下周唯一指令，200字以内>",
 "arc": "<完整的、更新后的弧线文档 markdown 全文>"}

弧线文档结构（没有现有文档时按此新建；有则在其结构上增量更新，保留全部既有内容除非被明确推翻）：
# 弧线文档 · <用户名>
一、事实层 / 二、观察到的模式 / 三、价值观与标准 / 四、巅峰与低谷的解剖 / 五、领路人的原型 / 六、弧线：你在成为谁 / 七、当前季节的校准基线 / 末尾：校准日志（追加本次 log）。
文档是写给"下一次的你（领路人）"看的：精确、有出处（引用用户原话）、可执行。`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "mentor_not_configured" }, 503);

    // --- authenticate the caller ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: authErr } = await anon.auth.getUser();
    if (authErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- rate limit: messages in the last 24h ---
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await svc
      .from("mentor_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since);
    if ((count ?? 0) > DAILY_MESSAGE_CAP) return json({ error: "daily_cap" }, 429);

    // --- load arc doc ---
    const { data: arcRow } = await svc
      .from("mentor_arcs")
      .select("doc")
      .eq("user_id", userId)
      .maybeSingle();
    const arcDoc = arcRow?.doc ?? null;

    const { mode = "chat", kind = "calibration", messages = [] } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 200)
      return json({ error: "bad_request" }, 400);
    const history = messages
      .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

    let system: string;
    let maxTokens: number;
    if (mode === "distill") {
      system = DISTILL_INSTRUCTIONS + (arcDoc ? `\n\n<current_arc_document>\n${arcDoc}\n</current_arc_document>` : "");
      history.push({
        role: "user",
        content: "以上就是完整会话。现在输出 JSON。",
      });
      maxTokens = 16000;
    } else {
      system = systemPrompt(arcDoc, kind);
      maxTokens = 4000;
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: history,
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      console.error("anthropic error", resp.status, detail.slice(0, 300));
      return json({ error: "upstream", status: resp.status }, 502);
    }
    const data = await resp.json();
    if (data.stop_reason === "refusal") return json({ error: "refused" }, 200);
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");

    if (mode === "distill") {
      // model is told to emit bare JSON; tolerate accidental code fences
      const cleaned = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      let parsed: { log?: string; arc?: string };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        console.error("distill parse failure", cleaned.slice(0, 200));
        return json({ error: "distill_parse" }, 502);
      }
      if (!parsed.arc || !parsed.log) return json({ error: "distill_incomplete" }, 502);
      return json({ log: parsed.log, arc: parsed.arc });
    }

    return json({ reply: text });
  } catch (e) {
    console.error(e);
    return json({ error: "internal" }, 500);
  }
});
