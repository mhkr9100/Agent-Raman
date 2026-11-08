// One shared category taxonomy across all sources (FRAMEWORK §7: category search is the most-used
// discovery method in the 1,000-tool review, so categories must mean the same thing everywhere).
// v1 assigns categories with keyword rules; R4 adds LLM enrichment (Batch API).

export const CATEGORIES = {
  "research": /\b(research|deep[- ]research|literature|papers?|arxiv|citations?)\b/i,
  "web-search": /\b(web[- ]?search|search engine|serp|google search|bing|brave search|perplexity|exa)\b/i,
  "web-scraping": /\b(scrap(e|er|ing)|crawl(er|ing)?|extract(ion)? .*(web|page|site)|firecrawl|apify)\b/i,
  "browser-automation": /\b(browser|playwright|puppeteer|selenium|headless chrome|web automation)\b/i,
  "data-analysis": /\b(analytics?|data analysis|pandas|dataframe|statistic(s|al)|bi\b|business intelligence|dashboards?)\b/i,
  "databases": /\b(database|sql|postgres(ql)?|mysql|sqlite|mongodb|redis|supabase|snowflake|bigquery|clickhouse)\b/i,
  "vector-search": /\b(vector|embeddings?|semantic search|rag\b|retrieval[- ]augmented|pinecone|qdrant|weaviate|chroma)\b/i,
  "spreadsheets": /\b(spreadsheets?|google sheets|excel|xlsx|csv|airtable)\b/i,
  "documents": /\b(pdf|docx?|word document|documents?|markdown|notion|confluence|google docs)\b/i,
  "image-generation": /\b(image generation|text[- ]to[- ]image|generate images?|dall-?e|midjourney|stable diffusion|flux|imagen)\b/i,
  "image-editing": /\b(image edit(ing)?|photo edit(ing)?|background remov|upscal|photoshop)\b/i,
  "video": /\b(video|youtube|ffmpeg|subtitles?|captions?|text[- ]to[- ]video)\b/i,
  "audio-speech": /\b(audio|speech|text[- ]to[- ]speech|tts|transcri(be|ption)|whisper|voice|podcast|music)\b/i,
  "design": /\b(design|figma|ui\/ux|canva|mockups?|wireframes?|brand(ing)?|logo)\b/i,
  "coding": /\b(code|coding|programming|ide\b|linter|refactor|compiler|typescript|python|github copilot)\b/i,
  "testing-qa": /\b(test(ing|s)?|qa\b|unit tests?|e2e|end-to-end|jest|pytest|vitest)\b/i,
  "version-control": /\b(git\b|github|gitlab|bitbucket|pull requests?|commits?)\b/i,
  "devops-cloud": /\b(devops|ci\/cd|docker|kubernetes|k8s|terraform|aws|azure|gcp|cloudflare|vercel|deploy(ment)?)\b/i,
  "monitoring-observability": /\b(monitor(ing)?|observability|logs?|logging|tracing|sentry|datadog|grafana|alerts?)\b/i,
  "security": /\b(security|vulnerabilit(y|ies)|pentest|secrets?|auth(entication)?|oauth|sso|compliance)\b/i,
  "automation-workflows": /\b(automat(e|ion)|workflows?|zapier|n8n|make\.com|ifttt|cron|schedul(e|er|ing)|webhooks?)\b/i,
  "project-management": /\b(project management|task management|to-?do lists?|issue track(er|ing)|jira|linear\.app|asana|trello|clickup|kanban|tickets?)\b/i,
  "communication": /\b(slack|discord|teams|telegram|whatsapp|chat|messag(e|ing)|sms)\b/i,
  "email": /\b(e-?mail|gmail|outlook|smtp|newsletter|mailchimp|resend)\b/i,
  "calendar-scheduling": /\b(calendar|scheduling|meetings?|calendly|appointments?)\b/i,
  "crm-sales": /\b(crm|sales|leads?|prospect(ing)?|hubspot|salesforce|apollo|pipedrive|outreach)\b/i,
  "marketing-seo": /\b(marketing|seo|ads?\b|advertising|campaigns?|social media|content marketing|keywords?)\b/i,
  "finance": /\b(financ(e|ial)|accounting|invoices?|stocks?|trading|crypto|quickbooks|budget)\b/i,
  "payments-ecommerce": /\b(payments?|stripe|paypal|checkout|e-?commerce|shopify|orders?)\b/i,
  "maps-location": /\b(maps?|geocod(e|ing)|location|places|gps|routes?|openstreetmap|mapbox)\b/i,
  "memory-knowledge": /\b(long[- ]term memory|agent memory|persistent memory|knowledge (base|graph)|note[- ]taking|notes app|obsidian|second brain)\b/i,
  "files-storage": /\b(files?|storage|s3\b|google drive|dropbox|filesystem|upload)\b/i,
  "ai-models": /\b(llm|language models?|gpt|claude|gemini|llama|mistral|inference|fine[- ]tun(e|ing)|model provider)\b/i,
  "agents-orchestration": /\b(agents?|multi[- ]agent|orchestrat(e|ion)|subagents?|mcp server|tool calling)\b/i,
  "translation-language": /\b(translat(e|es|ion|ions|or)|localization|locali[sz]e|i18n|multilingual)\b/i,
  "education": /\b(education|learning|courses?|tutor(ing)?|quiz(zes)?|flashcards?)\b/i,
  "health": /\b(health|medical|clinical|fitness|patients?)\b/i,
  "legal": /\b(legal|contracts?|law|compliance|gdpr|terms of service)\b/i,
  "social-media": /\b(twitter|x\.com|linkedin|instagram|tiktok|reddit|facebook|social network)\b/i,
} as const satisfies Record<string, RegExp>;

export type Category = keyof typeof CATEGORIES;
export const CATEGORY_NAMES = Object.keys(CATEGORIES) as Category[];

/** Assign categories from free text (name + description + source tags). At most `max`, most specific first. */
export function categorize(text: string, sourceTags: string[] = [], max = 4): Category[] {
  const haystack = `${text} ${sourceTags.join(" ")}`;
  const hits: Category[] = [];
  for (const name of CATEGORY_NAMES) {
    if (CATEGORIES[name].test(haystack)) hits.push(name);
    if (hits.length >= max) break;
  }
  return hits;
}
