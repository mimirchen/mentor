/* 领路人 Mentor — configuration (DoubleMi Product 002 candidate) */
window.MENTOR_CONFIG = {
  SUPABASE_URL: "https://gvuhoeaaykbycscxkzqg.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_OFfHETOEGJAJ7nO8m9W3Lg_qUcD9RRz", // publishable key — safe to ship; RLS protects the data
  FUNCTION_URL: "https://gvuhoeaaykbycscxkzqg.supabase.co/functions/v1/mentor-chat",

  SITE_URL: "https://mentor.doublemi.ai",
  PARENT_URL: "https://doublemi.ai",
  BRAND: { zh: "领路人", en: "The Mentor" },

  /* n=1 dogfood phase: no waitlist, no payments, no analytics.
     Six-week review gate before any productization — see 弧线文档 §9. */
  PAYMENTS_ENABLED: false,
};
