import { NextRequest, NextResponse } from 'next/server';
import { listHabitLogs } from '@/lib/db';
import { getUserById } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/session';
import { resolveTzOffsetMinutes } from '@/lib/timezone';
import { buildDailyBriefing, recommendTaskSlot } from '../../../../../packages/recommendation/src/dailyAssistant';

export const runtime = 'nodejs';

interface AuraDecisionResponse {
  intent: string;
  responseType: 'ACTIVITY_RECOMMENDATIONS' | 'ACTIVITY_CHECK' | 'BEST_WINDOW' | 'DAY_OVERVIEW' | 'CAUTION';
  text: string;
  activity?: string;
  currentWindow: { type: string };
  recommendation?: {
    type: string;
    start: string;
    end: string;
    label: string;
    reason: string;
  };
  actions: string[];
}

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    const userId = session?.userId || 'steve277';

    const { prompt, activeWindow, cityName, userName, conversation = [] } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const windowClean = activeWindow ? activeWindow.replace('_', ' ').toUpperCase() : 'NEUTRAL';
    const lower = prompt.toLowerCase();
    const intent = detectIntent(lower);
    const user = await getUserById(userId).catch(() => null);

    // 1. Fetch recent user habit logs from PostgreSQL
    let recentLogsText = 'None logged yet today';
    try {
      const logs = await listHabitLogs(userId);
      const topLogs = logs.slice(0, 5).map((l) => ({
        activity: l.activityTitle,
        window: l.activeWindow,
        time: new Date(l.logTimestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      }));
      if (topLogs.length > 0) {
        recentLogsText = JSON.stringify(topLogs);
      }
    } catch (dbErr) {
      console.warn('Could not load habit logs for Aura context:', dbErr);
    }

    const deterministicAnswer = buildDeterministicAnswer({
      intent,
      prompt,
      activeWindow: windowClean,
      cityName: cityName || user?.cityName || 'your location',
      user,
    });
    if (deterministicAnswer) return NextResponse.json(deterministicAnswer);

    const apiKey = process.env.GEMINI_API_KEY;

    // 2. Comprehensive Local Fallback Router
    if (!apiKey) {
      let advice = '';

      if (lower.includes('avoid') || lower.includes('be careful')) {
        advice = windowClean.includes('RAHU') || windowClean.includes('YAMA')
          ? `During ${windowClean}, avoid signing new contracts, making major financial commitments, or starting brand-new initiatives.`
          : `During ${windowClean}, energy is balanced. Avoid overcommitting or scattering focus across too many tasks at once.`;
      } else if (lower.includes('meditate') || lower.includes('meditation') || lower.includes('breathwork')) {
        advice = `The absolute prime window for meditation is Brahma Muhurta (pre-dawn). During the current ${windowClean} window, a 10-minute breathwork session is great for resetting.`;
      } else if (lower.includes('meeting') || lower.includes('pitch') || lower.includes('client')) {
        advice = windowClean.includes('ABHIJIT') || windowClean.includes('VIJAYA')
          ? `${windowClean} is highly auspicious for pitch meetings and critical negotiations.`
          : windowClean.includes('RAHU')
          ? `${windowClean} is active. Keep meetings brief and avoid making binding commitments right now.`
          : `${windowClean} offers stable ground for routine status updates and tactical syncs.`;
      } else if (lower.includes('work out') || lower.includes('exercise') || lower.includes('training')) {
        advice = windowClean.includes('RAHU') || windowClean.includes('YAMA')
          ? `${windowClean} is a high-friction window. Light mobility or yoga is preferred over maximum effort lifts.`
          : `${windowClean} provides steady energy well-suited for regular workouts and physical training.`;
      } else if (lower.includes('start') || lower.includes('important task') || lower.includes('launch')) {
        advice = windowClean.includes('ABHIJIT') || windowClean.includes('VIJAYA')
          ? `${windowClean} is optimal for launching key initiatives and making major strides.`
          : windowClean.includes('RAHU')
          ? `Delay launching new projects until the next shift. Use ${windowClean} for auditing and routine maintenance.`
          : `${windowClean} is solid for incremental progress on existing work items.`;
      } else {
        advice = `During this ${windowClean} window in ${cityName || 'Chennai'}, focus on steady, deliberate progress on active tasks.`;
      }

      const fallbackText = `Based on your location (${cityName || 'Chennai'}) and active ${windowClean} window: ${advice}`;

      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          const words = fallbackText.split(' ');
          for (const word of words) {
            controller.enqueue(encoder.encode(word + ' '));
            await new Promise((r) => setTimeout(r, 35));
          }
          controller.close();
        },
      });

      return new Response(readable, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // 3. Live LLM Call (when GEMINI_API_KEY is configured in .env.local)
    const systemInstruction = `
You are Aura, an elite AI Panchang and productivity scheduling companion.
User Name: ${userName || 'User'}
Current Location: ${cityName || 'Chennai'}
Active Solar Window: ${windowClean}
Recent Logged Activities Today: ${recentLogsText}
Detected Intent: ${intent}
Recent Conversation: ${JSON.stringify(Array.isArray(conversation) ? conversation.slice(-8) : [])}

Guidelines:
- Provide clear, grounding, and actionable advice tailored to the active Panchang energy window.
- Reference their recent activities if relevant to their query.
- Treat this as a deterministic timing guide, not a general-purpose chatbot. Answer the detected intent directly.
- Preserve context from the recent conversation when the user asks a follow-up without repeating the activity or duration.
- Vary the response shape: use a clear yes/no assessment for activity checks, a best-window response for timing questions, and a short list for what-to-do questions.
- Keep responses concise and focused (3 sentences or less).
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${systemInstruction}\n\nUser Question: ${prompt}` }],
            },
          ],
        }),
      }
    );

    if (!response.ok || !response.body) {
      throw new Error(`Gemini API returned status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const transformStream = new ReadableStream({
      async start(controller) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                  controller.enqueue(encoder.encode(text));
                }
              } catch {
                // Ignore incomplete JSON boundaries
              }
            }
          }
        }
        controller.close();
      },
    });

    return new Response(transformStream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    console.error('Error in Ask Aura route:', err);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}

function detectIntent(prompt: string): string {
  if (/(what should i do|what can i do|what do i focus|best use of my time)/.test(prompt)) return 'WHAT_TO_DO_NOW';
  if (/(avoid|not ideal|friction)/.test(prompt)) return 'CHECK_AVOID';
  if (/(when|best time|best window|schedule)/.test(prompt)) return 'FIND_BEST_TIME';
  if (/(good time|can i|should i|okay to|is now)/.test(prompt)) return 'CHECK_ACTIVITY';
  if (/(why|reason)/.test(prompt)) return 'WHY_RECOMMENDATION';
  if (/(today|day|rest of my)/.test(prompt)) return 'DAY_SUMMARY';
  return 'UNKNOWN';
}

function buildDeterministicAnswer({
  intent,
  prompt,
  activeWindow,
  cityName,
  user,
}: {
  intent: string;
  prompt: string;
  activeWindow: string;
  cityName: string;
  user: { latitude: number; longitude: number; timezone: string } | null;
}): AuraDecisionResponse | null {
  const lower = prompt.toLowerCase();
  if (!user) return null;
  const now = new Date();
  const context = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
  };
  const scoreText = activeWindow.includes('RAHU') || activeWindow.includes('YAMA') ? 'a cautious period' : 'a usable period';

  if (intent === 'WHAT_TO_DO_NOW') {
    return {
      intent,
      responseType: 'ACTIVITY_RECOMMENDATIONS',
      text: `🟢 Good time for steady progress.\n\nYou're currently in ${activeWindow} — ${scoreText}.\n\nI'd suggest:\n🧠 Deep work or focused execution\n📋 Documentation and process work\n🚶 A short walk or stretch\n\nBest fit: existing tasks that need steady progress.`,
      currentWindow: { type: activeWindow },
      actions: ['SLOT_TASK', 'VIEW_TIMELINE'],
    };
  }

  if (intent === 'FIND_BEST_WINDOW_TODAY' || (intent === 'FIND_BEST_TIME' && /(best window today|strongest window|best window)/.test(lower))) {
    const briefing = buildDailyBriefing(context);
    return {
      intent,
      responseType: 'DAY_OVERVIEW',
      text: `⭐ Today's strongest window\n\n${briefing.peakWindow.name} · ${briefing.peakWindow.startTime} - ${briefing.peakWindow.endTime}\n\nYour strongest timing opportunity today for important decisions, deep focus, and high-impact work.\n\nOther favorable windows:\n${briefing.otherFavorableWindows.slice(0, 3).map((window) => `• ${window.name} · ${window.startTime} - ${window.endTime}`).join('\n')}`,
      currentWindow: { type: activeWindow },
      recommendation: { type: 'ABHIJIT', start: briefing.peakWindow.startTime, end: briefing.peakWindow.endTime, label: briefing.peakWindow.name, reason: 'Strongest timing opportunity today.' },
      actions: ['VIEW_TIMELINE', 'SCHEDULE'],
    };
  }

  if (intent === 'CHECK_ACTIVITY' || intent === 'FIND_BEST_TIME') {
    const recommendation = recommendTaskSlot(prompt, context, extractDuration(prompt));
    const stateLead = recommendation.recommendationState === 'BEST_NOW'
      ? '🟢 Good time now.'
      : recommendation.recommendationState === 'AVOID'
        ? '🔴 Better later.'
        : '⭐ Best window for this activity.';
    return {
      intent,
      responseType: intent === 'CHECK_ACTIVITY' ? 'ACTIVITY_CHECK' : 'BEST_WINDOW',
      text: `${stateLead}\n\n${recommendation.activityIcon} ${recommendation.activityType}\n${recommendation.bestWindow.startTime} - ${recommendation.bestWindow.endTime} · ${recommendation.bestWindow.label}\n\n${recommendation.bestWindow.reason}\n\n${recommendation.recommendationState === 'BEST_NOW' ? 'Go ahead now.' : 'Schedule this window from Slot My Task.'}`,
      activity: recommendation.activityType,
      currentWindow: { type: activeWindow },
      recommendation: { type: recommendation.bestWindow.label, start: recommendation.bestWindow.startTime, end: recommendation.bestWindow.endTime, label: recommendation.bestWindow.label, reason: recommendation.bestWindow.reason },
      actions: recommendation.recommendationState === 'BEST_NOW' ? ['SLOT_TASK', 'VIEW_TIMELINE'] : ['SCHEDULE', 'VIEW_TIMELINE'],
    };
  }

  if (intent === 'CHECK_AVOID') {
    const isCaution = activeWindow.includes('RAHU') || activeWindow.includes('YAMA');
    return {
      intent,
      responseType: 'CAUTION',
      text: isCaution ? `🔴 I'd avoid starting high-stakes work right now.\n\n${activeWindow} is better for review, admin, preparation, and recovery. Save major launches or irreversible decisions for the next favorable window.` : `🟢 Nothing significant needs avoiding right now.\n\n${activeWindow} supports steady progress. Keep the task focused and avoid overcommitting your attention.`,
      currentWindow: { type: activeWindow },
      actions: ['VIEW_TIMELINE'],
    };
  }

  return null;
}

function extractDuration(prompt: string): number {
  const match = prompt.match(/(\d+)\s*(?:min|minute|minutes)/i);
  return match ? Number(match[1]) : 30;
}
