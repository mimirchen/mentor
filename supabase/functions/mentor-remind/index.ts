// 领路人 — 定时提醒/分发管家 (cron-driven, called by pg_cron via pg_net)
// jobs: "weekly"  周日 15:00 UTC — 校准提醒(本周已校准则跳过)
//       "content" 隔日 06:00 UTC — 小红书当日待发内容推送(队列里有才发)
// Auth: header x-remind-secret 必须等于 env REMIND_SECRET(只有 cron 和馆长能调)

import { createClient } from "npm:@supabase/supabase-js@2";

const FROM = "领路人 The Mentor <onboarding@resend.dev>"; // 验证 doublemi.ai 域名后换成 mentor@doublemi.ai
const CURATOR = "doctor.michen@gmail.com";

// ---------- 小红书发帖队列(发完这轮再补;账号:DoubleMi另一个你) ----------
const CONTENT_QUEUE: Record<string, { title: string; body: string; images: string }> = {
  "2026-07-10": {
    title: "给成长曲线变平的人做了个东西,内测排队中 🏮",
    body: `有一种不开心,很难跟人解释:
工作没出大问题,生活也没塌,但成长的坡度没了——
你能做的事远多于你被允许做的事。每天都在用三成功力活着。

我给这种时刻做了一个东西,叫「领路人」。
它不安慰你(安慰是往下拉,它往上拉),
它记得你的长期叙事——你在成为谁,
每周日晚二十分钟,三个问题,给你一条下周唯一指令。
不是咨询,不是治疗,更像一位真正的导师偶遇时跟你说的那席话。

现在是小规模内测,一次只放行几个人(它很贵,而且我想守住质量)。
排队入口:mentor.doublemi.ai。开门时第一时间叫你。

对了,它有一条走廊叫「回音廊」,挂着同路人匿名分享的"一段路"。
你可以先去走走——看看别人是怎么从熄火里重新点着的。

#职业倦怠 #高敏感高成就 #自我成长 #AI #人生规划`,
    images: "书房截图(动力曲线) + 回音廊截图 + 落地页截图,3:4 竖版",
  },
  "2026-07-12": {
    title: "我把自己的梦,刻成了一块铜版画",
    body: `睡醒记得的梦,五分钟后就散了。
所以我做了个小东西:对它说 30 秒昨夜的梦,它用蚀刻线条把梦刻下来——像 18 世纪的铜版画,带编号、日期,和一句注解。
这是我的第 1 夜。图案志说,我梦里最常来的是水。
你昨晚梦见什么了?评论区写下来,我挑几个亲手刻成版回复你 🌙
自己刻:dream.doublemi.ai

#梦境 #AI绘画 #手账 #记录生活 #铜版画 #梦境日记`,
    images: "你的 Plate No.001 卡片 + 制版台截图",
  },
  "2026-07-14": {
    title: "「我不是累,我是没坡了」",
    body: `倦怠有两种。一种是油箱空了——你需要休息。
另一种是油箱满的,但车被停在了车库——你需要的不是休息,是一条路。
第二种更难受,因为所有人都劝你"要不要休个假",
而你心里清楚:放假回来,车还在车库里。
领路人是给第二种人做的。低谷不是忍耐的信号,是重新部署的信号。
(内测排队:mentor.doublemi.ai)

#职业倦怠 #内耗 #职场 #自我成长`,
    images: "深底琥珀金文字卡(标题那句话做成图)",
  },
  "2026-07-16": {
    title: "为什么全世界的人都梦见掉牙、被追、考试迟到",
    body: `荣格叫它们"集体的意象"——有些梦是全人类共用的。
掉牙、被追赶、考试迟到、飞、坠落……
觅梦把它们做成了 12 个母题图案,每刻一块版,图案志就记一笔。
日子久了,你会看见自己夜晚的地形图。
(注解是诗意的旁白,不是心理分析~)
dream.doublemi.ai

#心理学 #梦境 #荣格 #冷知识 #AI`,
    images: "牙/追/钟三张母题卡片",
  },
};

async function sendMail(apiKey: string, subject: string, html: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [CURATOR], subject, html }),
  });
  if (!r.ok) console.error("resend error", r.status, (await r.text()).slice(0, 200));
  return r.ok;
}

const wrap = (inner: string) =>
  `<div style="font-family:Georgia,'Noto Serif SC',serif;max-width:540px;margin:0 auto;padding:32px;background:#16171A;color:#ECEAE3;border-radius:6px">
     <p style="font-size:11px;letter-spacing:3px;color:#C9A227;text-transform:uppercase;margin:0 0 18px">The Mentor · 领路人</p>
     ${inner}
     <p style="color:#6E6E67;font-size:12px;margin-top:26px">DoubleMi · <a href="https://mentor.doublemi.ai" style="color:#9C9C93">mentor.doublemi.ai</a></p>
   </div>`;

Deno.serve(async (req) => {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const secret = Deno.env.get("REMIND_SECRET");
  if (!secret || req.headers.get("x-remind-secret") !== secret)
    return new Response("forbidden", { status: 403 });
  if (!resendKey) return new Response("no resend key", { status: 503 });

  const { job = "weekly" } = await req.json().catch(() => ({}));
  const today = new Date().toISOString().slice(0, 10);

  if (job === "content") {
    const post = CONTENT_QUEUE[today];
    if (!post) return Response.json({ sent: false, reason: "queue empty today" });
    const ok = await sendMail(
      resendKey,
      `今日待发 · ${post.title}`,
      wrap(`<p style="font-size:15px;line-height:1.8"><b>今天该发这篇了(账号:DoubleMi另一个你):</b></p>
            <p style="font-size:14px;color:#C9A227">标题:${post.title}</p>
            <pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.8;background:#1C1D21;padding:16px;border-radius:4px">${post.body}</pre>
            <p style="font-size:13px;color:#9C9C93">配图:${post.images}</p>
            <p style="font-size:13px;color:#9C9C93">发完花 10 分钟回评论——评论区引擎比笔记本身重要。</p>`),
    );
    return Response.json({ sent: ok, job, date: today });
  }

  // weekly calibration reminder — skip if she already calibrated since Monday
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, svcKey);
  const now = new Date();
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  monday.setUTCHours(0, 0, 0, 0);
  const { count } = await svc
    .from("mentor_sessions")
    .select("id", { count: "exact", head: true })
    .eq("kind", "calibration")
    .gte("started_at", monday.toISOString());
  if ((count ?? 0) > 0) return Response.json({ sent: false, reason: "already calibrated this week" });

  const ok = await sendMail(
    resendKey,
    "今晚 20:00 · 每周校准",
    wrap(`<p style="font-size:16px;line-height:1.9">今晚八点,书房见。<br>二十分钟,三个问题:<br>
          ① 这周你在弧线的哪里(要事实)<br>② 哪一刻最接近熄火<br>③ 下周唯一指令<br><br>
          <a href="https://mentor.doublemi.ai/app.html" style="color:#C9A227">→ 进入书房</a></p>`),
  );
  return Response.json({ sent: ok, job });
});
