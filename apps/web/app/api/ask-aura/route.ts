import { NextRequest, NextResponse } from 'next/server';
import { listHabitLogs } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    const userId = session?.userId || 'steve277';

    const { prompt, activeWindow, cityName, userName } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const windowClean = activeWindow ? activeWindow.replace('_', ' ').toUpperCase() : 'NEUTRAL';
    const lower = prompt.toLowerCase();

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

Guidelines:
- Provide clear, grounding, and actionable advice tailored to the active Panchang energy window.
- Reference their recent activities if relevant to their query.
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