import type { HotTopic, HotTopicsResponse } from 'novel-studio-contracts';

interface DiscussionHit {
  title: string;
  summary: string;
  url?: string;
}

/** Novel themes only. A name is shown when current web discussion actually mentions it. */
const THEMES = [
  '规则怪谈', '发疯文学', '新年代文', '年代文', '极简修仙', '短剧改编', '反套路', '跨界融合',
  '都市脑洞', '玄幻脑洞', '东方仙侠', '悬疑灵异', '历史古代', '动漫衍生', '都市修真', '战神赘婿',
  '无限流', '系统流', '签到流', '无敌流', '幕后流', '升级流', '凡人流', '情绪流',
  '重生', '穿书', '快穿', '清穿', '马甲', '追妻火葬场', '先婚后爱', '破镜重圆',
  '甜宠', '宫斗', '宅斗', '豪门', '娱乐圈', '电竞', '游戏', '直播', '团宠',
  '末世', '废土', '克苏鲁', '赛博朋克', '星际', '机甲', '高武', '诸天', '洪荒', '西游',
  '修仙', '仙侠', '武侠', '玄幻', '奇幻', '西幻', '都市', '悬疑', '灵异', '诡异', '民俗', '志怪',
  '权谋', '朝堂', '科举', '考公', '盗墓', '推理', '刑侦', '神豪', '鉴宝', '抗战', '谍战',
  '种田', '美食', '知青', '古言', '现言', '现实题材', '现实共鸣', '时间循环', '单元剧', '生存',
  '聊天群', '国运', '神明', '迪化', '文抄', '反派', '同人', '轻小说', '兽世',
].sort((a, b) => b.length - a.length);

const SKIP = new Set(['网文', '小说', '题材', '赛道', '热门', '爆款', '数据', '市场', '趋势', '大纲', '模板', '作品', '榜单', '平台', '作者', '读者', '男频', '女频', '短剧', '爽文', '方向', '基本盘']);

/** Searches public discussion of web-novel themes, then keeps the theme names that show up. */
export async function collectHotTopics(query: string, fetchImpl: typeof fetch = fetch): Promise<HotTopicsResponse> {
  const cleaned = query.trim().slice(0, 80);
  const failures: string[] = [];
  const hits: DiscussionHit[] = [];
  const searches = cleaned ? [`${cleaned} 网文 热门题材`] : ['2026 网文 热门题材 番茄 起点', '网文 热门赛道 男频 女频'];

  await Promise.all(searches.map(async (search) => {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(search)}`;
    try {
      const html = await fetchText(url, fetchImpl);
      const parsed = parseDuckDuckGo(html);
      if (parsed.length === 0) throw new Error('没有解析出网文讨论');
      hits.push(...parsed);
    } catch (error) {
      failures.push(`网文讨论：${failureText(error)}`);
    }
  }));

  const seen = new Set<string>();
  const unique = hits.filter((hit) => {
    const key = hit.url || hit.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const topics = extractNovelThemes(unique);
  const sources = topics.length ? ['网文题材讨论'] : [];
  return {
    query: cleaned,
    topics: topics.slice(0, 12),
    sources,
    failures: topics.length ? [] : [...new Set(failures)],
    fetchedAt: new Date().toISOString(),
  };
}

export function parseDuckDuckGo(html: string): DiscussionHit[] {
  const hits: DiscussionHit[] = [];
  const pattern = /class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,2500}?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(pattern)) {
    const title = plain(match[2]);
    const summary = plain(match[3]);
    if (!title || !/网文|题材|番茄|起点|晋江|七猫|女频|男频/.test(`${title} ${summary}`)) continue;
    hits.push({ title, summary, url: unwrapDuckDuckGo(match[1]) });
  }
  return hits;
}

export function extractNovelThemes(hits: DiscussionHit[]): HotTopic[] {
  const counts = new Map<string, { count: number; hit: DiscussionHit }>();
  for (const hit of hits) {
    const text = `${hit.title}\n${hit.summary}`;
    for (const theme of themesIn(text)) {
      const current = counts.get(theme);
      if (current) current.count += 1;
      else counts.set(theme, { count: 1, hit });
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], 'zh'))
    .map(([theme, found]) => ({
      id: topicId(theme),
      title: theme,
      summary: clip(found.hit.summary || found.hit.title, 180),
      source: `网文题材 · ${siteName(found.hit.url)}`,
      heat: `${found.count} 处提及`,
      url: found.hit.url,
    }));
}

function themesIn(text: string): string[] {
  let rest = text;
  const found: string[] = [];
  const bracketed = [...text.matchAll(/[【「]([^】」]{2,12})[】」]/g)].map((match) => match[1].replace(/[\d.]+$/g, '').trim());
  const candidates = [...new Set([...bracketed, ...THEMES])].filter((theme) => theme.length >= 2 && !SKIP.has(theme)).sort((a, b) => b.length - a.length);
  for (const theme of candidates) {
    if (!rest.includes(theme) || !mentionedPositively(text, theme)) continue;
    found.push(theme);
    rest = rest.replaceAll(theme, ' '.repeat(theme.length));
  }
  return found;
}

function mentionedPositively(text: string, theme: string): boolean {
  let from = 0;
  let ok = false;
  while (from < text.length) {
    const at = text.indexOf(theme, from);
    if (at < 0) break;
    const before = text.slice(Math.max(0, at - 18), at);
    if (!/别再|还在写|老套路|下滑|过时|不要写|无脑/.test(before)) ok = true;
    from = at + theme.length;
  }
  return ok;
}

function unwrapDuckDuckGo(href: string): string | undefined {
  const decoded = decode(href);
  const match = decoded.match(/[?&]uddg=([^&]+)/);
  const target = match ? safeDecode(match[1]) : decoded;
  return /^https?:\/\//i.test(target) ? target : undefined;
}

function siteName(url?: string): string {
  if (!url) return '网页';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('toutiao.com')) return '今日头条';
    if (host.includes('zhihu.com')) return '知乎';
    if (host.includes('baidu.com')) return '百度';
    if (host.includes('qq.com')) return '腾讯';
    return host;
  } catch {
    return '网页';
  }
}

function topicId(theme: string): string {
  let hash = 0;
  for (const char of theme) hash = Math.imul(hash, 31) + char.charCodeAt(0) | 0;
  return `theme-${(hash >>> 0).toString(36)}`;
}

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html',
      'accept-language': 'zh-CN,zh;q=0.9',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (response.url && !response.url.startsWith('https://')) throw new Error('非 https 响应已丢弃');
  return response.text();
}

function failureText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().slice(0, 120) || '没有取到';
}

function plain(value: string): string {
  return decode(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
